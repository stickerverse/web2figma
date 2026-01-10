import { DOMExtractor } from "./utils/dom-extractor";
import { diagnostics, emitError, emitFatal, emitInfo } from "./utils/diagnostics-bus";

console.log("🎯 Direct DOM Extraction script loaded (v2 - reloaded)");

// Cleanup previous listener if exists to prevent duplicates
if ((window as any).__DOM_EXTRACTOR_LISTENER__) {
  try {
    window.removeEventListener(
      "message",
      (window as any).__DOM_EXTRACTOR_LISTENER__
    );
    console.log("♻️ Removed previous message listener");
  } catch (e) {
    console.warn("Failed to remove previous listener:", e);
  }
}

(window as any).__DOM_EXTRACTOR_LOADED__ = true;
if (!(window as any).__EXTRACTION_COUNT__) {
  (window as any).__EXTRACTION_COUNT__ = 0;
}

// Global error handlers
// Global error handlers
function shouldIgnoreGlobalError(message: any, source?: string): boolean {
  const msg = String(message || "");

  // Common benign ResizeObserver noise
  if (
    msg.includes("ResizeObserver loop completed with undelivered notifications")
  ) {
    return true;
  }
  if (msg.includes("ResizeObserver loop limit exceeded")) {
    return true;
  }

  // You can also ignore stuff that clearly comes from YouTube, etc.
  if (source && /youtube\.com/.test(source)) {
    return true;
  }

  return false;
}

window.onerror = (message, source, lineno, colno, error) => {
  if (shouldIgnoreGlobalError(message, source)) {
    console.warn("[INJECTED_ERROR] Ignored benign global error:", message);
    return; // Do NOT post EXTRACTION_ERROR
  }

  console.error("[INJECTED_ERROR] Global error:", message, error);
  window.postMessage(
    {
      type: "EXTRACTION_ERROR",
      error: `Global error: ${message} at ${source}:${lineno}:${colno}`,
      details: error ? error.stack : undefined,
    },
    "*"
  );
};

// Expose the extractor globally
(window as any).extractPageToSchema = async function () {
  const extractor = new DOMExtractor();
  return await extractor.extractPageToSchema();
};

