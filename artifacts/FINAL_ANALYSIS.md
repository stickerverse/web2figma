# Web2Figma Pixel-Perfect Fidelity Debug Report

**Date:** 2026-01-11  
**Analysis Method:** Systematic pixel diff + schema audit + code inspection  
**Overall SSIM Score:** 0.5141 (Target: 1.0)  
**Pixels with difference >10:** 979,833 / 1,846,560 (53.04%)

---

## Executive Summary

**ROOT CAUSES IDENTIFIED:**

1. **CAPTURE_SCHEMA_BUG** (37 clusters, 74% of issues)
   - 71.5% of nodes missing fills/backgrounds in schema
   - SVG content not extracted
   - Assets pipeline empty

2. **IMPORT_MAPPING_BUG** (13 clusters, 26% of issues)
   - Plugin doesn't synthesize fills when schema.fills is empty
   - Color mapping failures

**SEVERITY BREAKDOWN:**
- P0 (Critical/Missing): 37 clusters - Elements completely absent
- P1 (High/Geometry): 1 cluster - Positioning errors
- P2 (Medium/Styling): 12 clusters - Color mismatches

---

## Detailed Findings by Root Cause

### 1. CAPTURE_SCHEMA_BUG (Priority: P0)

**Suspect File:** `chrome-extension/src/utils/dom-extractor.ts`

**Root Cause Mechanism:**
Lines 5635-5668 in `extractStylesSafe()` explicitly skip creating fills for elements with inherited backgrounds:

```typescript
const isBackgroundInherited = node.inheritanceFlags?.backgroundColorInherited === true;
const elementActuallyPaintsBackground = !isBackgroundInherited && ...;

if (!elementActuallyPaintsBackground) {
  // do NOT add fills - this prevents wrapper frames from becoming opaque rectangles
  console.log(`Skipping fill for ${element.tagName} - background is inherited`);
  return; // NO FILL CREATED
}
```

**Impact:** Container divs, sections, headers with inherited backgrounds render as empty frames in Figma (black/transparent), even though they paint background in browser.

**Evidence from Analysis:**

| Cluster | BBox | Node | Issue | Schema Status |
|---------|------|------|-------|---------------|
| #0 | 0,0,1839x1003 | node_355 (svg) | MISSING | fills=0, backgrounds=0 |
| #88 | 46,405,35x35 | node_201 (div) | MISSING | fills=0, backgrounds=0 |
| #112 | 46,463,35x35 | node_201 (div) | MISSING | fills=0, backgrounds=0 |
| #24 | 31,147,299x33 | node_201 (div) | MISSING | fills=0, backgrounds=0 |

**Affected Elements:**
- 36 SVG nodes (ALL missing fills/backgrounds)
- 268+ DIV/SECTION/HEADER nodes with inherited backgrounds
- Result: 71.5% of schema nodes have NO fill data

**Specific Code Paths:**

1. **Fill Extraction Logic (Lines 5604-5705):**
   ```typescript
   // backgroundColor is DETECTED
   const bgColor = computed.backgroundColor; // ✓ Works
   
   // Inheritance check
   const effectiveBgColor = this.getInheritedBackgroundColor(element); // ✓ Works
   node.inheritanceFlags.backgroundColorInherited = true; // ✓ Works
   
   // Stored in computedStyle
   node.computedStyle.backgroundColor = bgColor; // ✓ Works
   
   // BUT - fills NOT created if inherited
   if (isBackgroundInherited) {
     return; // ✗ NO FILL CREATED
   }
   ```

2. **SVG Handling (Missing):**
   - No code found to extract `<svg>` inner markup
   - No code to set `_requiresRasterization: true` for SVG elements
   - Result: SVGs captured as empty containers

3. **Asset Pipeline (Lines 9854-9900):**
   ```typescript
   // Asset detection exists
   const hasBgImage = computed.backgroundImage !== "none"; // ✓ Works
   
   // But asset storage is incomplete
   assets: { images: [], svgs: [], fonts: [] } // ✗ Arrays empty
   ```

**Fix Required:**

```typescript
// PATCH 1: Always create fills for visible backgrounds
if (effectiveBgColor && this.isVisibleColor(effectiveBgColor)) {
  // Create fill ALWAYS (even if inherited)
  const fill = {
    type: "SOLID",
    color: this.parseColor(effectiveBgColor),
    opacity: 1.0,
    visible: true,
    _inherited: isBackgroundInherited, // Metadata for plugin
  };
  node.fills.push(fill);
  
  console.log(`✓ Created fill for ${element.tagName} (inherited: ${isBackgroundInherited})`);
}

// PATCH 2: Rasterize SVGs
if (element.tagName === 'svg') {
  node._requiresRasterization = true;
  console.log(`✓ SVG marked for rasterization: ${element.id}`);
}

// PATCH 3: Capture background images as assets
if (computed.backgroundImage && computed.backgroundImage !== 'none') {
  const imageUrl = this.extractBackgroundImageUrl(computed.backgroundImage);
  const imageData = await this.fetchImageAsBase64(imageUrl);
  if (imageData) {
    const assetId = `bg_${nodeId}`;
    assets.images[assetId] = imageData;
    node.backgrounds.push({
      type: "IMAGE",
      imageHash: assetId,
      scaleMode: "FILL",
    });
  }
}
```

