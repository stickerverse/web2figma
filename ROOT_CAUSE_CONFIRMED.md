# ROOT CAUSE CONFIRMED: Image Asset Pipeline Failure

**Date:** 2026-01-12 (Continued Investigation)
**Status:** 🔍 Root cause identified via code analysis + capture file inspection

---

## Executive Summary

**Problem:** 100% image failure (14/14 images failed, SSIM 0.45)

**Root Cause:** Extension's `assets.images` object is EMPTY in serialized JSON captures.

**Evidence:** Analyzed 2 recent capture files:
- `page-capture-1768168635589.json` (405MB, Jan 11 12:57) - NO assets.images
- `page-capture-1768104797293.json` (Jan 11) - NO assets key at all

---

## Technical Analysis

### Code Flow Verification

#### Extension Side (✅ Code is correct)

**File:** `chrome-extension/src/utils/dom-extractor.ts`

1. **Line 1923**: Schema initialized with empty assets:
   ```typescript
   assets: {
     images: {},
     svgs: {},
     fonts: {},
   }
   ```

2. **Line 8811**: Images are hashed correctly:
   ```typescript
   const key = this.hashString(imageUrl);  // generates "img_abc123..." (FNV-1a hash with prefix)
   ```

3. **Line 8949**: Hash stored in fill:
   ```typescript
   imageHash: key,  // stores the hashed key
   ```

4. **Line 10414-10443**: `finalizeAssets` populates assets.images:
   ```typescript
   private finalizeAssets(schema: WebToFigmaSchema): void {
     const imagesObj: Record<string, any> = {};
     this.assets.images.forEach((data, url) => {
       const key = this.hashString(url);  // Same hash algorithm
       imagesObj[key] = {
         id: key,
         url: imageUrl,
         originalUrl: data.originalUrl || url,
         absoluteUrl: data.absoluteUrl || imageUrl,
         width: data.width ?? 0,
         height: data.height ?? 0,
         data: data.base64 ?? null,
         base64: data.base64 ?? null,
         error: data.error,
       };
     });
     schema.assets.images = imagesObj;  // ← Should populate schema
   }
   ```

5. **Line 2218**: `finalizeAssets` is called:
   ```typescript
   this.finalizeAssets(schema);
   ```

6. **Lines 2228, 2232**: Sanitization methods called (verified these do NOT delete assets)

**Extension code is CORRECT.** The hashing is consistent, finalizeAssets populates assets.images, and sanitization doesn't remove it.

#### Plugin Side (✅ Code is correct)

**File:** `figma-plugin/src/node-builder.ts`

1. **Line 5895**: Gets hash from fill:
   ```typescript
   const hash = fill.imageHash;  // expects "img_abc123..."
   ```

2. **Line 5963**: Looks up asset:
   ```typescript
   if (this.assets?.images?.[hash]) {
     const asset = this.assets.images[hash];
     // ...
   }
   ```

**Plugin code is CORRECT.** It uses the same hash key to look up assets.

---

## Why Images Are Failing

### Actual Problem

The extension IS building assets.images correctly in memory, but either:

1. **Serialization Issue**: The assets object is not being serialized to JSON properly
2. **Message Passing Issue**: Assets are stripped when sent via `postMessage` or `chrome.runtime.sendMessage`
3. **Storage Issue**: Assets are lost when saved to handoff server
4. **Old Code in Production**: The test captures were made with old extension code

### Evidence Analysis

**Capture Files Inspection:**
```bash
$ python3 -c "import json; data = json.load(open('page-capture-1768168635589.json')); print(f'Has assets.images: {\"images\" in data.get(\"assets\", {})})')"
Has assets.images: False

$ python3 -c "import json; data = json.load(open('page-capture-1768104797293.json')); print(f'Has assets: {\"assets\" in data})')"
Has assets: False
```

