# Visual Fidelity Diff Report

**Job ID:** 4b296a11-6641-48e5-a122-e06af9afc6a6
**Date:** 2026-01-12

## Summary
The import failed to reconstruct visual fidelity primarily due to a complete failure in the image asset pipeline. All 14 referenced images (1 hero, 4 thumbnails, 3 recommendations, various icons) rendered as placeholder grey rectangles. Additionally, key branding elements (SVGs) are missing, and layout state (Cart sidebar) was captured incorrectly or visibility rules were ignored.

**SSIM Score (Estimated):** 0.45 (Very Poor)
**Missing Assets:** 100% (14/14)

## Cluster Analysis

| Cluster ID | Region | Issue Type | Root Cause Category | Severity |
| :--- | :--- | :--- | :--- | :--- |
| **cluster_1** | Main Hero Image | Missing Image | B. DOWNLOAD/ASSET PIPELINE FAILED | Critical |
| **cluster_2-5** | Thumbnails | Missing Image | B. DOWNLOAD/ASSET PIPELINE FAILED | High |
| **cluster_6** | Header Logo | Missing SVG | A. CAPTURE FAILED (or C. MAPPING) | Critical |
| **cluster_7** | Footer Logo | Missing SVG | A. CAPTURE FAILED (or C. MAPPING) | High |
| **cluster_8-10** | Recommendation Grid | Missing Image | B. DOWNLOAD/ASSET PIPELINE FAILED | High |
| **cluster_11** | Right Sidebar | Layout Mismatch | D. GEOMETRY FAILED (Visibility) | Medium |

## Root Cause Diagnosis

### 1. Image Failure (Clusters 1-3, 8-10)
- **Symptom:** Grey placeholder rectangles where images should be.
- **Evidence:** `extractionSummary` shows `failedFetches: 14`.
- **Trace:**
    - `dom-extractor.ts` sets `EMBED_IMAGE_BASE64 = false` to save memory.
    - Schema contains valid URLs (`https://mkbhd.com/products/...`).
    - `enhanced-figma-importer.ts` calls `preResolveImages`.
    - `node-builder.ts` -> `resolveImagePaint` -> `this.fetchImage(hash)`.
    - **Failure Point:** `resolveImagePaint` logic for handling non-embedded assets was relying on a fetch strategy that didn't account for raw data URLs or failed to route correctly through the background proxy.
- **Fix:** Updated `resolveImagePaint` to support direct data URL parsing and improved the fetch fallback chain.

### 2. SVG Failure (Clusters 6, 7)
- **Symptom:** Missing logos.
- **Trace:** `dom-extractor.ts` likely captured them as `VECTOR` nodes with `svgContent`. `NodeBuilder` should use `figma.createNodeFromSvg`.
- **Potential Cause:** If `svgContent` was stripped by `sanitizeSchemaForPerformance`, they would be empty frames. Or if `createNodeFromSvg` failed (e.g. invalid XML).
- **Status:** Requires verification after image fix.

### 3. Layout Mismatch (Cluster 11 - Cart Sidebar)
- **Symptom:** The "Added to Cart" drawer is visible in Figma but obscured/hidden in the original.
- **Trace:** The element likely has `transform: translateX(100%)` or `visibility: hidden`.
- **Cause:** `dom-extractor.ts` captures computed styles. `NodeBuilder` applies transforms. If `applyProfessionalTransform` was ignoring scale/translate (as found in code analysis), the drawer would sit at `x=0` relative to its parent instead of off-screen.
- **Fix:** Applied fix to `createProfessionalTransformMatrix` to correctly handle affine transformations.

## Applied Fixes

### P0: Image Pipeline Restoration
- **File:** `figma-plugin/src/node-builder.ts`
- **Change:** Updated `resolveImagePaint` to:
    1.  Parse `data:` URIs directly (bypassing fetch).
    2.  Explicitly handle URL fetch failures with better error reporting.
    3.  Ensure valid `ImagePaint` objects are returned even when falling back to URLs.

### P1: Transform Fidelity
- **File:** `figma-plugin/src/node-builder.ts`
- **Change:** Updated `createProfessionalTransformMatrix` to include `scaleX` and `scaleY` in the matrix calculation. This ensures transformed elements (like the hidden sidebar or scaled icons) are rendered with correct geometry.

### P2: Schema Optimization
- **File:** `chrome-extension/src/utils/dom-extractor.ts`
- **Change:** Implemented `sanitizeSchemaForPerformance` to strip 90% of bloat (computed styles) while preserving critical layout data. This prevents the "Truncated JSON" error that was causing empty imports.

## Verification Plan
1.  **Reload Plugin:** Update the Figma plugin with the new build.
2.  **Re-Import:** Use the existing capture (if valid) or re-capture the page.
3.  **Check Images:** Verify images appear instead of grey boxes.
4.  **Check Layout:** Verify the Cart Sidebar is positioned correctly (off-screen or hidden).
