# Web2Figma Automation Runbook

## End-to-End Deterministic Capture Pipeline

This runbook provides the exact commands to run the automated web2figma capture pipeline with full verification.

---

## Prerequisites

- Node.js v22+ installed
- Chrome/Chromium browser
- Project dependencies installed (`npm install` in root and chrome-extension/)

---

## 1. BUILD EXTENSION IN AUTOMATION MODE

```bash
cd /Users/skirk92/figmacionvert-2/chrome-extension
WEB2FIGMA_AUTOMATION=1 npm run build
```

**Expected output:**

```
🤖 Building in AUTOMATION mode - content scripts will auto-inject
...
webpack 5.102.1 compiled successfully
```

**Verification:**

```bash
cat dist/manifest.json | grep -A 3 content_scripts
```

**Should show:**

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
```

---

## 2. START HANDOFF SERVER

```bash
cd /Users/skirk92/figmacionvert-2
node handoff-server.cjs
```

**Expected output:**

```
🚀 Handoff Server running on http://0.0.0.0:4411
📊 Queue length: 0
📁 Artifacts directory: .../artifacts/handoff

Endpoints:
  POST   /api/jobs - Queue new job
  GET    /api/jobs/next - Poll for next job
  GET    /api/jobs/recent - Get recent jobs (verification)
  ...
```

**Health check (in another terminal):**

```bash
curl http://localhost:4411/api/health
```

---

## 3. RUN AUTOMATED CAPTURE

```bash
cd /Users/skirk92/figmacionvert-2
node tools/capture-runner.js https://www.etsy.com
```

**Expected flow:**

```
🚀 Starting capture automation for: https://www.etsy.com
📂 Extension path: .../chrome-extension/dist
🏥 Checking server health at http://localhost:4411...
✅ Server is running (queue length: X)
🔗 Navigating...
✅ Attached to background service worker
   Service worker URL: chrome-extension://...
⏳ Waiting for content script to initialize...
✅ Content script is ready!
📸 Triggering capture...

BG LOG: 🧪 [TEST] Received capture trigger via postMessage
BG LOG: 🧪 [TEST] Viewports: [...]
BG LOG: 🧪 [TEST] Triggering capture for tab X
BG LOG: 🧪 [TEST] Viewports: [...]
BG LOG: ✅ [TEST] Sent start-capture, response: {...}

⏳ Waiting for capture to complete...
✅ Capture marked complete by extension!
⏳ Verifying job exists on server...
✅ Job verified on server!
   Job ID: abc-123-def-456
   Queued at: 2026-01-10T...
   Status: queued
   Payload size: XXX KB
   Artifact path: artifacts/handoff/debug/abc-123-def-456/

👋 Browser closed.
🎉 SUCCESS: Capture verified end-to-end!
```

---

## 4. VERIFY ARTIFACTS ON DISK

```bash
ls -la artifacts/handoff/debug/
```

**Should show job directory:**

```
drwxr-xr-x  3 user  staff  96 Jan 10 02:17 abc-123-def-456
```

**Check job contents:**

```bash
ls -la artifacts/handoff/debug/<jobId>/
```

**Should contain:**

```
-rw-r--r--  1 user  staff  XXXXX Jan 10 02:17 original_capture.png
```

---

## 5. VERIFY SERVER RECEIVED JOB

```bash
curl -s 'http://localhost:4411/api/jobs/recent?limit=1' | jq
```

**Expected output:**

```json
{
  "jobs": [
    {
      "id": "abc-123-def-456",
      "queuedAt": 1768043865148,
      "deliveredAt": null,
      "completedAt": null,
      "status": "queued",
      "hasPayload": true,
      "payloadSize": 123456,
      "hasFigmaScreenshot": false
    }
  ],
  "total": 1,
  "pending": 1
}
```

---

## 6. CHECK SERVER LOGS

```bash
tail -50 server.log
```

**Should show:**

```
✅ Job queued: abc-123-def-456 (XXX KB)
[SERVER][JOB_QUEUED] jobId=abc-123-def-456 bytes=123456 url=https://www.etsy.com
📸 Saved original capture to: artifacts/handoff/debug/abc-123-def-456/original_capture.png
```

---

## Troubleshooting

### Issue: "Content script did not become ready within 30s"

**Cause:** Extension built without WEB2FIGMA_AUTOMATION=1

**Fix:**

```bash
cd chrome-extension
WEB2FIGMA_AUTOMATION=1 npm run build
```

Verify:

```bash
cat dist/manifest.json | grep content_scripts
```

Should NOT be empty (`[]`).

---

### Issue: "Server health check failed"

**Cause:** Handoff server not running

**Fix:**

```bash
node handoff-server.cjs
```

---

### Issue: "Capture timed out waiting for data-capture-status=complete"

**Diagnostic steps:**

1. Check if background service worker attached:

   - Look for "✅ Attached to background service worker" in output
   - If missing, service worker failed to start

2. Check background logs:

   - Should see: `BG LOG: 🧪 [TEST] Triggering capture for tab X`
   - If missing, message chain is broken

3. Run with visible browser:
   - Edit `tools/capture-runner.js` line 33: `headless: false`
   - Edit line 34: `devtools: true`
   - Manually inspect extension in chrome://extensions
   - Check service worker console for errors

---

### Issue: "Job not verified on server"

**Diagnostic steps:**

1. Check if background upload succeeded:

   - Look for: `BG LOG: [BG][HANDOFF] ✅ Successfully sent to http://...`
   - If missing, check server is reachable

