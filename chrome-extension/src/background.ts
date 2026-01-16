import { CaptureErrorCode } from "./types/capture-result";
import pako from "pako";
import { normalizeAndPreflight } from "./utils/schema-preflight";

const PREFLIGHT_BLOCKING_MODE = false;

/**
 * Download text content reliably from MV3 service worker.
 *
 * - Small payloads: download as plain text (data URL, UTF-8).
 * - Large payloads: download as gzip-compressed data URL (`.json.gz`).
 *
 * Why: MV3 service workers do NOT support URL.createObjectURL(), and large
 * data URLs can exceed practical limits. Gzip keeps downloads small and stable.
 */
async function downloadTextFile(opts: {
  text: string;
  filename: string;
  mimeType?: string;
  saveAs?: boolean;
}): Promise<{ downloadId: number; filename: string; compressed: boolean }> {
  const { text, filename, mimeType = "application/json", saveAs = true } = opts;

  const uint8ToBase64 = (bytes: Uint8Array): string => {
    // Safe Uint8Array -> base64 conversion for large payloads.
    const CHUNK_SIZE = 0x8000; // 32k chunks
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      chunks.push(
        String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + CHUNK_SIZE))
        )
      );
    }
    return btoa(chunks.join(""));
  };

  // Heuristic threshold: beyond this, prefer gzip to keep URL sizes manageable.
  // (encodeURIComponent expands; gzip shrinks dramatically for JSON.)
  const MAX_PLAIN_TEXT_CHARS = 8 * 1024 * 1024; // ~8MB

  // Attempt plain text download for smaller payloads
  if (text.length <= MAX_PLAIN_TEXT_CHARS) {
    const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(
      text
    )}`;
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs,
      conflictAction: "uniquify",
    });
    return { downloadId, filename, compressed: false };
  }

  // Large payload: gzip + base64 data URL
  const gzipBytes = pako.gzip(text);
  const base64 = uint8ToBase64(gzipBytes);
  const gzMime = "application/gzip";
  const gzFilename = filename.endsWith(".json")
    ? `${filename}.gz`
    : filename.endsWith(".gz")
    ? filename
    : `${filename}.gz`;

  const gzDataUrl = `data:${gzMime};base64,${base64}`;
  const downloadId = await chrome.downloads.download({
    url: gzDataUrl,
    filename: gzFilename,
    saveAs,
    conflictAction: "uniquify",
  });

  return { downloadId, filename: gzFilename, compressed: true };
}

/**
 * Copy text to clipboard (for large files)
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    // For Service Workers, we need to use the offscreen document API
    // or send to content script. For now, we'll use a simpler approach.

    // Store in chrome.storage for the popup to retrieve
    await chrome.storage.local.set({
      clipboardData: text,
      clipboardTimestamp: Date.now(),
    });

    console.log(
      `[CLIPBOARD] Stored ${(text.length / 1024 / 1024).toFixed(
        1
      )}MB in storage for clipboard`
    );
  } catch (error) {
    console.error("[CLIPBOARD] Failed to store data:", error);
    throw new Error("Failed to prepare clipboard data");
  }
}

// Global error handlers
self.addEventListener("error", (event: ErrorEvent) => {
  console.error("[GLOBAL_ERROR]", event.message, event.error);
});

self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  console.error("[UNHANDLED_REJECTION]", event.reason);
  reportError("unhandledrejection", event.reason);
});

// ===== Centralized Error Reporting =====
// Broadcasts errors to popup terminal via EXTENSION_ERROR message
function reportError(
  source: string,
  err: unknown,
  context: Record<string, unknown> = {}
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : null;

  const payload = {
    type: "EXTENSION_ERROR",
    source,
    message,
    stack,
    context,
    timestamp: Date.now(),
  };

  // Log to background console
  console.error(`[${source}]`, message, context);

  // Broadcast to popup/side panel
  try {
    chrome.runtime.sendMessage(payload, () => {
      // Ignore "no listeners" errors
      void chrome.runtime.lastError;
    });
  } catch (e) {
    console.warn("reportError sendMessage failed:", e);
  }
}

console.log("Web to Figma extension loaded");

// Content script is declared in manifest.json - no dynamic registration needed
// Dynamic registration would conflict with manifest declaration and cause "No SW" errors

// Handoff server endpoint - using local server for development
// Allow overriding via a global for local testing; default to null so we try multiple bases
const HANDOFF_SERVER_URL: string | null = ((globalThis as any)
  .__HANDOFF_SERVER_URL ?? null) as string | null;
const HANDOFF_PORT = 4411; // default local port for handoff server
const HANDOFF_BASE = HANDOFF_SERVER_URL || `http://localhost:${HANDOFF_PORT}`;
const CLOUD_CAPTURE_URL = HANDOFF_SERVER_URL;
const CLOUD_API_KEY =
  "f7df13dd6f622998e79f8ec581cc2f4dc908331cadb426b74ac4b8879d186da2";

const HANDOFF_BASES = [
  ...(HANDOFF_SERVER_URL ? [HANDOFF_SERVER_URL.replace(/\/$/, "")] : []),
  "http://127.0.0.1:4411",
  "http://localhost:4411",
  "http://127.0.0.1:5511",
  "http://localhost:5511",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];
const HANDOFF_API_KEY: string | null = ((globalThis as any).__HANDOFF_API_KEY ??
  null) as string | null;
let handoffBaseIndex = 0;

function currentHandoffBase() {
  return HANDOFF_BASES[handoffBaseIndex] || HANDOFF_BASES[0];
}

function rotateHandoffBase() {
  handoffBaseIndex = (handoffBaseIndex + 1) % HANDOFF_BASES.length;
  console.log(
    `[BG][HANDOFF] Rotated to base index ${handoffBaseIndex}: ${currentHandoffBase()}`
  );
}

// Reset to primary port (4411) when we know it's working
function resetHandoffToPrimary() {
  if (handoffBaseIndex !== 0) {
    console.log(
      `[HANDOFF] Resetting from fallback port (index ${handoffBaseIndex}) back to primary (4411)`
    );
    handoffBaseIndex = 0;
  }
}

/**
 * Check if a URL can be captured via CDP debugger
 * Chrome blocks CDP attachment to certain URL schemes for security
 */
function isCapturableUrl(url: string): boolean {
  if (!url) return false;

  const restrictedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "data:",
    "javascript:",
    "file://",
    "view-source:",
    "chrome-search://",
  ];

  const isRestricted = restrictedPrefixes.some((prefix) =>
    url.startsWith(prefix)
  );
  console.log(`[capture] checking URL for support: ${url} -> ${!isRestricted}`);
  return !isRestricted;
}
/**
 * Wait for the manifest-declared content script to be ready.
 * The manifest already auto-injects content-script.js on all URLs,
 * so we just need to wait for it to respond.
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  // Check if script is already injected and responsive
  const checkReady = async (retries = 3, delayMs = 100): Promise<boolean> => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await chrome.tabs.sendMessage(
          tabId,
          { type: "PING" },
          { frameId: 0 } // Target main frame only
        );
        if (response && response.pong) {
          console.log(
            `[background] Content script ready on tab ${tabId} main frame`
          );
          return true;
        }
      } catch (e) {
        // Script not ready, will retry
        // This is expected for tabs that were open before extension was loaded
      }
      if (i < retries - 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return false;
  };

  // First, check if manifest-declared content script is already ready
  // Give it a quick check (3 retries x 100ms) for fast pages
  let isReady = await checkReady(3, 100);

  // If not ready, try programmatically injecting for existing tabs
  if (!isReady) {
    const url = (await chrome.tabs.get(tabId)).url;
    if (url && getUrlType(url) === "restricted") {
      console.warn(
        `[background] Content script cannot run on restricted URL: ${url}`
      );
      return false;
    }

    // Try to inject content script programmatically
    try {
      console.log(
        `[background] Content script not found, attempting programmatic injection on tab ${tabId}`
      );
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content-script.js"], // Relative to extension root (dist folder)
        world: "ISOLATED", // Content scripts run in isolated world
      });
      console.log(
        `[background] Successfully injected content script on tab ${tabId}`
      );
      // Give it a moment to initialize, then check again
      await new Promise((resolve) => setTimeout(resolve, 200));
      isReady = await checkReady(10, 100); // Check up to 1 second after injection
    } catch (injectError) {
      console.warn(
        `[background] Failed to inject content script on tab ${tabId}:`,
        injectError
      );
      // Fall through to show user-friendly error
    }
  }

  if (!isReady) {
    // Content script still not responding after injection attempt
    console.warn(
      `[background] Content script not responding on tab ${tabId} after injection attempt. ` +
        `Please refresh the page.`
    );
    return false;
  }
  return true;
}

/**
 * Get user-friendly URL type description for error messages
 */
function getUrlType(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return "web";
  if (url.startsWith("chrome-extension://")) return "extension";
  if (url.startsWith("chrome://")) return "Chrome internal";
  if (url.startsWith("edge://")) return "Edge internal";
  if (url.startsWith("about:")) return "browser";
  if (url.startsWith("data:")) return "data";
  if (url.startsWith("file://")) return "local file";
  if (url.startsWith("view-source:")) return "view-source";
  return "restricted";
}

function handoffEndpoint(path: string) {
  return `${currentHandoffBase()}${path}`;
}

function withHandoffAuthHeaders(
  base: Record<string, string> = {}
): Record<string, string> {
  const headers = { ...base };
  if (HANDOFF_API_KEY) headers["x-api-key"] = HANDOFF_API_KEY;
  return headers;
}

function buildUnsupportedUrlError(url: string | undefined | null) {
  const urlType = getUrlType(url || "");
  const message = `Cannot capture this page. Chrome blocks debugger access to ${urlType} URLs. Please capture a regular webpage (http:// or https://).`;
  return {
    ok: false,
    error: message,
    errorCode: CaptureErrorCode.UNSUPPORTED_URL_SCHEME,
  };
}

// Side panel behavior disabled - using normal popup instead
// async function ensureSidePanelBehavior() {
//   if (!chrome.sidePanel) return;
//
//   try {
//     if (chrome.sidePanel.setPanelBehavior) {
//       await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
//       console.log("[SIDEPANEL] Configured action to open side panel");
//     }
//   } catch (error) {
//     console.warn("[SIDEPANEL] Failed to set panel behavior", error);
//   }
// }

// CDP capture mode flag (html.to.design-level accuracy)
// CDP capture mode is now mandatory (no fallback allowed per PIXEL_PERFECT_RULESET.md)

type HandoffTrigger = "auto" | "manual";
type HandoffStatus = "idle" | "queued" | "sending" | "success" | "error";

interface HandoffState {
  status: HandoffStatus;
  trigger?: HandoffTrigger | null;
  lastAttemptAt?: number | null;
  lastSuccessAt?: number | null;
  error?: string | null;
  pendingCount?: number;
  nextRetryAt?: number | null;
}

interface HandoffPayload {
  version: string;
  metadata: any;
  root: any; // Changed from 'tree' for schema consistency
  assets: any;
  styles: any;
  components?: any;
  variants?: any;
  designTokens?: any;
  designTokensRegistry?: any;
  cssVariables?: any;
  screenshot?: string;
  validation?: any;
  assetOptimization?: any;
  coordinateMetrics?: any;
  comprehensiveStates?: any;
  [key: string]: any;
}

interface PendingJob {
  id: string;
  payload: HandoffPayload;
  trigger: HandoffTrigger;
  enqueuedAt: number;
  retries: number;
  nextRetryAt?: number | null;
}

type WindowBounds = {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
};

interface CaptureTabViewportState {
  windowId: number;
  originalBounds?: WindowBounds;
  appliedViewport?: { width: number; height: number };
}

const WINDOW_FRAME_FUDGE = { width: 16, height: 100 };

let lastCapturedPayload: any = null;
// DEBUG: Expose to global scope for console inspection
(self as any).lastCapturedPayload = null;

// Prevent accidental duplicate imports by de-duping identical captures for a short window.
// Primary key is `payload.metadata.captureId` (added by content-script); fallback is absent and won't dedupe.
const RECENT_CAPTURE_ID_TTL_MS = 60_000;
const recentCaptureIds = new Map<string, number>();