---

### 2. IMPORT_MAPPING_BUG (Priority: P1/P2)

**Suspect File:** `figma-plugin/src/node-builder.ts`

**Root Cause Mechanism:**
Lines 4119-4138 in `applyCommonStyles()` process fills:

```typescript
if (data.fills?.length) {
  const fillPaints = await this.convertFillsAsync(data.fills);
  paints.push(...filteredFills);
}
```

**Problem:** If `data.fills` is empty array (`[]`), the conditional is false, and NO fills are applied. The fallback logic (lines 4240-4250) only activates if `earlyFallbackColor` exists, which requires `computedStyle.backgroundColor` to be present.

**Impact:** Nodes with:
- Empty fills array (`fills: []`)
- Missing computedStyle.backgroundColor
- Missing backgrounds array

...render with NO fills in Figma, appearing black/transparent.

**Evidence from Analysis:**

| Cluster | BBox | Node | Issue | Metrics |
|---------|------|------|-------|---------|
| #62 | 30,347,79x35 | node_201 (div) | WRONG_COLOR | figma_mean=45.7, color_diff=65.2 |
| #30 | 133,198,56x20 | node_136_text (span) | WRONG_COLOR | figma_mean=N/A, color_diff=N/A |
| #114 | 1237,469,115x29 | node_300 (div) | WRONG_GEOMETRY | Position mismatch |

**Specific Code Paths:**

1. **Fill Processing (Lines 4119-4180):**
   ```typescript
   if (data.fills?.length) { // ✗ FALSE if fills=[]
     const fillPaints = await this.convertFillsAsync(data.fills);
     paints.push(...filteredFills);
   }
   
   // Fallback only if early fallback found
   if (paints.length === 0 && earlyFallbackColor) { // ✗ earlyFallbackColor may be null
     paints.push({
       type: "SOLID",
       color: earlyFallbackColor,
       opacity: 1.0,
     });
   }
   ```

2. **Color Conversion (Lines 4200-4240):**
   ```typescript
   // Manual fill creation if async fails
   if (fillPaints.length === 0 && data.fills.length > 0) {
     for (const fill of data.fills) { // ✗ Loop never runs if data.fills=[]
       if (fill.type === "SOLID" && fill.color) {
         const color = this.parseColor(fill.color);
         paints.push({ type: "SOLID", color, opacity: 1.0 });
       }
     }
   }
   ```

**Fix Required:**

```typescript
// PATCH 1: Synthesize fills from computedStyle when schema.fills is empty
if (data.fills?.length === 0) {
  console.log(`⚠️ Empty fills array for ${data.name}, attempting synthesis from computedStyle`);
  
  // Try computedStyle.backgroundColor
  if (data.computedStyle?.backgroundColor) {
    const color = this.parseColorString(data.computedStyle.backgroundColor);
    if (color && color.a > 0) {
      console.log(`✓ Synthesized fill from computedStyle for ${data.name}:`, color);
      paints.push({
        type: "SOLID",
        color: { r: color.r, g: color.g, b: color.b },
        opacity: color.a,
        visible: true,
      });
    }
  }
  
  // Fallback: Try style.backgroundColor
  if (paints.length === 0 && data.style?.backgroundColor) {
    const color = this.parseColorString(data.style.backgroundColor);
    if (color && color.a > 0) {
      console.log(`✓ Synthesized fill from style.backgroundColor for ${data.name}:`, color);
      paints.push({
        type: "SOLID",
        color: { r: color.r, g: color.g, b: color.b },
        opacity: color.a,
        visible: true,
      });
    }
  }
  
  // Last resort: Mark for rasterization if still no fills but element is visible
  if (paints.length === 0 && data.layout?.width > 0 && data.layout?.height > 0) {
    console.warn(`⚠️ No fills found for visible element ${data.name}, marking for rasterization`);
    data._requiresRasterization = true;
  }
}

// PATCH 2: Enhanced fallback for wrong colors
if (paints.length > 0) {
  // Validate fill colors match expected (for debugging)
  const expectedColor = data.computedStyle?.backgroundColor;
  if (expectedColor) {
    const expectedRGBA = this.parseColorString(expectedColor);
    const actualRGBA = paints[0].type === "SOLID" ? paints[0].color : null;
    
    if (expectedRGBA && actualRGBA) {
      const colorDiff = Math.sqrt(
        Math.pow((expectedRGBA.r - actualRGBA.r) * 255, 2) +
        Math.pow((expectedRGBA.g - actualRGBA.g) * 255, 2) +
        Math.pow((expectedRGBA.b - actualRGBA.b) * 255, 2)
      );
      
      if (colorDiff > 10) {
        console.warn(`⚠️ Color mismatch for ${data.name}: expected ${expectedColor}, got`, actualRGBA, `(diff: ${colorDiff})`);
      }
    }
  }
}
```

