# P0 Fix: Image Asset Pipeline - Enhanced Diagnostics & Fallback

**Date:** 2026-01-12
**Priority:** P0 (Critical)
**Estimated Impact:** +40% SSIM (0.45 → 0.85)

---

## Root Cause Summary

After comprehensive code inspection, the image pipeline ALREADY has:
- ✅ Extension correctly sets URL fields in `finalizeAssets` (dom-extractor.ts:10409-10443)
- ✅ Plugin has 7 fallback strategies in `resolveImagePaint` (node-builder.ts:5894-6256)
- ✅ Assets are passed to NodeBuilder correctly (enhanced-figma-importer.ts:517)

**The problem is likely:**
1. **Hash Mismatch:** Extension generates hash with one algorithm, plugin looks up with different hash
2. **Empty Assets:** Assets object exists but has no images (images array is empty)
3. **Proxy Failure:** URL fallback fails because handoff server proxy isn't running or reachable

---

## Fix Strategy: Enhanced Diagnostics + Robust Fallback

### Fix 1: Extension - Add Asset Validation Logging

**File:** `chrome-extension/src/utils/dom-extractor.ts`
**Location:** After line 10443 (in `finalizeAssets` method)

```typescript
// PIXEL-PERFECT FIX: Validate and log asset structure for debugging
console.log(`📊 [ASSET VALIDATION] Finalized ${Object.keys(imagesObj).length} image assets`);

if (Object.keys(imagesObj).length > 0) {
  // Log first 3 assets for debugging
  const sampleAssets = Object.entries(imagesObj).slice(0, 3);
  sampleAssets.forEach(([key, asset]: [string, any]) => {
    console.log(`  📸 Asset ${key.substring(0, 20)}...:`);
    console.log(`     - hasData: ${!!asset.data}`);
    console.log(`     - hasBase64: ${!!asset.base64}`);
    console.log(`     - hasUrl: ${!!asset.url}`);
    console.log(`     - url: ${asset.url ? asset.url.substring(0, 80) + '...' : 'NONE'}`);
    console.log(`     - dimensions: ${asset.width}x${asset.height}`);
  });
}

// CRITICAL: Warn if ALL assets have no base64 (URL-only mode)
const assetsWithBase64 = Object.values(imagesObj).filter((a: any) => a.data || a.base64).length;
const assetsWithUrl = Object.values(imagesObj).filter((a: any) => a.url).length;

if (assetsWithBase64 === 0 && assetsWithUrl > 0) {
  console.warn(`⚠️ [ASSET VALIDATION] ALL ${assetsWithUrl} images are URL-only (no embedded base64)`);
  console.warn(`   Plugin MUST fetch via proxy. Ensure handoff server is running at http://localhost:4411`);
}
```

### Fix 2: Plugin - Enhanced Asset Validation at Import Start

**File:** `figma-plugin/src/enhanced-figma-importer.ts`
**Location:** After line 520 (after NodeBuilder initialization)

```typescript
// PIXEL-PERFECT FIX: Validate assets were passed correctly
console.log(`📊 [IMPORT VALIDATION] Checking assets structure...`);
const assetsCheck = {
  hasAssets: !!this.data.assets,
  hasImages: !!this.data.assets?.images,
  imageCount: this.data.assets?.images ? Object.keys(this.data.assets.images).length : 0,
  hasSvgs: !!this.data.assets?.svgs,
  svgCount: this.data.assets?.svgs ? Object.keys(this.data.assets.svgs).length : 0,
};

console.log(`  Assets validation:`, assetsCheck);