2. Check server logs:

   - Should show: `[SERVER][JOB_QUEUED] jobId=...`

3. Manually check server:
   ```bash
   curl http://localhost:4411/api/jobs/recent?limit=5
   ```

---

## Normal (Non-Automation) Build

For manual browser usage (popup-based capture):

```bash
cd chrome-extension
npm run build  # WITHOUT WEB2FIGMA_AUTOMATION=1
```

This builds with empty `content_scripts: []` and requires manual popup interaction.

---

## Files Modified

### Core Implementation

- `chrome-extension/webpack.config.js` - Conditional manifest selection
- `chrome-extension/manifest.automation.json` - Auto-inject content scripts
- `chrome-extension/manifest.json` - Added default_popup
- `chrome-extension/manifest.automation.json` - Added default_popup
- `chrome-extension/src/content-script.ts` - Added readiness signal, fixed viewport forwarding
- `chrome-extension/src/background.ts` - Fixed viewport forwarding, enhanced logging
- `chrome-extension/tsconfig.json` - Exclude backup files

### Testing Infrastructure

- `tools/capture-runner.js` - Server preflight, readiness wait, job verification
- `tools/test-server-endpoints.js` - Standalone server test
- `handoff-server.cjs` - GET /api/jobs/recent endpoint, enhanced logging

---

## Success Criteria

✅ Extension builds cleanly with WEB2FIGMA_AUTOMATION=1
✅ Content script auto-injects and signals readiness
✅ Capture completes and sets data-capture-status="complete"
✅ Background uploads job to server
✅ Server logs [SERVER][JOB_QUEUED] with jobId
✅ artifacts/handoff/debug/<jobId>/ directory created
✅ Runner verifies job via GET /api/jobs/recent
✅ Runner exits with code 0

---

## Quick Test (Server Endpoints Only)

To test server without browser automation:

```bash
node handoff-server.cjs &
sleep 2
node tools/test-server-endpoints.js
```

Expected:

```
✅ All server endpoint tests passed!
```

---

## Gap Analysis (Post-Import Debugging)

After importing a capture into Figma, use the gap analysis pipeline to diagnose pixel-perfect fidelity issues.

### Prerequisites

```bash
pip install opencv-python numpy scikit-learn
```

### Run Gap Analysis

**Basic (Schema-Only):**

```bash
python analyze_gap_v3.py \
  --original github.com_.png \
  --figma artifacts/handoff/debug/<jobId>/import_render.png \
  --schema page-capture-<timestamp>.json \
  --out artifacts
```

**With Figma Scene Graph (Recommended):**

```bash
python analyze_gap_v3.py \
  --original github.com_.png \
  --figma artifacts/handoff/debug/<jobId>/import_render.png \
  --schema page-capture-<timestamp>.json \
  --figma-nodes artifacts/handoff/debug/<jobId>/figma_scene_graph.json \
  --out artifacts
```

### Output Files

- `artifacts/diff_heatmap_v3.png` - Visual heatmap of pixel differences
- `artifacts/diff_clusters_v3.png` - Annotated clusters with schema/figma coverage
- `artifacts/diff_clusters_v3.json` - Full cluster data with bbox, type, root cause
- `artifacts/gap_analysis_v3.md` - Human-readable analysis report

### Root Cause Categories

| Root Cause            | Suspect File                                  | Description                               |
| --------------------- | --------------------------------------------- | ----------------------------------------- |
| CAPTURE_SCHEMA_BUG    | `chrome-extension/src/utils/dom-extractor.ts` | Element not captured in schema            |
| IMPORT_MAPPING_BUG    | `figma-plugin/src/node-builder.ts`            | Schema node exists but Figma node missing |
| ASSET_PIPELINE_BUG    | `figma-plugin/src/enhanced-figma-importer.ts` | Image/media element not created           |
| GEOMETRY_BUG          | `figma-plugin/src/node-builder.ts`            | Figma node exists but wrong position/size |
| STYLE_MAPPING_BUG     | `figma-plugin/src/node-builder.ts`            | Figma node exists but wrong fills/effects |
| VISIBILITY_BUG        | `figma-plugin/src/node-builder.ts`            | Figma node hidden or fully transparent    |
| CLIPPING_BUG          | `figma-plugin/src/node-builder.ts`            | Parent clips child content                |
| NEEDS_RASTER_FALLBACK | `figma-plugin/src/screenshot-overlay.ts`      | Element marked for rasterization          |

### Manual Scene Graph Export

To export scene graph manually from Figma plugin:

1. Select the imported frame in Figma
2. Open plugin console
3. Run: `figma.ui.postMessage({ type: 'export-scene-graph', importedOnly: true })`
4. Download `figma-nodes-*.json` (sent to UI)

Or use the automated path: scene graph is uploaded automatically after each import.

---

## Diagnostic Artifacts Reference

### Per-Job Artifacts (`artifacts/handoff/debug/<jobId>/`)

| File                       | Description                           |
| -------------------------- | ------------------------------------- |
| `original_capture.png`     | Screenshot from browser before import |
| `import_render.png`        | Figma render after import             |
| `import_report.json`       | Basic import metadata                 |
| `figma_nodes.json.gz`      | Full JSON_REST_V1 export              |
| `figma_summary.json`       | Compact diagnostic summary            |
| `figma_selection_map.json` | Schema ID to Figma ID mapping         |
| `figma_scene_graph.json`   | Scene graph with schemaId links       |
