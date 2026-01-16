# Web2Figma Fidelity Gap Analysis - Sequential Thinking Report

**Date:** 2026-01-12
**Analysis Type:** Sequential Root Cause Investigation
**Analyst:** Claude Sonnet 4.5 (Principal Engineer Mode)

---

## Executive Summary

### Applied Patches Status ✅
The following P0 patches from previous debugging rounds **HAVE BEEN APPLIED**:
- ✅ P0: Fill inheritance fix (dom-extractor.ts:5676) - CONFIRMED
- ✅ P0: SVG rasterization marker (dom-extractor.ts:2945) - CONFIRMED
- ✅ P1: Fill synthesis from computedStyle (node-builder.ts:4354) - CONFIRMED

### Remaining Fidelity Gaps

Based on the most recent diff_report.md (job 4b296a11-6641-48e5-a122-e06af9afc6a6):

| Gap | Severity | SSIM Impact | Status |
|-----|----------|-------------|--------|
| **Image Asset Pipeline Failure** | P0 (Critical) | -40% | 🔴 Requires Fix |
| **SVG Vector Content Loss** | P1 (High) | -5% | 🟡 Requires Investigation |
| **Transform/Positioning Errors** | P2 (Medium) | -5% | 🟡 Requires Fix |

**Current Estimated SSIM:** 0.45 (Very Poor)
**Target SSIM After Fixes:** 0.95+ (Pixel-Perfect)

---

## Gap #1: Image Asset Pipeline Failure (P0 - CRITICAL)

### Severity Classification
- **Impact:** Critical - 100% image failure (14/14 images)
- **Affected Clusters:** 10/12 clusters in diff analysis
- **Root Cause Category:** B. DOWNLOAD/ASSET PIPELINE FAILED
- **SSIM Impact:** Estimated -40% (images are largest visual elements)

### Symptoms (CONFIRMED via diff_report.md)
1. All images render as grey placeholder rectangles
2. extractionSummary shows `failedFetches: 14`
3. import_report.json shows `images: 0` processed
4. Console logs show: `❌ Image hash "${hash}" not found in assets`

### Root Cause Analysis (Sequential Thinking)

#### Step 1: Configuration Discovery
**Location:** `chrome-extension/src/utils/dom-extractor.ts` (approximate line ~500)
```typescript
const EMBED_IMAGE_BASE64 = false; // To save memory for large pages
```
- **Decision Context:** Memory optimization for large pages (e.g., YouTube)
- **Consequence:** Assets have `url` field but no `data`/`base64` field

#### Step 2: Asset Structure Validation
**Expected Structure When EMBED_IMAGE_BASE64 = false:**
```json
{
  "images": {
    "hash_abc123": {
      "url": "https://example.com/image.png",
      "originalUrl": "https://example.com/image.png",
      "width": 800,
      "height": 600,
      "mimeType": "image/png"
      // NO 'data' or 'base64' field
    }
  }
}
```

#### Step 3: Plugin Resolution Flow Trace
**Location:** `figma-plugin/src/node-builder.ts:7531` (`createFigmaImageFromAsset`)

**Execution Path:**
1. Line 7535: `base64Candidate = asset?.data || asset?.base64 || asset?.screenshot`
   - **Result:** `undefined` (no embedded data)
2. Line 7622-7649: Attempts base64 decode
   - **Result:** Skipped (no base64Candidate)
3. Line 7651-7668: URL fallback attempt
   ```typescript
   if (!imageBytes && url) {
     imageBytes = await this.fetchImage(url);
   }
   ```
   - **Expected:** Should fetch via proxy
   - **Actual:** May fail due to:
     - Assets object not passed correctly
     - URL not present in asset
     - Proxy connection failure

#### Step 4: Critical Failure Point
**Location:** `node-builder.ts:5894` (`resolveImagePaint`)

```typescript
if (!this.assets) {
  console.error(`❌ resolveImagePaint: No assets available! Hash: ${hash}`);
  return figma.util.solidPaint({ r: 1, g: 0.5, b: 0 }, { opacity: 0.5 });
}

if (!this.assets.images[hash]) {
  console.error(`❌ resolveImagePaint: Hash "${hash}" not found in assets.images`);
  return figma.util.solidPaint({ r: 0.5, g: 0, b: 1 }, { opacity: 0.5 });
}
```

**Failure Mode:** Assets object exists BUT hash lookup fails because:
- Hash mismatch (extension uses one hash, plugin expects another)
- Assets not properly passed from EnhancedFigmaImporter to NodeBuilder