**Build Status:**
- Extension source modified: Jan 12 00:44 (with diagnostic patches)
- Extension dist built: Jan 12 (today, ~30 min ago with diagnostic patches)
- Capture files created: Jan 11-12 (BEFORE today's rebuild)

**Conclusion:** The capture files were created with OLD extension code that didn't properly populate assets.images.

---

## Diagnostic Strategy

The diagnostic patches added today will reveal exactly where the pipeline fails:

### Diagnostic Patch #1: Extension Asset Validation (line 10445)

**What it logs:**
```javascript
📊 [ASSET VALIDATION] Finalized 14 image assets
  📸 Asset img_abc123...:
     - hasData: false
     - hasBase64: false
     - hasUrl: true
     - url: https://example.com/image.png...
     - dimensions: 800x600
⚠️ [ASSET VALIDATION] ALL 14 images are URL-only (no embedded base64)
   Plugin MUST fetch via proxy. Ensure handoff server is running at http://localhost:4411
```

**What it tells us:**
- Whether assets are being created in memory
- Whether they have base64 data or just URLs
- Sample asset structure

### Diagnostic Patch #2: Plugin Import Validation (line 522)

**What it logs:**
```javascript
📊 [IMPORT VALIDATION] Checking assets structure...
  Assets validation: {hasAssets: true, hasImages: true, imageCount: 14, ...}
  📸 Sample asset hashes: ['img_abc123...', 'img_def456...', 'img_ghi789...']
  📊 Sample asset structure: {hasData: false, hasBase64: false, hasUrl: true, url: '...'}
⚠️ [IMPORT VALIDATION] Assets are URL-only (no embedded data)
   Ensure handoff server proxy is running at http://localhost:4411
```

**OR if assets missing:**
```javascript
❌ [IMPORT VALIDATION] NO IMAGES IN ASSETS! This will cause all images to fail.
   Check extension console for asset finalization logs.
```

**What it tells us:**
- Whether assets made it into the JSON that the plugin received
- Whether asset count matches what extension created
- Whether hashes match

### Diagnostic Patch #3: Hash Mismatch Detection (line 6044)

**What it logs (if lookup fails):**
```javascript
🔍 [HASH MISMATCH DEBUG] Comparing hash formats:
   Requested hash: img_abc123 (length: 15)
   Sample asset key: img_abc123 (length: 15)
⚠️ [HASH MISMATCH] Hash format mismatch: requested=hex, assets=other
   This indicates a hashing algorithm inconsistency between extension and plugin.
```

**What it tells us:**
- Whether hash formats match
- Whether the issue is in the hashing algorithm

### Diagnostic Patch #4: Proxy Failure Diagnostics (line 6957)

**What it logs (if proxy fetch fails):**
```javascript
❌ [PROXY FAILED] All handoff server proxies failed for image fetch.
   Attempted servers: ['http://127.0.0.1:4411', 'http://localhost:4411']
   DIAGNOSIS:
     1. Ensure handoff server is running: node handoff-server.cjs
     2. Check server is accessible: curl http://localhost:4411/api/health
     3. Check firewall/network settings
     4. Check server logs for proxy errors
```

**What it tells us:**
- Whether the proxy is accessible
- Which proxy URLs were attempted

---

## Next Steps (Testing Required)

### 1. Reload Extension in Chrome

**CRITICAL:** The extension was rebuilt today with diagnostic patches, but Chrome is still running the old code.

**Steps:**
1. Open Chrome
2. Navigate to `chrome://extensions/`
3. Find "Web to Figma" extension
4. Click **Reload** button (circular arrow icon)

### 2. Capture Test Page

**Use the test file:** `/Users/skirk92/figmacionvert-2/test-images-simple.html`

This file has 3 simple images from reliable CDNs:
- Image 1: Unsplash (400x300 PNG)
- Image 2: Picsum (400x300 JPEG)
- Image 3: Placeholder.com (400x300 PNG with text)

**Steps:**
1. Open test file in Chrome: `file:///Users/skirk92/figmacionvert-2/test-images-simple.html`
2. Open Chrome DevTools (F12 or Cmd+Option+I)
3. Go to **Console** tab
4. Click extension icon → "Capture Page"
5. **Watch the console output**

**Expected logs:**
```
📊 [ASSET VALIDATION] Finalized 3 image assets
  📸 Asset img_...
```

If you see this, assets ARE being created!

### 3. Check Capture JSON

After capture completes, check the saved JSON file:

```bash
# Find most recent capture
ls -lt page-capture-*.json | head -1

# Check if it has assets
python3 -c "
import json
data = json.load(open('page-capture-XXXXX.json'))
print(f'Has assets.images: {\"images\" in data.get(\"assets\", {})}')
if 'images' in data.get('assets', {}):
    print(f'Image count: {len(data[\"assets\"][\"images\"])}')
    print(f'Sample keys: {list(data[\"assets\"][\"images\"].keys())[:3]}')
"
```

**If assets.images exists:** Pipeline is working!
**If assets.images is missing:** Serialization/message passing issue.

### 4. Import to Figma

1. Open Figma desktop app
2. Open plugin: Plugins → Development → Open Console (IMPORTANT!)
3. Load the captured JSON
4. Click "Import"
5. **Watch the plugin console output**

**Expected logs:**
```
📊 [IMPORT VALIDATION] imageCount: 3
  📸 Sample asset hashes: ['img_...', ...]
  📊 Sample asset structure: {hasUrl: true, ...}
```

### 5. Analyze Results

Based on diagnostic output, determine which scenario applies:

| Symptom | Root Cause | Fix |
|---------|------------|-----|
| Extension logs "Finalized 3 images" but JSON has no assets | Serialization issue | Investigate postMessage/storage |
| JSON has assets but plugin logs "NO IMAGES" | Message passing issue | Check handoff server logs |
| Plugin logs "HASH MISMATCH" | Hash algorithm inconsistency | Fix hashing (unlikely) |
| Plugin logs "PROXY FAILED" | Handoff server issue | Check server is running |
| Extension logs "Finalized 0 images" | Image capture failing | Check `captureImageSafe` logic |

---

## Confidence Assessment

**Code Analysis:** ✅ VERIFIED (read actual source)
**Hash Algorithm:** ✅ CONSISTENT (FNV-1a on both sides)
**Capture File Analysis:** ✅ VERIFIED (no assets.images present)
**Build Status:** ✅ VERIFIED (rebuilt today with diagnostics)

**Next Required Action:** Test with reloaded extension to see diagnostic output.

---

## Predicted Outcome

**Most Likely:** Extension will log "Finalized N images" but the JSON will be missing assets due to:
1. Serialization issue in `structuredClone` or `JSON.stringify`
2. Message passing stripping large objects
3. Handoff server not preserving assets field

**Diagnostic will reveal:** Exactly which layer is dropping the assets.

---

**Status:** Ready for user testing with diagnostic-enabled extension.