function updateLastCapturedPayload(payload: any) {
  lastCapturedPayload = payload;
  (self as any).lastCapturedPayload = payload;
}

function getCaptureIdFromPayload(payload: any): string | null {
  const id =
    payload?.metadata?.captureId ??
    payload?.schema?.metadata?.captureId ??
    payload?.payload?.metadata?.captureId;
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

function pruneRecentCaptureIds(now: number) {
  for (const [id, ts] of recentCaptureIds.entries()) {
    if (now - ts > RECENT_CAPTURE_ID_TTL_MS) recentCaptureIds.delete(id);
  }
}

// DEBUG: Helper function to inspect schema from console
(self as any).debugSchema = () => {
  const payload = (self as any).lastCapturedPayload;
  if (!payload) {
    console.log("❌ No capture payload found. Run a capture first.");
    return;
  }

  let schema;
  if (payload.rawSchemaJson) {
    try {
      schema = JSON.parse(payload.rawSchemaJson);
    } catch (e) {
      console.error("JSON parse error", e);
      return;
    }
  } else if (payload.schema) {
    schema = payload.schema;
  } else {
    schema = payload;
  }

  if (!schema) {
    console.log("❌ Invalid payload structure", payload);
    return;
  }

  const images = (schema.assets && schema.assets.images) || {};
  const imageKeys = Object.keys(images);
  const firstKey = imageKeys[0];
  const firstImage = firstKey ? images[firstKey] : null;

  // Apply migration if needed
  if (schema.tree && !schema.root) {
    schema.root = schema.tree;
    delete schema.tree;
  }
  const root = schema.root;
  const firstChild =
    root && Array.isArray(root.children) ? root.children[0] : null;

  console.log("🔍 SCHEMA_DEBUG SNAPSHOT:", {
    viewport: schema.metadata?.viewport,
    totalImages: imageKeys.length,
    firstImage: firstImage
      ? {
          id: firstImage.id,
          url: firstImage.url,
          dims: `${firstImage.width}x${firstImage.height}`,
          hasData: !!firstImage.data,
          dataLen: firstImage.data?.length || 0,
        }
      : "None",
    rootNode: {
      type: root?.type,
      name: root?.name,
      childCount: root?.children?.length || 0,
    },
    firstNode: firstChild
      ? {
          name: firstChild.name,
          type: firstChild.type,
          imageHash: firstChild.imageHash,
          fills: firstChild.fills,
        }
      : "None",
  });
};
let handoffState: HandoffState = {
  status: "idle",
  trigger: null,
  pendingCount: 0,
};
let hasInFlightJob = false;
const pendingJobs: PendingJob[] = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let popupWindowId: number | null = null;
const captureTabState: Record<number, CaptureTabViewportState> = {};
let captureDeliveryMode: "send" | "download" = "send";

// Chunked data handling
let chunkedDataBuffer: string[] = [];
let expectedChunks = 0;
let receivedChunks = 0;

// ===== PERSISTENT CAPTURE STATE =====
// Canonical capture state is owned by the background/service worker.
// The popup UI is a detachable client that can close/reopen without disrupting capture.

interface CaptureState {
  isCapturing: boolean;
  stage: string;
  jobId: string | null;
  progress: number; // 0..100
  statusMessage: string;
  startTime: number | null;
  tabId: number | null;
  updatedAt: number; // ms epoch
  logs: Array<{ timestamp: number; message: string; level: string }>;
}

const CAPTURE_STATE_KEY = "captureState:v2";
const MAX_CAPTURE_LOGS = 200;
const CAPTURE_STATE_PERSIST_THROTTLE_MS = 150;
const storageSession: any = (chrome.storage as any).session;

let currentCaptureState: CaptureState = {
  isCapturing: false,
  stage: "idle",
  jobId: null,
  progress: 0,
  statusMessage: "",
  startTime: null,
  tabId: null,
  updatedAt: Date.now(),
  logs: [],
};

function clampProgress(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function normalizeLogs(
  logs: Array<{ timestamp: number; message: string; level: string }>
): Array<{ timestamp: number; message: string; level: string }> {
  const safe = Array.isArray(logs) ? logs : [];
  const normalized = safe
    .map((l) => ({
      timestamp:
        typeof l?.timestamp === "number" && Number.isFinite(l.timestamp)
          ? l.timestamp
          : Date.now(),
      message: l?.message != null ? String(l.message) : "",
      level: l?.level != null ? String(l.level) : "info",
    }))
    .filter((l) => l.message.length > 0);

  return normalized.slice(-MAX_CAPTURE_LOGS);
}

async function writeCaptureStateToStorage(state: CaptureState): Promise<void> {
  // Prefer session storage for high-frequency writes, fallback to local.
  try {
    if (storageSession) {
      await storageSession.set({ [CAPTURE_STATE_KEY]: state });
      return;
    }
  } catch {
    // fall through
  }

  try {
    await chrome.storage.local.set({ [CAPTURE_STATE_KEY]: state });
  } catch (error) {
    console.error("[STATE] Failed to persist capture state:", error);
  }
}

async function readCaptureStateFromStorage(): Promise<CaptureState | null> {
  try {
    if (storageSession) {
      const result = await storageSession.get(CAPTURE_STATE_KEY);
      const s = result?.[CAPTURE_STATE_KEY] ?? null;
      if (s) return s as CaptureState;
    }
  } catch {
    // fall through
  }

  try {
    const result = await chrome.storage.local.get(CAPTURE_STATE_KEY);
    return (result?.[CAPTURE_STATE_KEY] as CaptureState) ?? null;
  } catch (error) {
    console.error("[STATE] Failed to load capture state:", error);
    return null;
  }
}

async function clearCaptureStateStorage(): Promise<void> {
  try {
    if (storageSession) {
      await storageSession.remove(CAPTURE_STATE_KEY);
    }
  } catch {}
  try {
    await chrome.storage.local.remove(CAPTURE_STATE_KEY);
  } catch {}
}

let persistTimer: number | null = null;

function schedulePersistCaptureState(): void {
  if (persistTimer != null) return;

  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await writeCaptureStateToStorage(currentCaptureState);
  }, CAPTURE_STATE_PERSIST_THROTTLE_MS) as unknown as number;
}

function broadcastCaptureState(updates: Partial<CaptureState> = {}) {
  currentCaptureState = {
    ...currentCaptureState,
    ...updates,
    progress:
      updates.progress !== undefined
        ? clampProgress(updates.progress)
        : clampProgress(currentCaptureState.progress),
    updatedAt: Date.now(),
  };

  // Always keep logs bounded and well-formed
  currentCaptureState.logs = normalizeLogs(currentCaptureState.logs);

  // Persist (throttled)
  schedulePersistCaptureState();

  // Broadcast to any listening UI contexts (popup may or may not be open)
  chrome.runtime.sendMessage(
    {
      type: "CAPTURE_STATE_UPDATE",
      state: currentCaptureState,
    },
    () => void chrome.runtime.lastError
  );
}

// Rehydrate persisted state when the service worker starts
(async () => {
  const saved = await readCaptureStateFromStorage();
  if (saved) {
    currentCaptureState = {
      ...currentCaptureState,
      ...saved,
      progress: clampProgress(saved.progress),
      logs: normalizeLogs(saved.logs || []),
      updatedAt: Date.now(),
    };
    console.log(
      `[STATE] Rehydrated capture state: stage=${currentCaptureState.stage}, progress=${currentCaptureState.progress}`
    );
  }
})();

chrome.action.onClicked.addListener(async (tab) => {
  // Proactively inject content script if possible
  if (tab.id) {
    ensureContentScript(tab.id).catch((err) =>
      console.error("Failed to pre-inject content script:", err)
    );
  }

  // Open or focus the persistent popup window
  if (popupWindowId !== null) {
    // Window already exists - focus it
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      console.log("[POPUP] Focused existing popup window");
    } catch (error) {
      // Window was closed - create new one
      console.log("[POPUP] Previous window closed, creating new one");
      popupWindowId = null;
      createPersistentWindow();
    }
  } else {
    // Create new popup window
    createPersistentWindow();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  console.log(`Command "${command}" triggered`);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id) return;

  await ensureContentScript(tab.id);

  if (command === "capture-full-page") {
    chrome.tabs.sendMessage(tab.id, {
      type: "START_CAPTURE",
      allowNavigation: false,
    });
  } else if (command === "capture-selection") {
    chrome.tabs.sendMessage(tab.id, { type: "START_SELECTION_CAPTURE" });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    popupWindowId = null;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    if (captureTabState[tabId]) {
      delete captureTabState[tabId];
      console.log(`🧹 Cleaned up capture state for removed tab ${tabId}`);
    }
  } catch (error) {
    // Ignore permission errors for tab cleanup
    console.warn(
      "Tab cleanup warning:",
      error instanceof Error ? error.message : String(error)
    );
  }
});

function createPersistentWindow() {
  chrome.windows.create(
    {
      url: chrome.runtime.getURL("popup/popup.html"),
      type: "popup",
      width: 430,
      height: 720,
      focused: true,
    },
    (window) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Failed to open extension window:",
          chrome.runtime.lastError.message
        );
        return;
      }
      popupWindowId = window?.id ?? null;
    }
  );
}

let captureMode: "send" | "download" = "send";