// Define listener
const messageListener = async (event: MessageEvent) => {
  if (event.data.type === "PING") {
    window.postMessage({ type: "PONG" }, "*");
    return;
  }

  if (event.data.type === "START_EXTRACTION") {
    (window as any).__EXTRACTION_COUNT__++;
    console.log(
      `📨 [INJECT] START_EXTRACTION received! (run #${
        (window as any).__EXTRACTION_COUNT__
      })`
    );
    console.log("📨 [INJECT] Event data:", event.data);

    // Send immediate acknowledgment
    window.postMessage(
      {
        type: "EXTRACTION_PROGRESS",
        phase: "starting",
        message: "Extraction acknowledged, starting...",
        percent: 28,
      },
      "*"
    );

    try {
      console.log("🔍 [INJECT] Creating DOMExtractor instance...");
      const extractor = new DOMExtractor();
      // CRITICAL FIX: Store extractor globally for timeout recovery
      (window as any).__CURRENT_EXTRACTOR__ = extractor;

      // Set up a heartbeat to keep the watchdog alive during long extractions
      let heartbeatCount = 0;
      const heartbeatInterval = setInterval(() => {
        heartbeatCount++;
        console.log(
          `💓 [INJECT] Heartbeat ${heartbeatCount} - extraction still running...`
        );
        window.postMessage(
          {
            type: "EXTRACTION_PROGRESS",
            phase: "processing",
            message: `Still processing... (${heartbeatCount * 10}s)`,
            percent: Math.min(30 + heartbeatCount * 5, 95),
          },
          "*"
        );
      }, 10000); // Send heartbeat every 10 seconds

      try {
        console.log("🔍 [INJECT] Calling extractPageToSchema()...");
        diagnostics.startCapture(window.location.href);
        
        const schema = await extractor.extractPageToSchema();
        console.log("✅ [INJECT] extractPageToSchema() returned successfully");
        console.log("✅ [INJECT] Schema structure:", {
          nodes: schema.root ? "present" : "missing",
          assets: Object.keys(schema.assets.images).length,
        });
        
        emitInfo('injected_script', 'CAPTURE_COMPLETED', `Extraction complete: ${schema.root?.children?.length || 0} elements`);

        console.log("📤 [INJECT] Posting EXTRACTION_COMPLETE message...");
        
        // Helper: safe JSON stringify that removes non-serializable values
        const safeStringify = (obj: any): string => {
          const seen = new WeakSet();
          return JSON.stringify(obj, (key, value) => {
            // Skip DOM nodes, window, document
            if (value instanceof Node || value === window || value === document) {
              return undefined;
            }
            // Skip functions
            if (typeof value === 'function') {
              return undefined;
            }
            // Handle circular references
            if (typeof value === 'object' && value !== null) {
              if (seen.has(value)) {
                return '[Circular]';
              }
              seen.add(value);
            }
            return value;
          });
        };
        
        try {
          window.postMessage(
            {
              type: "EXTRACTION_COMPLETE",
              data: schema,
            },
            "*"
          );
        } catch (postError) {
          // If structured-clone fails (usually due to leaked DOM nodes), fall back to JSON string.
          console.warn(
            "⚠️ [INJECT] postMessage(schema) failed; falling back to JSON string:",
            postError
          );
          
          emitError('injected_script', 'POST_MESSAGE_FAILED', 
            `postMessage failed: ${postError instanceof Error ? postError.message : String(postError)}`,
            { error: postError instanceof Error ? postError : undefined, stack: postError instanceof Error ? postError.stack : undefined }
          );
          
          try {
            const json = safeStringify(schema);
            window.postMessage(
              {
                type: "EXTRACTION_COMPLETE",
                data: json,
                encoding: "json",
              },
              "*"
            );
            emitInfo('injected_script', 'CAPTURE_COMPLETED', 'Schema sent via JSON fallback');
          } catch (stringifyError) {
            // If even safe stringify fails, send minimal error payload
            console.error("❌ [INJECT] Failed to stringify schema:", stringifyError);
            
            emitFatal('serializer', 'SERIALIZATION_FAILED', 
              `JSON.stringify failed: ${stringifyError instanceof Error ? stringifyError.message : String(stringifyError)}`,
              { error: stringifyError instanceof Error ? stringifyError : undefined }
            );
            
            // Print diagnostic report on fatal error
            diagnostics.printReport();
            
            window.postMessage(
              {
                type: "EXTRACTION_ERROR",
                error: `Schema serialization failed: ${postError instanceof Error ? postError.message : String(postError)}`,
                stage: "postMessage",
                diagnosticReport: diagnostics.getReportJSON(),
              },
              "*"
            );
          }
        }
        console.log("✅ [INJECT] EXTRACTION_COMPLETE message posted!");
        
        // Print diagnostic report even on success (shows any warnings)
        diagnostics.printReport();
      } finally {
        // Always clear the heartbeat interval
        clearInterval(heartbeatInterval);
        // ENHANCED: Keep extractor available for timeout recovery
        // Don't clear immediately - timeout handler might need it
        // Clear after a delay to allow timeout recovery to access it
        setTimeout(() => {
          if ((window as any).__CURRENT_EXTRACTOR__) {
            console.log(
              "🧹 [INJECT] Clearing extractor after completion delay"
            );
            (window as any).__CURRENT_EXTRACTOR__ = null;
          }
        }, 5000); // Keep extractor for 5s after completion for timeout recovery
      }
    } catch (error) {
      console.error("❌ [INJECT] Extraction failed:", error);
      console.error(
        "❌ [INJECT] Error stack:",
        error instanceof Error ? error.stack : "No stack"
      );

      // Record fatal error in diagnostics
      emitFatal('extractor', 'CAPTURE_FAILED', 
        `Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        { 
          error: error instanceof Error ? error : undefined,
          stack: error instanceof Error ? error.stack : undefined 
        }
      );

      // Print the diagnostic report
      diagnostics.printReport();

      // ENHANCED: Try to get partial schema even on error
      const partialSchema: any = null;

      // Send structured error with stage information
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      window.postMessage(
        {
          type: "EXTRACTION_ERROR",
          error: errorMessage,
          stage: "extract",
          errorCode: "EXTRACTION_FAILED",
          diagnosticReport: diagnostics.getReportJSON(),
          details: {
            hasPartialSchema: !!partialSchema,
            nodeCount: partialSchema?.root
              ? (partialSchema.metadata as any)?.extractedNodes || 0
              : 0,
          },
        },
        "*"
      );

      // Keep extractor for timeout recovery even on error
      setTimeout(() => {
        (window as any).__CURRENT_EXTRACTOR__ = null;
      }, 5000);
    }
  }
};

// Store and register listener
(window as any).__DOM_EXTRACTOR_LISTENER__ = messageListener;
window.addEventListener("message", messageListener);

console.log("✅ [INJECT] Message listener installed for START_EXTRACTION");