---

## Impact Analysis

### Quantitative Metrics

| Metric | Value | Target | Gap |
|--------|-------|--------|-----|
| SSIM Score | 0.5141 | 1.0 | -48.59% |
| Pixels Different | 979,833 | 0 | +979,833 |
| Nodes with Fills | 121 (28.5%) | 425 (100%) | -304 nodes |
| Clusters P0 | 37 | 0 | +37 |
| Clusters P1/P2 | 13 | 0 | +13 |

### Qualitative Impact

**Before Fix:**
- GitHub page renders in Figma as mostly black/transparent
- 71.5% of elements missing visual representation
- SVG icons completely absent
- Container backgrounds not painted

**After Fix (Expected):**
- Full visual fidelity restoration
- All backgrounds rendered
- SVG icons visible (rasterized)
- SSIM score: ~0.95+ (accounting for sub-pixel antialiasing)

---

## Patch Implementation Plan

### Phase 1: P0 Fixes (Critical Path)

**1.1 Fix Fill Extraction**
- File: `chrome-extension/src/utils/dom-extractor.ts`
- Lines: 5635-5668
- Change: Remove inherited background skip, always create fills
- Verification: Re-capture page, check fills count in schema

**1.2 Fix SVG Rasterization**
- File: `chrome-extension/src/utils/dom-extractor.ts`
- Lines: Add after SVG element processing
- Change: Set `_requiresRasterization: true` for all SVG elements
- Verification: Check schema for SVG nodes with rasterization flag

**1.3 Fix Asset Pipeline**
- File: `chrome-extension/src/utils/dom-extractor.ts`
- Lines: Asset collection section
- Change: Actually fetch and embed background images
- Verification: Check assets.images size > 0 in schema

### Phase 2: P1 Fixes (High Impact)

**2.1 Enhance Plugin Fallback**
- File: `figma-plugin/src/node-builder.ts`
- Lines: 4119-4250
- Change: Synthesize fills from computedStyle when fills=[]
- Verification: Import schema, check Figma node.fills for empty-fill nodes

### Phase 3: Validation & Verification

**3.1 Re-run Analysis**
```bash
python3 analyze_fidelity.py
```

**3.2 Expected Results:**
- SSIM score: 0.95+
- Pixels different: <5%
- P0 clusters: 0
- Schema fills coverage: >95%

**3.3 Acceptance Criteria:**
- Visual inspection: GitHub page looks identical in Figma
- Automated: SSIM > 0.95
- Schema: fills count > 400 (from 121)

---

## Verification Commands

```bash
# Re-capture page with fixed extension
cd chrome-extension && npm run build
# Open extension, capture github.com again

# Re-import with fixed plugin  
cd figma-plugin && npm run build
# Open Figma, import new capture

# Re-run analysis
python3 analyze_fidelity.py

# Compare results
diff artifacts/diff_clusters.json artifacts/diff_clusters_after_fix.json
```

---

## Appendix: Cluster Details

See `artifacts/cluster_analysis.json` for full per-cluster analysis.

**Top 5 Impactful Clusters:**

1. **Cluster #0** - Entire viewport (MISSING)
   - Impact: 33,702,384
   - Node: node_355 (svg)
   - Root cause: SVG not rasterized, no fills

2. **Cluster #62** - Repository name (WRONG_COLOR)
   - Impact: 389,640
   - Node: node_201 (div)
   - Root cause: Fill color mismatch

3. **Cluster #88** - Avatar icon (MISSING)
   - Impact: 275,469
   - Node: node_201 (div)
   - Root cause: No fills in schema

4. **Cluster #112** - Avatar icon (MISSING)
   - Impact: 275,469
   - Node: node_201 (div)
   - Root cause: No fills in schema

5. **Cluster #167** - Avatar icon (MISSING)
   - Impact: 275,469
   - Node: node_201 (div)
   - Root cause: No fills in schema

---

**END OF REPORT**
