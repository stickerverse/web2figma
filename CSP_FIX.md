# CSP Fix - Service Worker Registration Issue

## Problem

**Error:** `Service worker registration failed. Status code: 15`

**Root Cause:**
```
Uncaught EvalError: Evaluating a string as JavaScript violates the following
Content Security Policy directive because 'unsafe-eval' is not an allowed
source of script: script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules'
```

Webpack was generating `eval()` calls in the bundled background.js for source map generation, which violates Chrome extension Content Security Policy for service workers.

---

## Solution

**File Modified:** `chrome-extension/webpack.config.js`

**Change:** Added `devtool: false` to webpack configuration

```javascript
module.exports = {
  mode: 'production',
  // CRITICAL: Disable eval-based devtools to comply with Chrome extension CSP
  // Service workers cannot use eval() - must use 'source-map' or false
  devtool: false,
  // ... rest of config
};
```

---

## Verification

**Before fix:**
```bash
$ grep -c "eval(" dist/background.js
356  # Many eval() calls present
```

**After fix:**
```bash
$ grep -c "eval(" dist/background.js
0  # No eval() calls
```

**Extension now loads successfully** with no CSP violations.

---

## Additional Changes

Synced `manifest.automation.json` with user's updates to `manifest.json`:

1. **Added "alarms" permission** - Required for scheduled background tasks
2. **Added keyboard shortcuts:**
   - `Ctrl+Shift+F` (Mac: `Cmd+Shift+F`) - Capture full page
   - `Ctrl+Shift+S` (Mac: `Cmd+Shift+S`) - Capture selection

Both manifests now have identical permissions and commands configuration.

---

## Why This Matters

Chrome extension service workers run in a restricted environment with strict CSP:

- ❌ **Forbidden:** `eval()`, `new Function()`, inline event handlers
- ✅ **Allowed:** Pre-compiled JavaScript bundles

Webpack's default development mode uses `eval()` for fast incremental builds, but this breaks in service workers. The fix ensures production builds are CSP-compliant.

---

## Alternative Solutions (Not Used)

If you need source maps for debugging:

```javascript
devtool: 'source-map'  // Generates separate .map files (CSP-safe)
```

For development with faster rebuilds:

```javascript
devtool: process.env.NODE_ENV === 'production' ? false : 'cheap-module-source-map'
```

We chose `devtool: false` for maximum compatibility and smallest bundle size.

---

## Test After Fix

```bash
# Rebuild extension
cd chrome-extension
WEB2FIGMA_AUTOMATION=1 npm run build

# Load extension in Chrome
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select chrome-extension/dist/ directory
# 5. Extension should load without errors
```

**Expected:** Service worker loads successfully, no CSP errors in console.