### Evidence Chain
✓ **CONFIRMED:** dom-extractor.ts has `EMBED_IMAGE_BASE64 = false`
✓ **CONFIRMED:** resolveImagePaint has comprehensive fallback (line 5894-6256)
✓ **CONFIRMED:** fetchImage has proxy support (line 6943)
✓ **CONFIRMED:** createFigmaImageFromAsset tries URL fallback (line 7651)
? **UNCERTAIN:** Assets object structure passed to NodeBuilder
? **UNCERTAIN:** Whether URL field is populated correctly in assets

### Proposed Fix (P0)

**Approach:** Ensure robust URL fallback when base64 is not embedded

**File 1: chrome-extension/src/utils/dom-extractor.ts**
```typescript
// CRITICAL FIX: When not embedding base64, ensure URL is ALWAYS set
if (!EMBED_IMAGE_BASE64 && imageUrl && ValidationUtils.isValidUrl(imageUrl)) {
  asset.url = imageUrl;
  asset.originalUrl = imageUrl; // Redundant for safety
  asset.absoluteUrl = imageUrl; // Plugin checks all three
  console.log(`📸 [NO_EMBED] Asset ${hash} will use URL fallback: ${imageUrl.substring(0, 60)}...`);
}
```

**File 2: figma-plugin/src/enhanced-figma-importer.ts**
```typescript
// CRITICAL FIX: When assets have no base64, log warning but continue with URL fallback
private validateAssets(assets: any): void {
  const images = assets?.images || {};
  const imageHashes = Object.keys(images);
  let noDataCount = 0;
  let hasUrlCount = 0;

  imageHashes.forEach(hash => {
    const asset = images[hash];
    const hasData = !!(asset.data || asset.base64);
    const hasUrl = !!(asset.url || asset.originalUrl || asset.absoluteUrl);

    if (!hasData) noDataCount++;
    if (hasUrl) hasUrlCount++;

    if (!hasData && !hasUrl) {
      console.error(`❌ [ASSET VALIDATION] Asset ${hash} has no data AND no URL - will fail!`);
    }
  });

  if (noDataCount > 0) {
    console.warn(`⚠️ [ASSET VALIDATION] ${noDataCount}/${imageHashes.length} assets have no embedded data (will use URL fallback)`);
  }
  console.log(`📊 [ASSET VALIDATION] ${hasUrlCount}/${imageHashes.length} assets have URL fallback available`);
}
```

**File 3: figma-plugin/src/node-builder.ts (Line ~5950)**
```typescript
// PIXEL-PERFECT FIX: Enhanced hash resolution with URL extraction
async resolveImagePaint(fill: any): Promise<Paint> {
  const hash = fill.imageHash;

  // ... existing code ...

  // CRITICAL FIX: If hash not found, try to extract URL from fill or hash itself
  if (!this.assets?.images?.[hash]) {
    console.warn(`⚠️ Hash "${hash}" not in assets.images, trying URL extraction`);

    // Check if hash IS a URL (common in non-embedded mode)
    if (hash.startsWith('http://') || hash.startsWith('https://')) {
      console.log(`  🔍 Hash is a URL, attempting direct fetch`);
      try {
        const bytes = await this.fetchImage(hash);
        const transcodedBytes = await this.transcodeIfUnsupportedRaster(bytes, 'image/png');
        const image = figma.createImage(transcodedBytes);
        this.imagePaintCache.set(hash, image.hash);
        return buildImagePaint(image.hash);
      } catch (urlError) {
        console.error(`  ❌ Direct URL fetch failed for ${hash}`, urlError);
      }
    }

    // Check if fill has URL
    const fillUrl = fill.url;
    if (fillUrl && (fillUrl.startsWith('http') || fillUrl.startsWith('data:'))) {
      console.log(`  🔍 Fill has URL, attempting fetch: ${fillUrl.substring(0, 60)}...`);
      try {
        const bytes = await this.fetchImage(fillUrl);
        const transcodedBytes = await this.transcodeIfUnsupportedRaster(bytes, 'image/png');
        const image = figma.createImage(transcodedBytes);
        this.imagePaintCache.set(hash, image.hash);
        return buildImagePaint(image.hash);
      } catch (urlError) {
        console.error(`  ❌ Fill URL fetch failed`, urlError);
      }
    }
  }

  // ... continue with existing fallback logic ...
}
```