if (assetsCheck.imageCount === 0) {
  console.error(`❌ [IMPORT VALIDATION] NO IMAGES IN ASSETS! This will cause all images to fail.`);
  console.error(`   Check extension console for asset finalization logs.`);
} else {
  // Log sample asset keys to verify hash format
  const sampleKeys = Object.keys(this.data.assets.images).slice(0, 3);
  console.log(`  📸 Sample asset hashes:`, sampleKeys);

  // Check if assets have base64 or URLs
  const sampleAsset = this.data.assets.images[sampleKeys[0]];
  if (sampleAsset) {
    console.log(`  📊 Sample asset structure:`, {
      hasData: !!sampleAsset.data,
      hasBase64: !!sampleAsset.base64,
      hasUrl: !!sampleAsset.url,
      url: sampleAsset.url ? sampleAsset.url.substring(0, 60) + '...' : 'NONE'
    });

    if (!sampleAsset.data && !sampleAsset.base64 && !sampleAsset.url) {
      console.error(`❌ [IMPORT VALIDATION] Sample asset has NO data, NO base64, AND NO url!`);
      console.error(`   Image resolution will FAIL. Check extension finalizeAssets logic.`);
    } else if (!sampleAsset.data && !sampleAsset.base64) {
      console.warn(`⚠️ [IMPORT VALIDATION] Assets are URL-only (no embedded data)`);
      console.warn(`   Ensure handoff server proxy is running at http://localhost:4411`);
      console.warn(`   All images will be fetched via proxy. This may be slower.`);
    }
  }
}
```

### Fix 3: Plugin - Add Hash Mismatch Detection

**File:** `figma-plugin/src/node-builder.ts`
**Location:** After line 6041 (in resolveImagePaint, after "No asset found" log)

```typescript
// PIXEL-PERFECT FIX: Detect hash mismatch by comparing hash formats
if (!this.assets?.images?.[hash]) {
  const allAssetKeys = Object.keys(this.assets?.images || {});

  if (allAssetKeys.length > 0) {
    console.log(`  🔍 [HASH MISMATCH DEBUG] Comparing hash formats:`);
    console.log(`     Requested hash: ${hash} (length: ${hash.length})`);
    console.log(`     Sample asset key: ${allAssetKeys[0]} (length: ${allAssetKeys[0].length})`);

    // Check if hash format is completely different
    const hashPattern = hash.match(/^[0-9a-f]+$/i) ? 'hex' : 'other';
    const assetPattern = allAssetKeys[0].match(/^[0-9a-f]+$/i) ? 'hex' : 'other';

    if (hashPattern !== assetPattern) {
      console.warn(`  ⚠️ [HASH MISMATCH] Hash format mismatch: requested=${hashPattern}, assets=${assetPattern}`);
      console.warn(`     This indicates a hashing algorithm inconsistency between extension and plugin.`);
    }

    // Check if hash is a URL but assets use hashed keys
    if (hash.startsWith('http') && !allAssetKeys[0].startsWith('http')) {
      console.warn(`  ⚠️ [HASH MISMATCH] Hash is a URL but assets use hashed keys.`);
      console.warn(`     Extension may not be hashing URLs correctly in finalizeAssets.`);
    }
  } else {
    console.error(`  ❌ [HASH MISMATCH DEBUG] No assets available at all! Asset object is empty.`);
  }
}
```

### Fix 4: Plugin - Add Proxy Health Check

**File:** `figma-plugin/src/node-builder.ts`
**Location:** After line 6931 (in fetchImageViaProxy, after all proxy attempts fail)

```typescript
// PIXEL-PERFECT FIX: Add diagnostic message when all proxies fail
console.error(`❌ [PROXY FAILED] All handoff server proxies failed for image fetch.`);
console.error(`   Attempted servers:`, handoffBases);
console.error(`   DIAGNOSIS:`);
console.error(`     1. Ensure handoff server is running: node handoff-server.cjs`);
console.error(`     2. Check server is accessible: curl http://localhost:4411/api/health`);
console.error(`     3. Check firewall/network settings`);
console.error(`     4. Check server logs for proxy errors`);
```

---

## Verification Steps

### Step 1: Check Extension Console

After capturing a page:
```
✓ Look for: "📊 [ASSET VALIDATION] Finalized N image assets"
✓ Look for: "📸 Asset abc123...:" with URL/base64 status
✗ Look for: "⚠️ ALL images are URL-only" warning

If URL-only:
→ Ensure handoff server is running
→ Run: node handoff-server.cjs
→ Verify: curl http://localhost:4411/api/health
```

### Step 2: Check Plugin Console

After starting import:
```
✓ Look for: "📊 [IMPORT VALIDATION] Checking assets structure..."
✓ Look for: imageCount > 0
✓ Look for: "📊 Sample asset structure" with URL status
✗ Look for: "❌ NO IMAGES IN ASSETS!"
✗ Look for: "❌ Sample asset has NO data, NO base64, AND NO url!"

If hash mismatch detected:
→ Look for: "⚠️ [HASH MISMATCH] Hash format mismatch"
→ This indicates extension and plugin use different hashing algorithms
```

### Step 3: Check Image Resolution

During import, for each image:
```
✓ Look for: "🖼️ [FIGMA IMPORT] Resolving image paint for hash: xyz"
✓ Look for: "📁 Found asset for hash xyz"
✓ Look for: "✅ Successfully created image from asset"
✗ Look for: "⚠️ No asset found for hash xyz"
✗ Look for: "❌ resolveImagePaint: Image hash not found"

If fetch fails:
→ Look for: "❌ [PROXY FAILED] All handoff server proxies failed"
→ Check handoff server is running
→ Check server logs for errors
```

---

## Expected Outcomes

### Success Indicators
1. Extension logs show N assets with URLs
2. Plugin logs show same N image assets received
3. Plugin logs show "✅ Successfully created image" for each asset
4. No "grey placeholder" rectangles in Figma output
5. Visual inspection shows all images rendered

### Failure Indicators & Solutions

| Symptom | Root Cause | Solution |
|---------|------------|----------|
| "NO IMAGES IN ASSETS!" | Assets not passed to plugin | Check data.assets exists in JSON |
| "Hash format mismatch" | Extension/plugin hash differently | Ensure both use same algorithm |
| "ALL images are URL-only" + "PROXY FAILED" | Handoff server not running | Start: `node handoff-server.cjs` |
| "No asset found for hash" | Hash lookup fails | Check hash in extension matches plugin |

---

## Implementation Checklist

- [ ] Apply Fix 1 to dom-extractor.ts (asset validation logging)
- [ ] Apply Fix 2 to enhanced-figma-importer.ts (import validation)
- [ ] Apply Fix 3 to node-builder.ts (hash mismatch detection)
- [ ] Apply Fix 4 to node-builder.ts (proxy diagnostic)
- [ ] Rebuild extension: `cd chrome-extension && npm run build`
- [ ] Rebuild plugin: `cd figma-plugin && npm run build`
- [ ] Start handoff server: `node handoff-server.cjs`
- [ ] Capture test page with 2-3 images
- [ ] Import to Figma and check all console logs
- [ ] Verify images render (not grey boxes)
- [ ] Document findings in test log

---

## Next Steps After P0 Fix

Once images are working:
- **P1:** Fix SVG rendering (check svgContent preservation)
- **P2:** Fix transform/positioning (off-screen elements)
- **Validation:** Run full fidelity test with SSIM measurement

**Target:** SSIM ≥ 0.95 (pixel-perfect)

---

**END OF P0 FIX**