// Removed captureTab function as it was wrapper for CDP capture
// The logic is now handled directly in the message handler or via content script flow

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // CRITICAL: Handle PING messages to keep the Service Worker alive during long captures
  // Content scripts send PING every 20s to prevent SW from going idle
  if (message.type === "PING") {
    sendResponse({ pong: true, timestamp: Date.now() });
    return false; // Synchronous response
  }

  // Handle popup requesting current capture state
  if (message.type === "GET_CAPTURE_STATE") {
    console.log("[STATE] Popup requested capture state");
    sendResponse({ state: currentCaptureState });
    return false; // Synchronous response
  }

  // Handle popup requesting to clear capture state
  // Handle popup requesting to clear capture state
  if (message.type === "CLEAR_CAPTURE_STATE") {
    console.log("[STATE] Clearing capture state");
    currentCaptureState = {
      isCapturing: false,
      stage: "idle",
      jobId: null,
      progress: 0,
      statusMessage: "",
      startTime: null,
      tabId: null,
      updatedAt: Date.now(),
      logs: [],
    };
    clearCaptureStateStorage().catch(() => {});
    // Persist immediately (do not wait for throttle)
    writeCaptureStateToStorage(currentCaptureState).catch(() => {});
    sendResponse({ ok: true });
    return false; // Synchronous response
  }

  if (message.type === "SET_CAPTURE_MODE") {
    captureMode = message.mode;
    console.log(`[background] Capture mode set to: ${captureMode}`);
    sendResponse({ ok: true });
    return false; // Synchronous response
  }

  if (message.type === "INJECT_IN_PAGE_SCRIPT") {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    // Path must match manifest.json web_accessible_resources declaration
    const fileName = "injected-script.js";

    if (tabId) {
      (async () => {
        let scriptContent = "";
        let diagnostics = "Diagnostics: ";
        try {
          // CONTROL TEST: Can we fetch manifest?
          try {
            const mUrl = chrome.runtime.getURL("manifest.json");
            const mResp = await fetch(mUrl);
            diagnostics += `Manifest: ${mResp.status} (${mUrl}); `;
          } catch (e) {
            diagnostics += `Manifest fetch failed: ${e}; `;
          }

          // Verify file exists and get content (DIAGNOSTICS ONLY - DO NOT BLOCK)
          const url = chrome.runtime.getURL(fileName);
          diagnostics += `Script URL: ${url}; `;

          try {
            const resp = await fetch(url);
            if (resp.ok) {
              scriptContent = await resp.text();
              console.log(
                `[background] Verified ${fileName} exists (${scriptContent.length} bytes)`
              );
              diagnostics += `Script: OK (${scriptContent.length}b)`;
            } else {
              console.warn(
                `[background] Failed to check ${fileName}: ${resp.status}`
              );
              diagnostics += `Script Fetch Status: ${resp.status}`;
            }
          } catch (fetchErr) {
            console.warn(
              `[background] Diagnostics fetch failed (non-critical):`,
              fetchErr
            );
            diagnostics += `Script Fetch Failed: ${
              fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
            }`;
          }

          // Try standard injection
          await chrome.scripting.executeScript({
            target: {
              tabId: tabId,
              frameIds: typeof frameId === "number" ? [frameId] : undefined,
            },
            world: "MAIN",
            files: [fileName],
          });

          sendResponse?.({ ok: true });
        } catch (err) {
          const params = err instanceof Error ? err.message : String(err);
          console.error("[INJECT] Failed via scripting.executeScript:", params);

          // Return the content as fallback if we have it, plus diagnostics
          sendResponse?.({
            ok: false,
            error: `${params} | ${diagnostics}`,
            fallbackCode: scriptContent,
          });
        }
      })();
      return true;
    }

    sendResponse?.({ ok: false, error: "Missing tab ID" });
    return false;
  }

  if (message.type === "TRIGGER_CAPTURE_FOR_TAB") {
    if (sender.tab?.id) {
      console.log(`🧪 [TEST] Triggering capture for tab ${sender.tab.id}`);
      console.log(`🧪 [TEST] Viewports:`, message.viewports);
      chrome.tabs.sendMessage(
        sender.tab.id,
        {
          type: "start-capture",
          allowNavigation: message.allowNavigation || false,
          viewports: message.viewports,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "❌ [TEST] Failed to send start-capture:",
              chrome.runtime.lastError
            );
          } else {
            console.log("✅ [TEST] Sent start-capture, response:", response);
          }
        }
      );
    } else {
      console.error("❌ [TEST] Sender has no tab ID");
    }
    return false;
  }

  if (message.type === "EXTRACTION_PROGRESS") {
    // Forward extraction progress from content script to other extension contexts (popup)
    if (sender.tab?.id) {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    }

    // PERSISTENCE FIX: Update background state so popup can resume
    broadcastCaptureState({
      isCapturing: true,
      stage: "extracting",
      progress: message.percent || 0,
      statusMessage: message.message || "Extracting page content...",
      // Don't flood logs with every percentage update, just keep the latest status
    });

    sendResponse?.({ ok: true });
    return false;
  }

  if (message.type === "CAPTURE_PROGRESS") {
    // Update capture state with progress
    broadcastCaptureState({
      isCapturing: true,
      stage: message.phase || message.stage || "capturing",
      progress: message.percent || message.progress || 0,
      statusMessage: message.message || message.status || "Capturing...",
      logs: [
        ...(currentCaptureState.logs || []),
        {
          timestamp: Date.now(),
          message: message.message || message.status || "Progress update",
          level: "info",
        },
      ].slice(-50), // Keep last 50 logs
    });

    // Relay capture progress (multi-viewport or step-level) to popup
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.type === "FETCH_ASSET") {
    (async () => {
      try {
        const { url } = message;
        if (!url) throw new Error("No URL provided");

        // Log for debugging
        if (url.includes("youtube") || url.includes("ytimg")) {
          console.log(`[FETCH_ASSET] Fetching YouTube asset: ${url}`);
        }

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        const mimeType = blob.type;
        const buffer = await blob.arrayBuffer();

        // Manual base64 conversion to avoid FileReader dependencies in Service Worker
        // (Use chunks to avoid stack overflow with String.fromCharCode(...spread))
        let binary = "";
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        const chunkSize = 8192;

        for (let i = 0; i < len; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
          binary += String.fromCharCode.apply(null, chunk as any);
        }

        const base64 = btoa(binary);
        const dataUrl = `data:${mimeType};base64,${base64}`;

        sendResponse({ ok: true, data: dataUrl, mimeType });
      } catch (error) {
        console.warn(`[FETCH_ASSET] Failed for ${message.url}:`, error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true; // async response
  }

  if (message.type === "START_CAPTURE" || message.type === "AUTOMATION_START_FULLPAGE_CAPTURE") {
    (async () => {
      try {
        let tabId = message.tabId;
        
        // Automation fallback: if no tabId provided, use the active tab
        if (!tabId) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = activeTab?.id;
          console.log(`[automation] No tabId provided, detected active tab: ${tabId}`);
        }

        const allowNavigation = Boolean(message.allowNavigation);
        const mode = message.mode; // 'full' or 'visual' (if applicable)

        if (!tabId) {
          throw new Error("No tab ID provided or detected");
        }

        console.log(`[capture] Starting ${message.type} for tab ${tabId}`);

        // Initialize capture state
        broadcastCaptureState({
          isCapturing: true,
          stage: "starting",
          progress: 0,
          statusMessage: "Starting capture...",
          startTime: Date.now(),
          tabId: tabId,
          logs: [
            {
              timestamp: Date.now(),
              message: "Capture started",
              level: "info",
            },
          ],
        });

        // Ensure content script is ready
        const isReady = await ensureContentScript(tabId);
        if (!isReady) {
          const errorMsg =
            "Please refresh the page to enable capture (extension updated).";
          console.warn("[capture] Aborting capture, content script not ready");

          // Update state to show error
          broadcastCaptureState({
            isCapturing: false,
            stage: "error",
            statusMessage: errorMsg,
            logs: [
              ...(currentCaptureState.logs || []),
              {
                timestamp: Date.now(),
                message: errorMsg,
                level: "error",
              },
            ],
          });

          sendResponse?.({ ok: false, error: errorMsg });
          chrome.runtime.sendMessage({
            type: "CAPTURE_ERROR",
            error: errorMsg,
          });
          return;
        }

        // Let popup know we're starting the in-tab capture flow
        chrome.runtime.sendMessage(
          {
            type: "CAPTURE_PROGRESS",
            phase: "Starting in-tab capture",
            progress: 10,
          },
          () => void chrome.runtime.lastError
        );

        // Relay capture request to the content script (triggers scroll, states, multi-viewport, chunking)
        // Target the main frame explicitly (frameId: 0) to avoid confusion with iframes
        console.log(
          `[capture] Sending start-capture to tab ${tabId} main frame`
        );
        chrome.tabs.sendMessage(
          tabId,
          {
            type: "start-capture",
            allowNavigation,
            viewports: message.viewports,
          },
          { frameId: 0 }, // Target main frame only
          (response) => {
            console.log(
              "[capture] sendMessage callback invoked, response:",
              response
            );
            console.log(
              "[capture] chrome.runtime.lastError:",
              chrome.runtime.lastError
            );

            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message || "Capture failed";
              console.error("[capture] start-capture failed:", msg);
              sendResponse?.({ ok: false, error: msg });
              return;
            }

            if (response && response.started === false) {
              const error = response.error || "Capture did not start";
              console.error("[capture] start-capture rejected:", error);
              sendResponse?.({ ok: false, error });
              return;
            }

            console.log("[capture] start-capture dispatched to tab");
            sendResponse?.({ ok: true });
          }
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        // Use centralized error reporting
        reportError("capture:send", error, {});
        chrome.runtime.sendMessage(
          {
            type: "CAPTURE_ERROR",
            error: errorMessage,
          },
          () => void chrome.runtime.lastError
        );
        sendResponse?.({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  if (message.type === "CAPTURE_ERROR") {
    console.error("[background] Received CAPTURE_ERROR:", message.error);

    // Update capture state to show error
    broadcastCaptureState({
      isCapturing: false,
      stage: "error",
      statusMessage: message.error || "Capture failed",
      logs: [
        ...(currentCaptureState.logs || []),
        {
          timestamp: Date.now(),
          message: message.error || "Capture failed",
          level: "error",
        },
      ],
    });

    // PERSISTENCE FIX: Update background state to reflect error
    broadcastCaptureState({
      isCapturing: false, // Stop capturing on error
      stage: "error",
      statusMessage: message.error || "Capture failed",
      logs: [
        ...(currentCaptureState.logs || []),
        {
          timestamp: Date.now(),
          message: message.error || "Capture failed",
          level: "error",
        },
      ],
    });

    // Forward to popup/other extension contexts so UI can update
    if (sender.tab?.id) {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    }
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Capture Failed",
      message: message.error || "An unknown error occurred during capture.",
      priority: 2,
    });
    return false;
  }

  if (message.type === "CAPTURE_VISIBLE_TAB") {
    // PHASE 5: Native browser screenshot for element rasterization
    // This is the PRIMARY capture method for pixel-perfect accuracy
    (async () => {
      try {
        if (!sender.tab?.id) {
          sendResponse({ ok: false, error: "No tab ID" });
          return;
        }

        // Capture full visible viewport
        const dataUrl = await chrome.tabs.captureVisibleTab(
          sender.tab.windowId,
          { format: "png" }
        );

        if (!dataUrl) {
          sendResponse({ ok: false, error: "Screenshot capture failed" });
          return;
        }

        // Send back to content script for cropping
        sendResponse({ ok: true, dataUrl });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[PHASE 5] captureVisibleTab failed:", errorMsg);
        sendResponse({ ok: false, error: errorMsg });
      }
    })();
    return true; // Async response
  }

  if (message.type === "CAPTURE_CDP_CLIP") {
    // Pixel-perfect clip screenshot using Chrome DevTools Protocol (no scrolling required).
    // Requires "debugger" permission in manifest.
    (async () => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "No tab ID" });
        return;
      }

      try {
        const target = { tabId };

        // Attach CDP
        await chrome.debugger.attach(target, "1.3");

        // Capture clip
        const clip = message.clip;
        if (
          !clip ||
          typeof clip.x !== "number" ||
          typeof clip.y !== "number" ||
          typeof clip.width !== "number" ||
          typeof clip.height !== "number"
        ) {
          sendResponse({ ok: false, error: "Invalid clip" });
          return;
        }

        const result = (await chrome.debugger.sendCommand(
          target,
          "Page.captureScreenshot",
          {
            format: "png",
            // CDP clip is in CSS pixels in page coordinates; scale=1 keeps 1 CSS px.
            // Chrome will encode at the current device scale factor for the tab.
            clip: {
              x: clip.x,
              y: clip.y,
              width: clip.width,
              height: clip.height,
              scale: typeof clip.scale === "number" ? clip.scale : 1,
            },
            captureBeyondViewport: true,
          }
        )) as { data: string };

        if (!result?.data) {
          sendResponse({
            ok: false,
            error: "CDP screenshot returned empty data",
          });
          return;
        }

        sendResponse({
          ok: true,
          dataUrl: `data:image/png;base64,${result.data}`,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[CDP] captureScreenshot failed:", errorMsg);
        sendResponse({ ok: false, error: errorMsg });
      } finally {
        try {
          if (sender.tab?.id) {
            await chrome.debugger.detach({ tabId: sender.tab.id });
          }
        } catch {
          // ignore detach errors
        }
      }
    })();
    return true;
  }

  if (message.type === "LOG_TO_SERVER") {
    const { message: msg, data } = message;
    // Send to handoff server
    fetch(`${currentHandoffBase()}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, data }),
    }).catch(() => {}); // Ignore errors
    return false;
  }

  if (message.type === "REMOTE_CAPTURE_REQUEST") {
    (async () => {
      try {
        const targetUrl = message.targetUrl;
        if (!targetUrl) {
          throw new Error("Missing target URL");
        }
        const captureHeaders: Record<string, string> = withHandoffAuthHeaders({
          "Content-Type": "application/json",
        });

        // Add API key for cloud service
        if (CLOUD_CAPTURE_URL && CLOUD_API_KEY) {
          captureHeaders["x-api-key"] = CLOUD_API_KEY;
        }

        const response = await fetch(handoffEndpoint("/api/capture"), {
          method: "POST",
          headers: captureHeaders,
          body: JSON.stringify({ url: targetUrl }),
        });
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }
        const body = await response.json();
        if (!body?.ok || !body.data) {
          throw new Error(body?.error || "Capture service failed");
        }
        updateLastCapturedPayload(body.data);
        const bodySize = JSON.stringify(body.data).length;
        chrome.runtime.sendMessage(
          {
            type: "CAPTURE_COMPLETE",
            hasData: true,
            validationReport: body.validationReport,
            previewWithOverlay: body.previewWithOverlay,
            dataSize: bodySize,
            dataSizeKB: (bodySize / 1024).toFixed(1),
          },
          () => void chrome.runtime.lastError
        );
        sendResponse({ ok: true, hasData: true, dataSize: bodySize });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Remote capture failed";
        console.error("Remote capture failed:", message);
        sendResponse({ ok: false, error: message });
      }
    })();
    return true;
  }
  if (message.type === "CAPTURE_COMPLETE") {
    const { data } = message as { data?: any };
    if (!data) {
      sendResponse?.({ ok: false, error: "No capture payload received" });
      return false;
    }

    // Update capture state to show completion
    broadcastCaptureState({
      isCapturing: true, // Still processing (sending to Figma)
      stage: "complete",
      progress: 95,
      statusMessage: "Capture complete, sending to Figma...",
      logs: [
        ...(currentCaptureState.logs || []),
        {
          timestamp: Date.now(),
          message: "Capture completed successfully",
          level: "success",
        },
      ],
    });

    const shouldDownloadOnly = captureDeliveryMode === "download";
    // For chunked transfers, the real payload lives in lastCapturedPayload (reassembled),
    // so use it preferentially to include full images.
    const payload =
      data && data.chunked && lastCapturedPayload ? lastCapturedPayload : data;

    updateLastCapturedPayload(payload);

    if (shouldDownloadOnly) {
      captureDeliveryMode = "send";
      chrome.runtime.sendMessage(
        {
          type: "CAPTURE_DOWNLOAD_READY",
          data: payload,
          dataSize: JSON.stringify(payload).length,
          dataSizeKB: (JSON.stringify(payload).length / 1024).toFixed(1),
        },
        () => void chrome.runtime.lastError
      );
      sendResponse?.({ ok: true, mode: "download" });
      return false;
    }

    const enqueueResult = enqueueHandoffJob(payload, "auto");
    if (!enqueueResult.enqueued) {
      console.warn(
        "[handoff] Suppressed auto enqueue:",
        enqueueResult.reason || "unknown"
      );
    }
    // Kick the queue immediately to avoid idle service worker delaying upload
    void processPendingJobs();
    captureDeliveryMode = "send";
    sendResponse?.({ ok: true, queued: pendingJobs.length });
    return false;
  }

  if (message.type === "SET_VIEWPORT") {
    (async () => {
      try {
        if (
          !sender.tab?.id ||
          typeof message.width !== "number" ||
          typeof message.height !== "number"
        ) {
          sendResponse?.({
            ok: false,
            error: "Missing tab or viewport dimensions",
          });
          return;
        }

        const tabId = sender.tab.id;
        const tabInfo = await chrome.tabs.get(tabId);
        if (!tabInfo.windowId) {
          sendResponse?.({ ok: false, error: "Tab has no associated window" });
          return;
        }

        const windowInfo = await chrome.windows.get(tabInfo.windowId);
        captureTabState[tabId] = captureTabState[tabId] || {
          windowId: tabInfo.windowId,
        };

        if (!captureTabState[tabId].originalBounds) {
          captureTabState[tabId].originalBounds = {
            width: windowInfo.width,
            height: windowInfo.height,
            left: windowInfo.left,
            top: windowInfo.top,
          };
        }

        const desiredWidth = Math.max(
          320,
          Math.round(message.width + WINDOW_FRAME_FUDGE.width)
        );
        const desiredHeight = Math.max(
          200,
          Math.round(message.height + WINDOW_FRAME_FUDGE.height)
        );

        await chrome.windows.update(tabInfo.windowId, {
          width: desiredWidth,
          height: desiredHeight,
        });

        captureTabState[tabId].appliedViewport = {
          width: message.width,
          height: message.height,
        };
        sendResponse?.({ ok: true });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to resize viewport";
        console.error("Viewport resize failed:", errorMessage);
        sendResponse?.({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  if (message.type === "RESET_VIEWPORT") {
    (async () => {
      try {
        if (!sender.tab?.id) {
          sendResponse?.({
            ok: false,
            error: "Missing tab context to reset viewport",
          });
          return;
        }
        const tabId = sender.tab.id;
        const state = captureTabState[tabId];
        if (!state || !state.originalBounds) {
          sendResponse?.({ ok: true });
          return;
        }

        const updateInfo: chrome.windows.UpdateInfo = {};
        if (typeof state.originalBounds.width === "number") {
          updateInfo.width = Math.round(state.originalBounds.width);
        }
        if (typeof state.originalBounds.height === "number") {
          updateInfo.height = Math.round(state.originalBounds.height);
        }
        if (typeof state.originalBounds.left === "number") {
          updateInfo.left = Math.round(state.originalBounds.left);
        }
        if (typeof state.originalBounds.top === "number") {
          updateInfo.top = Math.round(state.originalBounds.top);
        }

        await chrome.windows.update(state.windowId, updateInfo);
        delete captureTabState[tabId];
        sendResponse?.({ ok: true });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to reset viewport";
        console.error("Viewport reset failed:", errorMessage);
        sendResponse?.({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  // Manual send to handoff (triggered by popup "Send to Figma" button)
  if (message.type === "SEND_TO_HANDOFF") {
    const { data, force } = message as { data?: any; force?: boolean };
    // Use provided data or fall back to cached payload (critical for chunked transfers)
    const payload = data || lastCapturedPayload;

    if (!payload) {
      console.error(
        "❌ SEND_TO_HANDOFF failed: No capture data available (neither in message nor cache)"
      );
      sendResponse({ ok: false, error: "No capture data available" });
      return false;
    }

    (async () => {
      try {
        // If we're using cached payload, make sure we update it if new data came in (though unlikely here)
        if (data) updateLastCapturedPayload(data);

        // If the payload is a raw JSON string wrapper, parse it before enqueueing
        let parsedPayload = payload;
        if (payload && typeof payload === "object" && payload.rawSchemaJson) {
          try {
            parsedPayload =
              typeof payload.rawSchemaJson === "string"
                ? JSON.parse(payload.rawSchemaJson)
                : payload.rawSchemaJson;
          } catch (e) {
            console.error(
              "❌ Failed to parse rawSchemaJson for handoff, using raw string",
              e
            );
            parsedPayload = payload;
          }
        }

        const enqueueResult = enqueueHandoffJob(parsedPayload, "manual", {
          force: Boolean(force),
        });
        if (!enqueueResult.enqueued && enqueueResult.reason === "duplicate") {
          sendResponse({
            ok: true,
            duplicate: true,
            queued: pendingJobs.length,
          });
          return;
        }
        sendResponse({ ok: true, queued: pendingJobs.length });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error("❌ Failed to send to handoff:", errorMessage);
        sendResponse({ ok: false, error: errorMessage });
      }
    })();

    return true;
  }

  // Trigger download of cached payload (for chunked transfers where content script doesn't have data)
  if (message.type === "TRIGGER_DOWNLOAD") {
    // Use data from message if provided (non-chunked), otherwise use cached payload (chunked)
    const dataToDownload = (message as any).captureData || lastCapturedPayload;

    if (!dataToDownload) {
      sendResponse({ ok: false, error: "No captured data to download" });
      return false;
    }

    (async () => {
      try {
        console.log("💾 Triggering background download...");

        // Prepare data for download
        let jsonString: string;
        let wasStripped = false;

        // Check if it's a raw wrapper from chunked reassembly
        if (
          typeof dataToDownload.rawSchemaJson === "string" &&
          dataToDownload.rawSchemaJson.length > 0
        ) {
          console.log("⚡ Using raw JSON string for download (zero-copy)");
          jsonString = dataToDownload.rawSchemaJson;
        } else {
          console.log("📦 Stringifying payload for download");

          try {
            // Pretty-print for non-chunked data, avoid for chunked (large payloads)
            const isChunked = dataToDownload.chunked;
            jsonString = isChunked
              ? JSON.stringify(dataToDownload)
              : JSON.stringify(dataToDownload, null, 2);
          } catch (stringifyError) {
            // Handle "Invalid string length" error by stripping large binary data
            const errMsg =
              stringifyError instanceof Error
                ? stringifyError.message
                : String(stringifyError);
            if (
              errMsg.includes("Invalid string length") ||
              errMsg.includes("string length")
            ) {
              console.warn(
                "⚠️ Payload too large to stringify directly, stripping binary data..."
              );

              // Create a lightweight copy without huge binary data
              const lightPayload =
                stripLargeBinaryDataForDownload(dataToDownload);
              wasStripped = true;

              try {
                jsonString = JSON.stringify(lightPayload, null, 2);
                console.log(`✅ Successfully stringified stripped payload`);
              } catch (secondError) {
                // If still failing, try without pretty-print
                console.warn("⚠️ Retrying without pretty-print...");
                jsonString = JSON.stringify(lightPayload);
              }
            } else {
              throw stringifyError;
            }
          }
        }

        const filename = wasStripped
          ? `page-capture-${Date.now()}-stripped.json`
          : `page-capture-${Date.now()}.json`;

        const dl = await downloadTextFile({
          text: jsonString,
          filename,
          mimeType: "application/json",
          saveAs: true,
        });

        console.log(
          `✅ Download initiated: ${dl.filename} (${(
            jsonString.length /
            1024 /
            1024
          ).toFixed(2)}MB${dl.compressed ? ", gzipped" : ""}${
            wasStripped ? ", stripped" : ""
          })`
        );
        sendResponse({
          ok: true,
          filename: dl.filename,
          compressed: dl.compressed,
          stripped: wasStripped,
          strippedNote: wasStripped
            ? "Large binary data (screenshot, images) was stripped to reduce file size"
            : undefined,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Download failed";
        console.error("❌ Background download failed:", errorMessage);
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  // CORS-free image fetching via background script
  if (message.type === "FETCH_IMAGE") {
    const { url } = message as { url?: string };
    if (!url) {
      sendResponse({ ok: false, error: "Missing URL" });
      return false;
    }

    (async () => {
      try {
        console.log(`🖼️ Attempting to fetch image: ${url}`);

        const looksLikeImageUrl = (value: string): boolean =>
          /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(value);

        const uint8ToBase64 = (bytes: Uint8Array): string => {
          // Safe Uint8Array -> base64 conversion for large payloads.
          const CHUNK_SIZE = 0x8000; // 32k chunks
          const chunks: string[] = [];
          for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            chunks.push(
              String.fromCharCode.apply(
                null,
                Array.from(bytes.subarray(i, i + CHUNK_SIZE))
              )
            );
          }
          return btoa(chunks.join(""));
        };

        // Add timeout and better error handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            // Prefer formats that Figma can reliably ingest without extra transcoding work.
            // (Many CDNs will serve AVIF when requested, but Figma createImage does not support AVIF.)
            Accept:
              "image/webp,image/png,image/jpeg,image/apng,image/svg+xml,*/*;q=0.8",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.startsWith("image/") && !looksLikeImageUrl(url)) {
          throw new Error(`Not an image: ${contentType || "unknown"}`);
        }

        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Check size (base64 expansion ~4/3).
        if (bytes.length > 10 * 1024 * 1024) {
          // 10MB limit
          throw new Error(
            `Image too large: ${(bytes.length / 1024 / 1024).toFixed(1)}MB`
          );
        }

        const base64 = uint8ToBase64(bytes);
        console.log(
          `✅ Image fetched successfully: ${url} (${(
            bytes.length / 1024
          ).toFixed(1)}KB)`
        );
        sendResponse({
          ok: true,
          base64,
          mimeType: contentType || undefined,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Fetch failed";
        const domain = extractDomainFromImageUrl(url);
        const isKnownProblematic = isKnownProblematicDomain(domain);

        if (isKnownProblematic) {
          console.log(
            `🚫 Expected failure from known blocked domain: ${domain}`
          );
        } else {
          console.error(`❌ Failed to fetch image asset ${url}`, errorMessage);
        }

        // Provide domain-specific error information
        let detailedError = errorMessage;
        if (isKnownProblematic) {
          detailedError = `${domain} blocks cross-origin requests (known restriction)`;
        } else if (errorMessage.includes("CORS")) {
          detailedError =
            "CORS blocked - server does not allow cross-origin requests";
        } else if (errorMessage.includes("NetworkError")) {
          detailedError = "Network error - image server may be unreachable";
        } else if (errorMessage.includes("AbortError")) {
          detailedError = "Request timeout - image took too long to load";
        }

        sendResponse({
          ok: false,
          error: detailedError,
          knownBlocked: isKnownProblematic,
        });
      }
    })();
    return true;
  }

  // CDP-based capture removed in favor of Direct DOM Extraction
  if (message.type === "CAPTURE_CDP") {
    sendResponse({
      ok: false,
      error: "CDP capture is deprecated. Please use Direct DOM Extraction.",
    });
    return false;
  }

  if (message.type === "CAPTURE_SCREENSHOT") {
    // Fallback to visible tab capture if needed, or deprecate
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          screenshot: "",
          error: chrome.runtime.lastError.message,
        });
      } else {
        sendResponse({ screenshot: dataUrl });
      }
    });
    return true;
  }

  if (message.type === "HANDOFF_HEALTH_CHECK") {
    (async () => {
      try {
        const healthHeaders: Record<string, string> = withHandoffAuthHeaders({
          "cache-control": "no-cache",
        });

        // Add API key for cloud service
        if (CLOUD_CAPTURE_URL && CLOUD_API_KEY) {
          healthHeaders["x-api-key"] = CLOUD_API_KEY;
        }

        const response = await fetch(handoffEndpoint("/api/health"), {
          headers: healthHeaders,
        });
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }
        const body = await response.json();
        sendResponse({ ok: true, health: body });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Health check failed";
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  if (message.type === "GET_HANDOFF_STATE") {
    sendResponse({
      ok: true,
      state: handoffState,
      hasCapture: Boolean(lastCapturedPayload),
    });
    return false;
  }

  // Handle chunked capture data
  if (message.type === "CAPTURE_CHUNKED_START") {
    const { totalChunks, totalSize, totalSizeKB } = message;
    console.log(
      `📦 Starting chunked capture: ${totalChunks} chunks, ${totalSizeKB}KB total`
    );

    // Reset buffer for new chunked transfer
    chunkedDataBuffer = new Array(totalChunks);
    expectedChunks = totalChunks;
    receivedChunks = 0;

    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "CAPTURE_CHUNKED_DATA") {
    const { chunkIndex, chunkData, totalChunks } = message;

    if (chunkIndex >= 0 && chunkIndex < expectedChunks) {
      // Only count this chunk if we haven't received it before
      const isNewChunk = !chunkedDataBuffer[chunkIndex];
      chunkedDataBuffer[chunkIndex] = chunkData;
      if (isNewChunk) {
        receivedChunks++;
      }

      console.log(
        `📦 Received chunk ${
          chunkIndex + 1
        }/${totalChunks} (${receivedChunks}/${expectedChunks} total)${
          isNewChunk ? "" : " [DUPLICATE]"
        }`
      );
      sendResponse({
        ok: true,
        received: receivedChunks,
        expected: expectedChunks,
      });
    } else {
      sendResponse({ ok: false, error: `Invalid chunk index: ${chunkIndex}` });
    }
    return false;
  }

  if (message.type === "CAPTURE_CHUNKED_COMPLETE") {
    const { totalChunks } = message;

    if (receivedChunks !== expectedChunks) {
      const error = `Incomplete chunked transfer: received ${receivedChunks}/${expectedChunks} chunks`;
      console.error("❌", error);
      sendResponse({ ok: false, error });
      return false;
    }

    try {
      // Reassemble the complete JSON string
      console.log(`🧩 Reassembling ${totalChunks} chunks...`);
      const completeJsonString = chunkedDataBuffer.join("");

      // Parse once so downstream always has a proper object/schema and avoid sending huge messages to popup
      let parsedData: any = null;
      try {
        parsedData = JSON.parse(completeJsonString);
        // Safety: strip embedded font payloads early to avoid huge in-memory objects/messages.
        try {
          const stripped = stripInlineFontData(parsedData);
          if (stripped.stripped > 0 || stripped.strippedDataUrls > 0) {
            console.log("[CHUNKED] Stripped inline font payloads:", stripped);
          }
        } catch {
          // ignore
        }
        updateLastCapturedPayload(parsedData);
      } catch (parseErr) {
        console.error("❌ Failed to parse reassembled payload", parseErr);
        // CRITICAL FIX: Pass the raw string wrapper so we can try to send it anyway
        // (The plugin might be able to parse it, or we can debug the string later)
        parsedData = { rawSchemaJson: completeJsonString };
        updateLastCapturedPayload(parsedData);
      }

      // Notify UI with a lightweight message (no raw payload to avoid message size errors)
      chrome.runtime.sendMessage(
        {
          type: "CAPTURE_COMPLETE",
          data: null, // keep message small
          dataSize: completeJsonString.length,
          dataSizeKB: (completeJsonString.length / 1024).toFixed(1),
          chunked: true,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );

      // Clean up chunk buffers
      chunkedDataBuffer = [];
      expectedChunks = 0;
      receivedChunks = 0;

      // Store and queue for handoff
      const shouldDownloadOnly = captureDeliveryMode === "download";

      if (shouldDownloadOnly) {
        captureDeliveryMode = "send";
        chrome.runtime.sendMessage(
          {
            type: "CAPTURE_DOWNLOAD_READY",
            data: parsedData,
            dataSize: completeJsonString.length,
            dataSizeKB: (completeJsonString.length / 1024).toFixed(1),
            chunked: true,
          },
          () => void chrome.runtime.lastError
        );
      } else {
        console.log("🚀 Enqueuing parsed job for handoff...");
        lastCapturedPayload = parsedData;
        const enqueueResult = enqueueHandoffJob(parsedData, "auto");
        if (!enqueueResult.enqueued) {
          console.warn(
            "[handoff] Suppressed auto enqueue (chunked):",
            enqueueResult.reason || "unknown"
          );
        }

        sendResponse({ ok: true });
        return false;
      }

      sendResponse({
        ok: true,
        queued: pendingJobs.length,
        mode: shouldDownloadOnly ? "download" : "send",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to reassemble chunked data";
      console.error("❌ Chunked reassembly failed:", errorMessage);
      sendResponse({ ok: false, error: errorMessage });
    }
    return false;
  }

  // Default: no special handling, allow other listeners to run
  return false;
});

// Lightweight heartbeat so the handoff server and Figma plugin see the extension as connected.
// Use alarms so the MV3 service worker wakes up periodically.
const HEARTBEAT_ALARM = "handoff-heartbeat";

let heartbeatScheduled = false;
let heartbeatConsecutiveFailures = 0;
let heartbeatLastOk: boolean | null = null;
let heartbeatLastLogAt = 0;
const HEARTBEAT_LOG_COOLDOWN_MS = 30000;

function shouldLogHeartbeat(now: number): boolean {
  if (now - heartbeatLastLogAt > HEARTBEAT_LOG_COOLDOWN_MS) return true;
  return false;
}

async function pingHandoffHealth() {
  const baseBefore = currentHandoffBase();
  let timeoutId: any = null;
  try {
    // Use 127.0.0.1 to avoid localhost resolution issues
    const heartbeatEndpoint = `${currentHandoffBase()}/api/extension/heartbeat`;
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(heartbeatEndpoint, {
      method: "POST",
      headers: withHandoffAuthHeaders({
        "Content-Type": "application/json",
        "cache-control": "no-cache",
      }),
      body: JSON.stringify({
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        timestamp: Date.now(),
      }),
      signal: controller.signal,
    });
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;

    if (!response.ok) {
      heartbeatConsecutiveFailures++;
      const now = Date.now();
      if (heartbeatLastOk !== false || shouldLogHeartbeat(now)) {
        console.log(
          "[EXT_HEARTBEAT] Heartbeat failed with status",
          response.status
        );
        heartbeatLastLogAt = now;
      }
      heartbeatLastOk = false;
    } else {
      heartbeatConsecutiveFailures = 0;
      const now = Date.now();
      if (heartbeatLastOk !== true || shouldLogHeartbeat(now)) {
        console.log("[EXT_HEARTBEAT] Heartbeat success");
        heartbeatLastLogAt = now;
      }
      heartbeatLastOk = true;
    }
  } catch (error) {
    heartbeatConsecutiveFailures++;
    const message = error instanceof Error ? error.message : String(error);
    const now = Date.now();
    if (heartbeatLastOk !== false || shouldLogHeartbeat(now)) {
      console.log("[EXT_HEARTBEAT] Heartbeat failed:", message);
      heartbeatLastLogAt = now;
    }
    heartbeatLastOk = false;

    // Only rotate after repeated failures to avoid thrashing.
    if (heartbeatConsecutiveFailures >= 3) {
      rotateHandoffBase();
      heartbeatConsecutiveFailures = 0;
      console.log(
        "[EXT_HEARTBEAT] Switching handoff base from",
        baseBefore,
        "to",
        currentHandoffBase()
      );
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function scheduleHeartbeat() {
  if (heartbeatScheduled) return;
  heartbeatScheduled = true;
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.1 }); // ~6s cadence to satisfy UI TTL
}

chrome.runtime.onInstalled.addListener(() => {
  // void ensureSidePanelBehavior(); // Disabled - using normal popup
  scheduleHeartbeat();
  void pingHandoffHealth();
});

chrome.runtime.onStartup.addListener(() => {
  // void ensureSidePanelBehavior(); // Disabled - using normal popup
  scheduleHeartbeat();
  void pingHandoffHealth();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    void pingHandoffHealth();
  }
});

// Also start heartbeat when service worker loads
// void ensureSidePanelBehavior(); // Disabled - using normal popup
scheduleHeartbeat();
void pingHandoffHealth();

// Lightweight size estimator - avoids blocking JSON.stringify
/**
 * Strip large binary data from payload to enable download of oversized captures.
 * This removes screenshot and image asset bytes while preserving tree structure and metadata.
 * Used when JSON.stringify() fails with "Invalid string length" error.
 */
function stripLargeBinaryDataForDownload(payload: any): any {
  // Create a shallow copy to avoid mutating original
  const stripped: any = { ...payload };
  let bytesStripped = 0;

  // Strip top-level screenshot (can be 10MB+ on high-res pages)
  if (
    typeof stripped.screenshot === "string" &&
    stripped.screenshot.length > 1000
  ) {
    bytesStripped += stripped.screenshot.length;
    stripped.screenshot =
      "[STRIPPED - original size: " +
      Math.round(stripped.screenshot.length / 1024) +
      "KB]";
  }

  // Strip nested schema screenshot
  if (
    stripped.schema &&
    typeof stripped.schema.screenshot === "string" &&
    stripped.schema.screenshot.length > 1000
  ) {
    bytesStripped += stripped.schema.screenshot.length;
    stripped.schema = { ...stripped.schema };
    stripped.schema.screenshot =
      "[STRIPPED - original size: " +
      Math.round(stripped.schema.screenshot.length / 1024) +
      "KB]";
  }

  // Strip assets.images embedded bytes
  const images = stripped.assets?.images || stripped.schema?.assets?.images;
  if (images && typeof images === "object") {
    const processImages = (container: any, path: string) => {
      container[path] = container[path] || {};
      for (const [hash, img] of Object.entries(images as Record<string, any>)) {
        if (img && typeof img === "object") {
          // Create shallow copy of image asset
          const imgCopy = { ...img };

          // Strip embedded bytes (can be megabytes per image)
          if (
            typeof imgCopy.bytes === "string" &&
            imgCopy.bytes.length > 1000
          ) {
            bytesStripped += imgCopy.bytes.length;
            imgCopy.bytes = "[STRIPPED]";
            imgCopy.originalBytesSize =
              Math.round(imgCopy.bytes.length / 1024) + "KB";
          }

          // Strip inline-base64 bytes object
          if (
            imgCopy.bytes &&
            typeof imgCopy.bytes === "object" &&
            imgCopy.bytes.data
          ) {
            if (
              typeof imgCopy.bytes.data === "string" &&
              imgCopy.bytes.data.length > 1000
            ) {
              bytesStripped += imgCopy.bytes.data.length;
              imgCopy.bytes = {
                kind: "stripped",
                originalSize:
                  Math.round(imgCopy.bytes.data.length / 1024) + "KB",
              };
            }
          }

          // Replace in copy
          if (container[path]) {
            container[path][hash] = imgCopy;
          }
        }
      }
    };

    if (stripped.assets?.images) {
      stripped.assets = { ...stripped.assets };
      processImages(stripped.assets, "images");
    }
    if (stripped.schema?.assets?.images) {
      stripped.schema = { ...stripped.schema };
      stripped.schema.assets = { ...stripped.schema.assets };
      processImages(stripped.schema.assets, "images");
    }
  }

  // Strip font data URLs
  const fonts = stripped.assets?.fonts || stripped.schema?.assets?.fonts;
  if (fonts && typeof fonts === "object") {
    const processFonts = (container: any, path: string) => {
      container[path] = { ...container[path] };
      for (const [key, font] of Object.entries(fonts as Record<string, any>)) {
        if (font && typeof font === "object") {
          const fontCopy = { ...font };

          if (
            typeof fontCopy.data === "string" &&
            fontCopy.data.length > 1000
          ) {
            bytesStripped += fontCopy.data.length;
            fontCopy.data = "[STRIPPED]";
          }

          if (
            typeof fontCopy.url === "string" &&
            fontCopy.url.startsWith("data:") &&
            fontCopy.url.length > 1000
          ) {
            bytesStripped += fontCopy.url.length;
            fontCopy.url = "[DATA_URL_STRIPPED]";
          }

          container[path][key] = fontCopy;
        }
      }
    };

    if (stripped.assets?.fonts) {
      stripped.assets = { ...stripped.assets };
      processFonts(stripped.assets, "fonts");
    }
    if (stripped.schema?.assets?.fonts) {
      stripped.schema = { ...stripped.schema };
      stripped.schema.assets = { ...stripped.schema.assets };
      processFonts(stripped.schema.assets, "fonts");
    }
  }

  console.log(
    `📉 Stripped ~${Math.round(
      bytesStripped / 1024 / 1024
    )}MB of binary data for download`
  );

  // Add metadata about stripping
  stripped._downloadInfo = {
    strippedForDownload: true,
    bytesStripped: bytesStripped,
    strippedMB: Math.round(bytesStripped / 1024 / 1024),
    note: "Large binary data (screenshot, images, fonts) was stripped to enable download. Use 'Send to Figma' for full import.",
  };

  return stripped;
}

function estimatePayloadSize(payload: any): number {
  if (!payload) return 0;

  let bytes = 0;

  // Check for raw JSON string
  if (typeof payload.rawSchemaJson === "string") {
    return payload.rawSchemaJson.length;
  }

  // Estimate screenshot
  const screenshot = payload.screenshot || payload.schema?.screenshot;
  if (typeof screenshot === "string") {
    bytes += screenshot.length;
  }

  // Estimate images
  const images = payload.schema?.assets?.images || payload.assets?.images;
  if (images && typeof images === "object") {
    const entries = Object.values(images).slice(0, 50); // Sample
    for (const entry of entries) {
      const data = (entry as any)?.data || (entry as any)?.base64;
      if (typeof data === "string") {
        bytes += data.length;
      }
    }
    const totalImages = Object.keys(images).length;
    if (totalImages > 50) {
      bytes = bytes * (totalImages / 50);
    }
  }

  // Base estimate for tree and metadata
  bytes += 500 * 1024; // ~500KB baseline

  return bytes;
}

function stripInlineFontData(schema: any): {
  stripped: number;
  strippedDataUrls: number;
} {
  let stripped = 0;
  let strippedDataUrls = 0;
  try {
    const fonts = schema?.assets?.fonts;
    if (!fonts || typeof fonts !== "object")
      return { stripped, strippedDataUrls };

    for (const font of Object.values(fonts as Record<string, any>)) {
      if (!font || typeof font !== "object") continue;

      // Remove legacy inline font bytes (base64). Extremely large and not usable by Figma plugins.
      if (typeof (font as any).data === "string") {
        delete (font as any).data;
        stripped++;
      }
      const bytes = (font as any).bytes;
      if (
        bytes &&
        typeof bytes === "object" &&
        bytes.kind === "inline-base64"
      ) {
        delete (font as any).bytes;
        stripped++;
      }

      // Prevent massive data: URLs from being carried through the pipeline.
      if (typeof (font as any).url === "string") {
        const url = (font as any).url.trim();
        if (url.toLowerCase().startsWith("data:") && url.length > 2048) {
          (font as any).url = "";
          (font as any).urlWasData = true;
          (font as any).urlLength = url.length;
          strippedDataUrls++;
        }
      }
    }
  } catch {
    // Best-effort only
  }
  return { stripped, strippedDataUrls };
}

function optimizePayloadForTransfer(payload: any): any {
  // For large payloads or raw JSON strings, skip optimization to avoid blocking
  if (payload?.rawSchemaJson) {
    console.log(
      "⚡ Skipping optimization for raw JSON payload (already serialized)"
    );
    return payload;
  }

  // Quick size estimate to avoid expensive stringify
  const estimatedSize = estimatePayloadSize(payload);
  if (estimatedSize > 10 * 1024 * 1024) {
    // > 10MB
    console.log(
      `⚡ Skipping optimization for large payload (~${(
        estimatedSize /
        1024 /
        1024
      ).toFixed(1)}MB)`
    );
    return payload;
  }

  console.log("🔧 Optimizing payload for transfer...");

  // Create a deep copy to avoid mutating original
  const optimized = JSON.parse(JSON.stringify(payload ?? {}));

  const originalSize = JSON.stringify(optimized).length;
  const originalSizeMB = originalSize / (1024 * 1024);

  console.log(`📊 Original payload size: ${originalSizeMB.toFixed(2)}MB`);

  const sourceUrl = optimized.schema?.metadata?.url || "";
  const sourceDomain = extractDomainFromImageUrl(sourceUrl);
  const isComplexSite = isComplexMediaSite(sourceDomain);

  if (originalSizeMB < (isComplexSite ? 0.5 : 1)) {
    console.log(
      `✅ Payload is ${
        isComplexSite ? "acceptable for complex site" : "small"
      }, no optimization needed`
    );
    return optimized;
  }

  let optimizationCount = 0;

  // Optimize top-level screenshot if present
  if (optimized.screenshot) {
    optimized.screenshot = optimizeScreenshotDataUrl(optimized.screenshot);
    optimizationCount++;
  }

  // Optimize nested schema screenshot if present
  if (optimized.schema?.screenshot) {
    optimized.schema.screenshot = optimizeScreenshotDataUrl(
      optimized.schema.screenshot
    );
    optimizationCount++;
  }

  const strategy = getDomainSpecificOptimizationStrategy(sourceDomain);
  console.log(`📋 Using optimization strategy for ${sourceDomain}:`, strategy);

  if (optimized.schema?.assets) {
    optimizeAssets(optimized.schema.assets, strategy.assetThresholdKB);
    optimizationCount++;
  }

  if (optimized.schema?.styles) {
    optimizeStyles(
      optimized.schema.styles,
      strategy.maxColors,
      strategy.maxTextStyles
    );
    optimizationCount++;
  }

  const finalSize = JSON.stringify(optimized).length;
  const finalSizeMB = finalSize / (1024 * 1024);
  const reduction = ((originalSize - finalSize) / originalSize) * 100;

  console.log("🎯 Payload optimization complete:", {
    optimizations: optimizationCount,
    finalSizeMB: finalSizeMB.toFixed(2),
    reduction: reduction.toFixed(1) + "%",
  });

  return optimized;
}

function normalizeSchemaAndScreenshot(payload: any): {
  schema: any;
  screenshot?: string;
} {
  if (!payload || typeof payload !== "object") {
    return { schema: payload, screenshot: undefined };
  }

  // Case 1: Already { schema, screenshot }
  if ("schema" in payload && payload.schema) {
    let schema = payload.schema;
    const screenshot = payload.screenshot || schema?.screenshot;

    // CRITICAL FIX: Ensure schema has 'root' property (migrate from 'tree' if needed)
    if (schema.tree && !schema.root) {
      console.log("[NORMALIZE] Migrating 'tree' to 'root' in schema");
      schema.root = schema.tree;
      delete schema.tree;
    }

    const stripped = stripInlineFontData(schema);
    if (stripped.stripped > 0 || stripped.strippedDataUrls > 0) {
      console.log("[NORMALIZE] Stripped inline font payloads:", stripped);
    }

    return { schema, screenshot };
  }

  // Case 2: Multi-viewport wrapper from content script
  if (
    payload.multiViewport &&
    Array.isArray(payload.captures) &&
    payload.captures.length > 0
  ) {
    const captures = payload as {
      captures: Array<{ data: any; previewWithOverlay?: string }>;
    };
    const primary =
      captures.captures.find((c) => c?.data && (c.data.root || c.data.tree)) ||
      captures.captures[0];

    let schema = primary?.data || payload;
    const screenshot = primary?.previewWithOverlay || schema?.screenshot;

    // CRITICAL FIX: Ensure schema has 'root' property (migrate from 'tree' if needed)
    if (schema.tree && !schema.root) {
      console.log(
        "[NORMALIZE] Migrating 'tree' to 'root' in multi-viewport schema"
      );
      schema.root = schema.tree;
      delete schema.tree;
    }

    const stripped = stripInlineFontData(schema);
    if (stripped.stripped > 0 || stripped.strippedDataUrls > 0) {
      console.log("[NORMALIZE] Stripped inline font payloads:", stripped);
    }

    return { schema, screenshot };
  }

  // Case 3: Direct schema
  if (payload.root || payload.tree || payload.assets || payload.metadata) {
    let schema = payload;
    const screenshot = schema.screenshot;

    // CRITICAL FIX: Ensure schema has 'root' property (migrate from 'tree' if needed)
    if (schema.tree && !schema.root) {
      console.log("[NORMALIZE] Migrating 'tree' to 'root' in direct schema");
      schema.root = schema.tree;
      delete schema.tree;
    }

    const stripped = stripInlineFontData(schema);
    if (stripped.stripped > 0 || stripped.strippedDataUrls > 0) {
      console.log("[NORMALIZE] Stripped inline font payloads:", stripped);
    }

    return { schema, screenshot };
  }

  // Fallback
  let fallbackSchema = payload;
  if (fallbackSchema && typeof fallbackSchema === "object") {
    // CRITICAL FIX: Ensure fallback schema has 'root' property
    if (fallbackSchema.tree && !fallbackSchema.root) {
      console.log("[NORMALIZE] Migrating 'tree' to 'root' in fallback schema");
      fallbackSchema.root = fallbackSchema.tree;
      delete fallbackSchema.tree;
    }
  }
  const stripped = stripInlineFontData(fallbackSchema);
  if (stripped.stripped > 0 || stripped.strippedDataUrls > 0) {
    console.log("[NORMALIZE] Stripped inline font payloads:", stripped);
  }
  return { schema: fallbackSchema, screenshot: fallbackSchema?.screenshot };
}

function optimizeScreenshotDataUrl(dataUrl: string): string {
  if (!dataUrl || dataUrl.length < 1000) return dataUrl;

  try {
    // Compress JPEG further if it's very large
    if (dataUrl.startsWith("data:image/jpeg") && dataUrl.length > 500000) {
      // 500KB
      // Extract base64 part and calculate rough compression ratio needed
      const base64Part = dataUrl.split(",")[1];
      if (base64Part && base64Part.length > 400000) {
        // ~300KB of base64
        // For very large screenshots, we can reduce quality more aggressively
        console.log(
          "🖼️ Large screenshot detected, applying aggressive compression"
        );
        // REMOVED: Truncation logic that was corrupting images.
        // We now rely on chunking to handle large payloads.
      }
    }
    return dataUrl;
  } catch (error) {
    console.warn("⚠️ Screenshot optimization failed, using original:", error);
    return dataUrl;
  }
}

function optimizeAssets(assets: any, thresholdKB: number = 200) {
  if (!assets || typeof assets !== "object") return;

  let optimizedCount = 0;
  const thresholdBytes = thresholdKB * 1000; // Convert to bytes

  // Optimize images in asset registry
  Object.keys(assets).forEach((key) => {
    const asset = assets[key];
    if (asset && typeof asset === "object") {
      if (
        asset.data &&
        typeof asset.data === "string" &&
        asset.data.startsWith("data:image/")
      ) {
        const originalLength = asset.data.length;
        if (originalLength > thresholdBytes) {
          asset.data = optimizeScreenshotDataUrl(asset.data);
          if (asset.data.length < originalLength) {
            optimizedCount++;
          }
        }
      }
    }
  });

  if (optimizedCount > 0) {
    console.log(
      `🖼️ Optimized ${optimizedCount} large assets (threshold: ${thresholdKB}KB)`
    );
  }
}

function optimizeStyles(
  styles: any,
  maxColors: number = 500,
  maxTextStyles: number = 200
) {
  if (!styles || typeof styles !== "object") return;

  // Remove redundant or oversized style data
  if (styles.colors && Object.keys(styles.colors).length > maxColors) {
    console.log(
      `🎨 Large color palette detected, limiting to top ${maxColors} colors`
    );
    const colorEntries = Object.entries(styles.colors);
    const topColors = colorEntries
      .sort((a: any, b: any) => (b[1].count || 0) - (a[1].count || 0))
      .slice(0, maxColors);
    styles.colors = Object.fromEntries(topColors);
  }

  // Limit text styles if excessive
  if (
    styles.textStyles &&
    Object.keys(styles.textStyles).length > maxTextStyles
  ) {
    console.log(
      `📝 Large text style registry detected, limiting to top ${maxTextStyles}`
    );
    const textStyleEntries = Object.entries(styles.textStyles);
    const topTextStyles = textStyleEntries.slice(0, maxTextStyles);
    styles.textStyles = Object.fromEntries(topTextStyles);
  }
}

async function postToHandoffServer(payload: any): Promise<void> {
  let jsonPayload: string;
  let payloadSizeMB: number;

  // OPTIMIZATION: If payload is already a serialized JSON string (from chunked transfer),
  // use it directly to avoid expensive JSON.parse/stringify cycles.
  if (payload && typeof payload === "object" && payload.rawSchemaJson) {
    console.log("⚡ Using Zero-Parse forwarding for large payload");
    // Use the raw schema JSON directly (already stringified by the content script)
    jsonPayload =
      typeof payload.rawSchemaJson === "string"
        ? payload.rawSchemaJson
        : JSON.stringify(payload.rawSchemaJson);
    payloadSizeMB =
      new TextEncoder().encode(jsonPayload).length / (1024 * 1024);
  } else {
    // Standard processing for small/normal payloads
    const optimizedPayload = optimizePayloadForTransfer(payload);
    const { schema, screenshot } = normalizeSchemaAndScreenshot(
      optimizedPayload as any
    );

    // DIAGNOSTIC: Log a concise view of the schema so users can inspect images/layout
    try {
      const imageRegistry = schema?.assets?.images || {};
      const imageKeys = Object.keys(imageRegistry);
      const firstImageKey = imageKeys[0];
      const firstImage = firstImageKey
        ? imageRegistry[firstImageKey]
        : undefined;

      const rootNode = schema?.root || schema?.tree;
      const firstChild =
        rootNode?.children && rootNode.children.length > 0
          ? rootNode.children[0]
          : undefined;

      console.log("SCHEMA_DEBUG", {
        viewport: schema?.metadata?.viewport,
        imageCount: imageKeys.length,
        sampleImageKey: firstImageKey,
        sampleImage: firstImage
          ? {
              id: firstImage.id,
              url: firstImage.url,
              width: firstImage.width,
              height: firstImage.height,
              hasData:
                typeof firstImage.data === "string" &&
                firstImage.data.length > 0,
            }
          : null,
        rootType: rootNode?.type,
        rootName: rootNode?.name,
        sampleNode: firstChild
          ? {
              id: firstChild.id,
              type: firstChild.type,
              name: firstChild.name,
              layout: firstChild.layout,
              imageHash: firstChild.imageHash,
              imageAssetId: firstChild.imageAssetId,
              backgroundImageAssetId: firstChild.backgroundImageAssetId,
            }
          : null,
      });
    } catch (e) {
      console.warn("SCHEMA_DEBUG logging failed", e);
    }

    // Ensure screenshot is attached to schema if not already
    if (screenshot && !schema.screenshot) {
      schema.screenshot = screenshot;
    }

    // CRITICAL FIX: Ensure schema has 'root' property before sending
    if (schema.tree && !schema.root) {
      console.log("[POST] Migrating 'tree' to 'root' before sending");
      schema.root = schema.tree;
      delete schema.tree;
    }

    // Validate schema has root before sending
    if (!schema.root && !schema.tree) {
      console.error(
        "[POST] ❌ Schema missing both 'root' and 'tree' properties!"
      );
      console.error("[POST] Schema keys:", Object.keys(schema));
      throw new Error("Schema must have either 'root' or 'tree' property");
    }

    // Ensure metadata exists and set captureEngine to 'extension' for extension-captured data
    if (!schema.metadata) {
      schema.metadata = {};
    }
    // CRITICAL FIX: Always set captureEngine to 'extension' for extension-captured data
    // The content script incorrectly sets this to 'puppeteer', which causes the server to reject it
    schema.metadata.captureEngine = "extension";

    // PIXEL-PERFECT FIX: Log assets count before serialization
    const assetsCount = schema.assets?.images ? Object.keys(schema.assets.images).length : 0;
    const hasSvgs = schema.assets?.svgs ? Object.keys(schema.assets.svgs).length : 0;
    console.log(`📊 [BACKGROUND SERIALIZATION] About to serialize schema:`);
    console.log(`   - Images: ${assetsCount}`);
    console.log(`   - SVGs: ${hasSvgs}`);
    console.log(`   - Has assets object: ${!!schema.assets}`);
    console.log(`   - Has assets.images: ${!!schema.assets?.images}`);
    if (assetsCount === 0) {
      console.warn(`⚠️ [BACKGROUND SERIALIZATION] NO IMAGES IN ASSETS! Schema will be incomplete.`);
    }

    // Send schema directly, not wrapped in requestBody
    jsonPayload = JSON.stringify(schema);
    payloadSizeMB =
      new TextEncoder().encode(jsonPayload).length / (1024 * 1024);
  }

  // If mode is 'download', save to file instead of uploading
  if (captureMode === "download") {
    console.log("[capture] Mode is DOWNLOAD - saving to file...");

    try {
      const jsonString = jsonPayload; // Use the already prepared jsonPayload
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `capture-${timestamp}.json`;

      const dl = await downloadTextFile({
        text: jsonString,
        filename,
        mimeType: "application/json",
        saveAs: true,
      });

      console.log(
        `[capture] Download triggered: ${dl.filename} (${(
          jsonString.length /
          1024 /
          1024
        ).toFixed(2)}MB${dl.compressed ? ", gzipped" : ""})`
      );

      // Notify popup of success (metadata only)
      chrome.runtime.sendMessage({
        type: "CAPTURE_COMPLETE",
        hasData: true,
        dataSize: jsonString.length,
        dataSizeKB: (jsonString.length / 1024).toFixed(2),
      });

      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capture] Download failed:", msg);
      chrome.runtime.sendMessage({
        type: "CAPTURE_ERROR",
        error: "Failed to download capture file: " + msg,
      });
      return;
    }
  }

  // Otherwise, proceed with upload to server (existing logic)
  console.log("[capture] Mode is SEND - uploading to server...");
  console.log(`[BG][HANDOFF] Will attempt ${HANDOFF_BASES.length} server(s):`, HANDOFF_BASES);
  console.log(`[BG][HANDOFF] Current base index: ${handoffBaseIndex} → ${currentHandoffBase()}`);

  // Helper for remote logging
  const remoteLog = (msg: string, data?: any) => {
    fetch(handoffEndpoint("/api/log"), {
      method: "POST",
      headers: withHandoffAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message: msg, data }),
    }).catch(() => {});
  };

  remoteLog("Starting postToHandoffServer", { sizeMB: payloadSizeMB });

  // COMPRESSION: Compress the payload using pako (zlib)
  console.log(`📦 Compressing payload (${payloadSizeMB.toFixed(2)}MB)...`);
  remoteLog("Compressing payload...");

  let compressedBase64: string;
  try {
    const compressed = pako.deflate(jsonPayload);

    // Safe Uint8Array to Base64 conversion (avoids stack overflow)
    const CHUNK_SIZE = 0x8000; // 32k chunks
    const chunks = [];
    for (let i = 0; i < compressed.length; i += CHUNK_SIZE) {
      chunks.push(
        String.fromCharCode.apply(
          null,
          Array.from(compressed.subarray(i, i + CHUNK_SIZE))
        )
      );
    }
    compressedBase64 = btoa(chunks.join(""));
  } catch (err) {
    console.error("Compression failed:", err);
    remoteLog("Compression failed", String(err));
    throw new Error("Failed to compress payload: " + String(err));
  }

  const finalPayload = {
    compressed: true,
    data: compressedBase64,
  };

  const compressedSizeMB = compressedBase64.length / (1024 * 1024);
  console.log(
    `📦 Compression complete: ${payloadSizeMB.toFixed(
      2
    )}MB -> ${compressedSizeMB.toFixed(2)}MB`
  );
  remoteLog("Compression complete", { compressedSizeMB });

  console.log(`🚀 Sending payload to ${handoffEndpoint("/api/jobs")}...`);
  remoteLog("Sending payload to server...");

  if (payloadSizeMB > 50) {
    console.warn(`⚠️ Large payload detected: ${payloadSizeMB.toFixed(2)}MB`);
  }

  const headers: Record<string, string> = withHandoffAuthHeaders({
    "Content-Type": "application/json",
  });

  if (CLOUD_CAPTURE_URL && CLOUD_API_KEY) {
    headers["x-api-key"] = CLOUD_API_KEY;
  }

  let lastError: Error | null = null;
  const attemptErrors: Array<{ target: string; error: string }> = [];

  for (let attempt = 0; attempt < HANDOFF_BASES.length; attempt++) {
    // Try each configured base in order; advance index so helpers like handoffEndpoint() stay in sync
    handoffBaseIndex = attempt;
    const target = handoffEndpoint("/api/jobs");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s per attempt (increased for large payloads)

    console.log(`[BG][HANDOFF] 🔄 Attempt ${attempt + 1}/${HANDOFF_BASES.length}: ${target}`);

    try {
      console.log(`[BG][HANDOFF] Sending POST request to ${target}...`);
      const response = await fetch(target, {
        method: "POST",
        headers,
        body: JSON.stringify(finalPayload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      console.log(`[BG][HANDOFF] Response received: status=${response.status} ${response.statusText}`);

      if (!response.ok) {
        if (response.status === 413) {
          throw new Error(
            `Payload too large (${payloadSizeMB.toFixed(
              2
            )}MB). Try capturing a smaller page or fewer viewport sizes.`
          );
        }
        const errorText = await response.text();
        throw new Error(
          `Server responded with ${response.status}: ${errorText}`
        );
      }

      // Success - reset to primary port for future requests
      const responseBody = await response.json();
      console.log(`[BG][HANDOFF] ✅ Successfully sent to ${target}`);
      console.log(`[BG][HANDOFF] Server response:`, responseBody);
      remoteLog(`[handoff] ✅ Successfully sent to ${target}`, responseBody);
      resetHandoffToPrimary();
      return;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMsg = lastError.message;

      // Track this attempt's failure
      attemptErrors.push({ target, error: errorMsg });

      console.warn(
        `[BG][HANDOFF] ❌ Attempt ${attempt + 1}/${HANDOFF_BASES.length} failed for ${target}:`,
        errorMsg
      );
      remoteLog(
        `[BG][HANDOFF] ❌ Attempt ${attempt + 1}/${HANDOFF_BASES.length} failed: ${errorMsg}`
      );

      // Don't rotate if this was the last attempt
      if (attempt < HANDOFF_BASES.length - 1) {
        rotateHandoffBase();
      }
    }
  }

  // ENHANCED: All attempts failed - provide detailed diagnostics
  if (lastError) {
    console.error(`[BG][HANDOFF] ❌ All ${HANDOFF_BASES.length} server(s) failed!`);
    console.error("[BG][HANDOFF] Detailed failure log:");
    attemptErrors.forEach(({ target, error }, i) => {
      console.error(`  ${i + 1}. ${target}: ${error}`);
    });

    remoteLog(`[BG][HANDOFF] ❌ All servers failed`, { attemptErrors });

    // Provide user-friendly error message with troubleshooting steps
    const diagnosticMsg = `Connection failed to all ${HANDOFF_BASES.length} server(s).\n\n` +
      `Attempted servers:\n${attemptErrors.map(({ target, error }) => `• ${target}\n  Error: ${error}`).join('\n\n')}\n\n` +
      `Troubleshooting:\n` +
      `1. Check that the handoff server is running (run start.sh)\n` +
      `2. Verify no firewall is blocking port ${HANDOFF_PORT}\n` +
      `3. Check server logs for errors`;

    throw new Error(diagnosticMsg);
  }
}

function extractDomainFromImageUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace("www.", "");
  } catch (error) {
    return "unknown";
  }
}

function isKnownProblematicDomain(domain: string): boolean {
  const problematicDomains = [
    "img.cdno.my.id",
    "images.ctfassets.net",
    "ctfassets.net",
    "i.ytimg.com",
    "yt3.ggpht.com",
    "static.cdno.my.id",
    "secure.gravatar.com",
    "photos.google.com",
    "lh3.googleusercontent.com",
    "fbcdn.net",
    "instagramstatic-a.akamaihd.net",
    "cdno.my.id",
    // Financial and trading platforms
    "login-assets.tradestation.com",
    "cdn.tradestation.com",
    "assets.tradestation.com",
    "static.tradestation.com",
    // Advertising networks
    "secure.adnxs.com",
    "cdn.adnxs.com",
    "ib.adnxs.com",
    "static.adsystem.com",
    "securepubads.g.doubleclick.net",
    "googleads.g.doubleclick.net",
    // Additional CDNs and secure domains
    "assets.adobedtm.com",
    "secure.quantserve.com",
    "sb.scorecardresearch.com",
    "connect.facebook.net",
    "platform.twitter.com",
  ];

  return problematicDomains.some((problematic) =>
    domain.toLowerCase().includes(problematic.toLowerCase())
  );
}

function isComplexMediaSite(domain: string): boolean {
  const complexMediaSites = [
    "youtube.com",
    "netflix.com",
    "hulu.com",
    "disney.com",
    "amazon.com",
    "twitch.tv",
    "vimeo.com",
    "dailymotion.com",
    "cdno.my.id",
    "imgur.com",
    "flickr.com",
    "instagram.com",
    "facebook.com",
    "tiktok.com",
    // Financial and trading platforms (complex UIs with many assets)
    "tradestation.com",
    "robinhood.com",
    "etrade.com",
    "schwab.com",
    "fidelity.com",
    "tdameritrade.com",
    "interactive brokers.com",
    "tradingview.com",
  ];

  return complexMediaSites.some((complex) =>
    domain.toLowerCase().includes(complex.toLowerCase())
  );
}

function getDomainSpecificOptimizationStrategy(domain: string): {
  maxColors: number;
  maxTextStyles: number;
  screenshotQuality: number;
  assetThresholdKB: number;
} {
  // Default strategy
  let strategy = {
    maxColors: 500,
    maxTextStyles: 200,
    screenshotQuality: 0.75,
    assetThresholdKB: 200,
  };

  // More aggressive for complex media sites
  if (isComplexMediaSite(domain)) {
    strategy = {
      maxColors: 300,
      maxTextStyles: 100,
      screenshotQuality: 0.6,
      assetThresholdKB: 100,
    };
    console.log(
      `🎯 Using aggressive optimization for complex media site: ${domain}`
    );
  }

  // Special handling for known problematic domains
  if (isKnownProblematicDomain(domain)) {
    strategy = {
      maxColors: 200,
      maxTextStyles: 50,
      screenshotQuality: 0.5,
      assetThresholdKB: 50,
    };
    console.log(
      `⚡ Using ultra-aggressive optimization for problematic domain: ${domain}`
    );
  }

  return strategy;
}

function broadcastHandoffState() {
  try {
    chrome.runtime.sendMessage(
      {
        type: "HANDOFF_STATUS_UPDATE",
        state: handoffState,
        hasCapture: Boolean(lastCapturedPayload),
      },
      () => {
        // Ignore missing listeners
        void chrome.runtime.lastError;
      }
    );
  } catch (error) {
    console.warn("Failed to broadcast handoff state", error);
  }
}

function enqueueHandoffJob(
  payload: any,
  trigger: HandoffTrigger,
  options?: { force?: boolean }
): { enqueued: boolean; reason?: "duplicate" | "invalid" } {
  console.log(`[BG][HANDOFF] Enqueueing job (trigger=${trigger}, force=${options?.force || false})`);

  // --- PREFLIGHT CHECK ---
  try {
    console.log("[BG][PREFLIGHT] Starting schema validation...");
    const preflight = normalizeAndPreflight(payload);
    if (!preflight.ok) {
      console.error("[BG][PREFLIGHT] FAILED", {
        fatal: preflight.fatalCount,
        warnings: preflight.warnCount,
        issues: preflight.issues.filter((i) => i.severity === "FATAL"),
      });
      // Broadcast failure to UI
      chrome.runtime.sendMessage(
        {
          type: "PREFLIGHT_FAILURE",
          result: preflight,
        },
        () => void chrome.runtime.lastError
      );

      if (PREFLIGHT_BLOCKING_MODE) {
        console.warn("[BG][PREFLIGHT] Blocking invalid job enqueue (PREFLIGHT_BLOCKING_MODE=true).");
        return { enqueued: false, reason: "invalid" };
      }
    } else if (preflight.warnCount > 0) {
      console.warn(
        "[BG][PREFLIGHT] Warnings detected",
        preflight.issues.filter((i) => i.severity === "WARN")
      );
    } else {
      console.log("[BG][PREFLIGHT] ✅ Schema validation passed");
    }
  } catch (err) {
    console.error("[BG][PREFLIGHT] ERROR - validation crashed:", err);
    // Don't block on preflight crash, just log
  }
  // -----------------------

  const now = Date.now();
  pruneRecentCaptureIds(now);

  const captureId = getCaptureIdFromPayload(payload);
  if (captureId) {
    const lastSeen = recentCaptureIds.get(captureId);
    const isDuplicate =
      typeof lastSeen === "number" && now - lastSeen < RECENT_CAPTURE_ID_TTL_MS;
    const forced = Boolean(options?.force);

    // Always dedupe auto to prevent "imports twice" regressions.
    // For manual sends, dedupe unless explicitly forced.
    if (isDuplicate && (trigger === "auto" || !forced)) {
      return { enqueued: false, reason: "duplicate" };
    }
    recentCaptureIds.set(captureId, now);
  }

  const job: PendingJob = {
    id: crypto?.randomUUID?.() ?? `job-${Date.now()}-${Math.random()}`,
    payload,
    trigger,
    enqueuedAt: Date.now(),
    retries: 0,
    nextRetryAt: null,
  };

  pendingJobs.push(job);
  updateStateForQueue(trigger);
  scheduleQueueProcessing(0);
  return { enqueued: true };
}

function updateStateForQueue(trigger?: HandoffTrigger | null) {
  const nextRetry = getNextRetryTimestamp();
  const status = hasInFlightJob
    ? "sending"
    : pendingJobs.length > 0
    ? "queued"
    : "idle";
  handoffState = {
    status,
    trigger: trigger ?? handoffState.trigger ?? null,
    lastAttemptAt: handoffState.lastAttemptAt || null,
    lastSuccessAt: handoffState.lastSuccessAt || null,
    error: status === "queued" ? null : handoffState.error || null,
    pendingCount: pendingJobs.length,
    nextRetryAt: nextRetry,
  };
  broadcastHandoffState();
}

function scheduleQueueProcessing(delayMs: number) {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processPendingJobs();
  }, Math.max(0, delayMs));
}

async function processPendingJobs(): Promise<void> {
  if (hasInFlightJob) return;

  const readyJob = findReadyJob();
  if (!readyJob) {
    if (pendingJobs.length === 0) {
      handoffState = {
        status: "idle",
        trigger: null,
        lastAttemptAt: handoffState.lastAttemptAt || null,
        lastSuccessAt: handoffState.lastSuccessAt || null,
        error: null,
        pendingCount: 0,
        nextRetryAt: null,
      };
      broadcastHandoffState();
      return;
    }

    updateStateForQueue(handoffState.trigger ?? null);
    const nextDelay = getNextRunnableDelay();
    if (nextDelay !== null) {
      scheduleQueueProcessing(nextDelay);
    }
    return;
  }

  hasInFlightJob = true;
  handoffState = {
    status: "sending",
    trigger: readyJob.trigger,
    lastAttemptAt: Date.now(),
    lastSuccessAt: handoffState.lastSuccessAt || null,
    error: null,
    pendingCount: pendingJobs.length,
    nextRetryAt: null,
  };
  broadcastHandoffState();

  try {
    console.log(
      `📤 ${
        readyJob.trigger === "auto" ? "Auto" : "Manual"
      } handoff starting...`
    );
    await postToHandoffServer(readyJob.payload);
    console.log("✅ Handoff delivered to server");
    const index = pendingJobs.indexOf(readyJob);
    if (index !== -1) {
      pendingJobs.splice(index, 1);
    }
    handoffState = {
      status: pendingJobs.length > 0 ? "queued" : "success",
      trigger: readyJob.trigger,
      lastAttemptAt: handoffState.lastAttemptAt,
      lastSuccessAt: Date.now(),
      error: null,
      pendingCount: pendingJobs.length,
      nextRetryAt: getNextRetryTimestamp(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isNetworkFailure =
      /failed to fetch/i.test(message) ||
      /networkerror/i.test(message) ||
      /aborterror/i.test(message) ||
      /timeout/i.test(message);
    if (isNetworkFailure) {
      console.log(
        "ℹ️ Handoff server unreachable; keeping capture available for download:",
        message
      );
    } else {
      console.error("❌ Handoff failed:", message);
    }
    // Surface error to any open UI
    chrome.runtime.sendMessage(
      { type: "CAPTURE_ERROR", error: `Handoff failed: ${message}` },
      () => void chrome.runtime.lastError
    );
    // Log to server for diagnostics
    try {
      fetch(handoffEndpoint("/api/log"), {
        method: "POST",
        headers: withHandoffAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: "[handoff] failure", error: message }),
      }).catch(() => {});
    } catch {
      // ignore
    }
    // Fallback: expose payload for manual download if upload fails
    try {
      updateLastCapturedPayload(readyJob.payload);
      chrome.runtime.sendMessage(
        {
          type: "CAPTURE_DOWNLOAD_READY",
          data: readyJob.payload,
          dataSize: JSON.stringify(readyJob.payload).length,
          dataSizeKB: (JSON.stringify(readyJob.payload).length / 1024).toFixed(
            1
          ),
          fallback: true,
        },
        () => void chrome.runtime.lastError
      );
    } catch (e) {
      console.warn("Failed to prepare fallback download:", e);
    }
    readyJob.retries += 1;
    const delay = Math.min(30000, 2000 * readyJob.retries);
    readyJob.nextRetryAt = Date.now() + delay;
    handoffState = {
      status: "error",
      trigger: readyJob.trigger,
      lastAttemptAt: handoffState.lastAttemptAt,
      lastSuccessAt: handoffState.lastSuccessAt || null,
      error: message,
      pendingCount: pendingJobs.length,
      nextRetryAt: readyJob.nextRetryAt,
    };
  } finally {
    hasInFlightJob = false;
    broadcastHandoffState();
    if (pendingJobs.length > 0) {
      const nextDelay = getNextRunnableDelay();
      if (nextDelay !== null && nextDelay > 0) {
        scheduleQueueProcessing(nextDelay);
      } else {
        scheduleQueueProcessing(0);
      }
    }
  }
}

function findReadyJob(): PendingJob | null {
  const now = Date.now();
  return (
    pendingJobs.find((job) => !job.nextRetryAt || job.nextRetryAt <= now) ||
    null
  );
}

function getNextRetryTimestamp(): number | null {
  const upcoming = pendingJobs
    .map((job) => job.nextRetryAt)
    .filter((value): value is number => typeof value === "number");
  if (upcoming.length === 0) return null;
  return Math.min(...upcoming);
}

function getNextRunnableDelay(): number | null {
  const nextRetry = getNextRetryTimestamp();
  if (nextRetry === null) return 0;
  const delay = nextRetry - Date.now();
  return delay > 0 ? delay : 0;
}