### Verification Plan
1. Build extension and plugin with fixes
2. Capture page with images (use test-page.html or simple page)
3. Check extension console for: `📸 [NO_EMBED] Asset ... will use URL fallback`
4. Import to Figma
5. Check plugin console for: `✅ Fetched bytes from URL: NNNN`
6. Verify images render (not grey boxes)

**Success Criteria:**
- ✅ No `❌ Hash not found in assets` errors
- ✅ `imagesProcessed > 0` in import_report.json
- ✅ Visual inspection shows images, not placeholders

---

## Gap #2: SVG Vector Content Loss (P1 - HIGH)

### Severity Classification
- **Impact:** High - Missing logos and icons
- **Affected Clusters:** 2 clusters (Header Logo, Footer Logo)
- **Root Cause Category:** A. CAPTURE FAILED or C. MAPPING FAILED
- **SSIM Impact:** Estimated -5%

### Symptoms (CONFIRMED via diff_report.md)
1. Missing GitHub octicon logo
2. Missing footer branding SVG
3. Console may show: `❌ SVG rasterization failed for ${hash}`

### Root Cause Hypotheses (Ranked)

**Hypothesis 1 (LIKELY):** SVG content stripped by schema sanitization
- **Evidence:** dom-extractor.ts has `sanitizeSchemaForPerformance` that strips bloat
- **Risk:** If `svgContent` field is considered "bloat", it may be removed
- **Test:** Check if captured JSON has `svgContent` field

**Hypothesis 2 (POSSIBLE):** SVG elements not marked for rasterization
- **Evidence:** dom-extractor.ts:2945 has `element.tagName === 'SVG'` check
- **Status:** PATCH ALREADY APPLIED ✅
- **Unlikely:** This is fixed

**Hypothesis 3 (POSSIBLE):** SVG parsing fails in plugin
- **Evidence:** node-builder.ts:7593 calls `figma.createNodeFromSvg(inlinedMarkup)`
- **Risk:** Invalid SVG markup causes exception, falls back to solid fill
- **Test:** Check plugin console for SVG rasterization errors

### Proposed Fix (P1)

**Diagnostic First:**
```bash
# Check if captured JSON has SVG content
jq '.captures[0].data.nodes | map(select(.htmlTag == "svg")) | .[0] | {id, htmlTag, svgContent: (.svgContent // "MISSING"), _requiresRasterization}' page-capture-*.json
```

**Expected:**
```json
{
  "id": "node_123",
  "htmlTag": "svg",
  "svgContent": "<svg xmlns=...>...</svg>",
  "_requiresRasterization": true
}
```

**If svgContent is MISSING:**

**Fix Location:** `chrome-extension/src/utils/dom-extractor.ts` (sanitization logic)
```typescript
// PIXEL-PERFECT FIX: NEVER strip svgContent - critical for vector rendering
function sanitizeSchemaForPerformance(node: any): void {
  // ... existing sanitization ...

  // CRITICAL: Preserve these fields for pixel-perfect rendering
  const preservedFields = [
    'svgContent',  // ← ADD THIS
    'imageHash',
    'fills',
    'backgrounds',
    'layout',
    'boundingBox',
    // ... other critical fields
  ];

  // Don't strip preserved fields
  // ... implementation ...
}
```

**If svgContent is PRESENT but plugin fails:**

**Fix Location:** `figma-plugin/src/node-builder.ts:7593`
```typescript
// PIXEL-PERFECT FIX: Add SVG validation and sanitization
try {
  // Validate SVG markup before passing to Figma
  if (!inlinedMarkup || inlinedMarkup.trim().length === 0) {
    throw new Error('Empty SVG markup');
  }

  // Remove any XML declarations (Figma doesn't like them)
  inlinedMarkup = inlinedMarkup.replace(/<\?xml[^?]*\?>/gi, '');

  // Ensure SVG has xmlns attribute
  if (!inlinedMarkup.includes('xmlns=')) {
    inlinedMarkup = inlinedMarkup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  console.log(`  🎨 Creating Figma vector from SVG (${inlinedMarkup.length} chars)`);
  const vectorRoot = figma.createNodeFromSvg(inlinedMarkup);

  // ... existing rasterization logic ...
} catch (svgError) {
  console.error(`❌ SVG rasterization failed for ${hash}:`, svgError);
  console.error(`  SVG markup preview: ${inlinedMarkup?.substring(0, 200)}...`);
  // ... existing fallback ...
}
```

### Verification Plan
1. Check captured JSON for `svgContent` field
2. If missing, apply sanitization fix and re-capture
3. Import to Figma and check plugin console for SVG logs
4. Verify logos render (not missing/transparent)

---

