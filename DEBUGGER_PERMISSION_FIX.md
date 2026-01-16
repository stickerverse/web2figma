# Debugger Permission Fix - CDP Screenshot Resolution

## Problem

**Observed Errors:**
```
[CDP] captureScreenshot failed: Cannot read properties of undefined (reading 'attach')
[PHASE 5] captureVisibleTab failed: This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota
[BG][PREFLIGHT] FAILED {fatal: 1, warnings: 0, issues: Array(1)}
```

**Root Cause:**
The `chrome.debugger` API was **undefined** because the extension manifest was missing the required `"debugger"` permission.

**Impact:**
1. CDP screenshots failed completely
2. Fallback to `chrome.tabs.captureVisibleTab()` triggered rate limiting
3. Screenshot bytes missing → Preflight validation failed with FATAL error
4. Payload size smaller than expected (30.4 KB vs 97.3 KB)

---

## Solution

**Files Modified:**
- `chrome-extension/manifest.json` (line 9)
- `chrome-extension/manifest.automation.json` (line 9)

**Change:** Added `"debugger"` permission to both manifests

```json
{
  "permissions": [
    "activeTab",
    "alarms",
    "debugger",     // ← ADDED
    "downloads",
    "scripting",
    "storage",
    "tabs"
  ]
}
```

---

## Verification

### Before Fix
```bash
$ node tools/capture-runner.js https://example.com
# Errors observed:
[CDP] captureScreenshot failed: Cannot read properties of undefined (reading 'attach')
[PHASE 5] captureVisibleTab failed: MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded
[BG][PREFLIGHT] FAILED {fatal: 1, warnings: 0}
✅ Job verified (30.4 KB) - but with validation errors
```

### After Fix
```bash
$ cd chrome-extension && WEB2FIGMA_AUTOMATION=1 npm run build
$ node tools/capture-runner.js https://example.com

# Results:
✅ Content script is ready!
🎉 CAPTURE COMPLETE: 12 nodes processed successfully
✅ NO ERRORS OR WARNINGS
✅ Job verified on server!
   Job ID: 4cb377b3-e3c5-4c6d-8532-7966f3195bf0
   Payload size: 97.3 KB  ← 3x larger (includes screenshot)
🎉 SUCCESS: Capture verified end-to-end!
```

**No CDP errors, no rate limiting, no preflight failures.**

---

## Why This Matters

### Chrome Debugger Protocol (CDP)
The `chrome.debugger` API provides access to Chrome DevTools Protocol, enabling:
- Full-page screenshots beyond viewport bounds (`captureBeyondViewport: true`)
- Precise clipping with pixel-perfect coordinates
- Higher quality captures than `captureVisibleTab()`

### Manifest V3 Permissions
Chrome extension permissions must be **explicitly declared** in manifest.json:

| Permission | Purpose | Required For |
|-----------|---------|--------------|
| `debugger` | Access CDP for advanced browser control | Screenshot capture, network inspection |
| `activeTab` | Access current tab content | Content script injection |
| `tabs` | Query and manipulate tabs | Tab management, navigation |

Without the `debugger` permission, `chrome.debugger` is `undefined` at runtime.

---

## Impact on Pipeline

**Before:** Capture succeeded but validation failed
- Extension still uploaded job to server (preflight is non-blocking)
- Screenshot missing from payload
- Figma plugin would import without reference screenshot
- Visual validation impossible

**After:** Full end-to-end validation
- CDP screenshot capture works correctly
- Screenshot included in payload (97.3 KB vs 30.4 KB)
- Preflight validation passes
- Figma plugin can perform visual fidelity comparisons

---

## Related Files

- `chrome-extension/src/background.ts:1237` - CDP screenshot implementation
- `chrome-extension/src/utils/schema-preflight.ts:358` - Screenshot validation
- `tools/capture-runner.js` - End-to-end test script
- `TEST_RESULTS.md` - Automation test results

---

## Test After Fix

```bash
# Rebuild extension
cd chrome-extension
WEB2FIGMA_AUTOMATION=1 npm run build

# If using in regular Chrome (not Puppeteer):
# 1. Go to chrome://extensions
# 2. Reload the extension
# 3. Test capture on any page

# Or use automated test:
cd ..
node tools/capture-runner.js https://example.com
```

**Expected:** Clean logs, no CDP errors, payload ~3x larger with screenshot data included.