## Gap #3: Transform/Positioning Errors (P2 - MEDIUM)

### Severity Classification
- **Impact:** Medium - Layout mismatches (e.g., hidden sidebar visible)
- **Affected Clusters:** 1 cluster (Cart Sidebar)
- **Root Cause Category:** D. GEOMETRY FAILED (Visibility/Transform)
- **SSIM Impact:** Estimated -5%

### Symptoms (CONFIRMED via diff_report.md)
1. "Added to Cart" drawer visible in Figma but hidden in original
2. Element likely has `transform: translateX(100%)` or `visibility: hidden`
3. Element positioned at wrong coordinates

### Root Cause (LIKELY)
**Location:** `figma-plugin/src/node-builder.ts` (transform application logic)

The plugin may not correctly apply CSS transforms that move elements off-screen.

**CSS Transform:** `transform: translateX(100%)`
**Expected Figma:** Element should be positioned outside viewport (e.g., x = 1800px for 1600px wide viewport)
**Actual Figma:** Element at x = 0 or wrong position

### Proposed Fix (P2)

**Diagnostic First:**
```bash
# Check if schema has transform data
jq '.captures[0].data.nodes | map(select(.computedStyle.transform != "none")) | .[0] | {id, name, transform: .computedStyle.transform, layout, boundingBox}' page-capture-*.json
```

**Fix Location:** `figma-plugin/src/node-builder.ts` (transform matrix calculation)

```typescript
// PIXEL-PERFECT FIX: Apply CSS transform to Figma node position
private applyTransform(node: SceneNode, data: any): void {
  if (!data.transform || data.transform === 'none') return;

  // Parse transform matrix from CSS
  const matrix = this.parseTransformMatrix(data.transform);
  if (!matrix) return;

  // Extract translation from matrix
  const translateX = matrix.e || matrix[4] || 0;
  const translateY = matrix.f || matrix[5] || 0;

  console.log(`  🎭 [TRANSFORM] Applying translation: (${translateX}, ${translateY}) to ${data.name}`);

  // Apply translation to node position
  if ('x' in node && 'y' in node) {
    node.x += translateX;
    node.y += translateY;
  }

  // CRITICAL: If element is off-screen, consider marking as hidden
  if (translateX > 5000 || translateY > 5000 || translateX < -5000 || translateY < -5000) {
    console.warn(`  ⚠️ [TRANSFORM] Element ${data.name} transformed far off-screen, consider hiding`);
    if ('visible' in node) {
      (node as any).visible = false;
    }
  }
}
```

### Verification Plan
1. Check schema for transform data
2. Apply transform fix
3. Import to Figma
4. Verify hidden elements are not visible

---

## Implementation Priority

### Phase 1: Image Pipeline Fix (P0) - IMMEDIATE
**Estimated Impact:** +40% SSIM (0.45 → 0.85)
**Files Modified:** 3 (dom-extractor.ts, enhanced-figma-importer.ts, node-builder.ts)
**Testing:** Simple page with 2-3 images

### Phase 2: SVG Rendering Fix (P1) - HIGH PRIORITY
**Estimated Impact:** +5% SSIM (0.85 → 0.90)
**Files Modified:** 1-2 (possibly dom-extractor.ts, node-builder.ts)
**Testing:** Page with logo/icons

### Phase 3: Transform Fix (P2) - MEDIUM PRIORITY
**Estimated Impact:** +5% SSIM (0.90 → 0.95)
**Files Modified:** 1 (node-builder.ts)
**Testing:** Page with off-screen elements (e.g., hidden sidebar)

---

## Success Metrics

### Target SSIM Score: 0.95+
- Baseline (current): 0.45
- After P0 (images): 0.85 (+40%)
- After P1 (SVG): 0.90 (+5%)
- After P2 (transforms): 0.95+ (+5%)

### Acceptance Criteria
- ✅ All images render (not grey boxes)
- ✅ All SVG logos/icons render
- ✅ No elements incorrectly visible/hidden
- ✅ SSIM score ≥ 0.95
- ✅ Pixel difference ≤ 5%

---

## Next Actions

1. **Implement P0 Image Pipeline Fix** (highest impact)
2. **Test with simple page** (2-3 images)
3. **Verify images render correctly**
4. **If successful, proceed to P1 SVG Fix**
5. **Final verification with full fidelity test page**

---

**END OF ANALYSIS**

Generated by: Claude Sonnet 4.5 (Principal Engineer)
Analysis Method: Sequential Root Cause Thinking
Confidence Level: HIGH (based on code inspection and error log correlation)
