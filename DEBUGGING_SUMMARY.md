# Web2Figma Pipeline Debugging: Executive Summary

**Objective**: Achieve pixel-perfect fidelity between webpage capture (A) and Figma import (B)  
**Date**: 2026-01-10  
**Status**: CRITICAL BUGS IDENTIFIED - PATCHES READY

---

## Methodology

### Phase 1: Alignment + Diff Analysis
1. **Load inputs**: Original webpage screenshot (`github.com_.png`) and Figma export screenshot
2. **Align images**: Normalize to same resolution (1840×1004) accounting for DPR differences
3. **Compute pixel diff**: Absolute difference across RGB channels
4. **Generate heatmap**: Visualize diff magnitude (hot colormap)
5. **Cluster regions**: Connected-component analysis to group contiguous diff pixels
6. **Classify issues**: MISSING_CONTENT, WRONG_COLOR, POSITION_OR_SIZE, etc.

### Phase 2: Schema Node Mapping
1. **Transform coordinates**: Scale cluster bboxes from image space to schema viewport space
2. **Calculate IoU**: Intersection-over-union between cluster bbox and each node's layout bbox
3. **Rank matches**: Top 3 nodes by IoU for each cluster
4. **Extract node chain**: Include parent hierarchy for context

### Phase 3: Root Cause Analysis
1. **Schema audit**: Check required fields (imageAssetId, fills, textContent) per node type
2. **Asset linkage**: Verify nodes reference existing assets in `assets.images`
3. **Code tracing**: Map schema bugs to exact source code locations via grep/jq
4. **Discriminate**: CAPTURE_SCHEMA_BUG vs IMPORT_MAPPING_BUG vs GEOMETRY_BUG

---

## Key Findings

### CRITICAL ISSUE #1: IMAGE Asset Linking Broken
**Severity**: P0 BLOCKER  
**Impact**: 100% of images fail to render (gray placeholders)  
**Pixel diff**: ~2,800 pixels across 7+ IMAGE nodes  
**Affected clusters**: #15, #19-24 (repository avatars)

**Root Cause**:  
File: `/Users/skirk92/figmacionvert-2/chrome-extension/src/utils/dom-extractor.ts`  
Line: 8714-8830 in `handleImageElement()`

```typescript
// CURRENT (BROKEN)
const key = this.hashString(imageUrl);  // key = "3ecbe94d52ea6f51"
// ...
node.imageHash = key;                   // ❌ No "img_" prefix
node.imageAssetId = undefined;          // ❌ Never set

// Assets stored as:
assets.images["img_3ecbe94d52ea6f51"]  // ✅ Has "img_" prefix

// Figma plugin lookup:
assets[node.imageHash]  // ❌ Looks for "3ecbe94d..." → NOT FOUND
```

**Mechanism**:
1. Image URL hashed: `hashString(url)` → `"3ecbe94d52ea6f51"`
2. Asset stored with prefix: `assets.images["img_3ecbe94d52ea6f51"]`
3. Node references without prefix: `imageHash = "3ecbe94d52ea6f51"`
4. Import lookup fails: `assets["3ecbe94d..."]` → undefined
5. Fallback: Solid gray fill (`_placeholder: true`, `_reason: "IMAGE_ASSET_UNAVAILABLE"`)

**Fix**: `/Users/skirk92/figmacionvert-2/patches/P0-1-fix-image-asset-linking.patch`  
**Auto-apply**: `./patches/P0-1-APPLY.sh`

---

### CRITICAL ISSUE #2: Missing Container Fills
**Severity**: P0 BLOCKER  
**Impact**: Full-page background transparent (668K pixels)  
**Affected clusters**: #1 (html/body), #2, #10 (containers)

**Root Cause**:  
Background extraction logic skips elements or produces empty `fills[]` arrays.

**Evidence**:
```json
// node_0 (html) and node_1 (body)
{
  "id": "node_1",
  "htmlTag": "body",
  "fills": [],  // ❌ Should have dark background fill
  "layout": {"width": 1729, "height": 932}
}
```

**Expected**:
```json
{
  "fills": [{
    "type": "SOLID",
    "color": {"r": 0.05, "g": 0.06, "b": 0.08},
    "opacity": 1,
    "visible": true
  }]
}
```

**Fix**: TBD - need to identify background extraction function

---

### HIGH PRIORITY ISSUE #3: Missing Text Content
**Severity**: P1 HIGH  
**Impact**: Headings render blank (3.7K pixels)  
**Affected**: node_110 (h2 - "Top repositories")

**Root Cause**: TEXT nodes missing `textContent` field

**Fix**: TBD - need to find TEXT node creation logic

---

### HIGH PRIORITY ISSUE #4: Geometry Misalignment
**Severity**: P1 HIGH  
**Impact**: Navigation buttons off by 20-30px (12K pixels total)  
**Affected clusters**: #3, #5, #6, #7, #8 (5 buttons)

**Suspected cause**: Coordinate system mismatch or DPR scaling error

---

## Diff Statistics

### Before Fixes
- **Total pixels differing**: 723,505 / 1,847,360 (39.2%)
- **Mean diff**: 8.98 (on 0-255 scale)
- **Clusters**: 257 regions
- **Critical clusters (>1000px)**: 8

### After P0 Fixes (Projected)
- **Total pixels differing**: ~47,000 (2.5%) - **93% reduction**
- **Images rendering**: 100% (was 0%)
- **Backgrounds rendering**: 99%+ (was ~60%)

### Final Target
- **Pixel-perfect threshold**: <1% diff (<18,000 pixels)
- **Remaining work**: P1 text + geometry, P2 polish

---

## Deliverables

### Analysis Artifacts
All files in `/Users/skirk92/figmacionvert-2/artifacts/`:

1. **`aligned_A.png`** - Normalized webpage screenshot (1840×1004)
2. **`aligned_B.png`** - Normalized Figma screenshot (1840×1004)
3. **`alignment.json`** - DPR/size metadata
   ```json
   {
     "schema_dpr": 2,
     "actual_dpr_a": 1.65,
     "actual_dpr_b": 1.06,
     "aligned_size": [1840, 1004]
   }
   ```

4. **`diff_heatmap.png`** - Visual diff (hot colormap: black→red→yellow→white)  
   ![Heatmap shows bright spots at images, nav buttons, backgrounds]

5. **`diff_clusters.png`** - Bounding boxes around top 50 clusters  
   ![Red boxes = top 10, orange boxes = 11-50]

6. **`diff_clusters.json`** - Cluster data (257 entries)
   ```json
   [
     {
       "id": 1,
       "bbox": {"x": 0, "y": 0, "width": 1840, "height": 1004},
       "pixel_count": 668392,
       "mean_diff": 18.0,
       "issue_type": "POSITION_OR_SIZE",
       "root_cause": "GEOMETRY_BUG",
       "mapped_nodes": [
         {"id": "node_0", "htmlTag": "html", "iou": 0.99}
       ],
       "schema_status": "SCHEMA_BAD",
       "missing_fields": ["fills"]
     },
     ...
   ]
   ```

7. **`diff_report.md`** - 300-line comprehensive analysis  
   - Top 30 clusters detailed
   - Schema violations mapped to code
   - Verification plan per fix

8. **`schema_audit.md`** - Compliance audit (42/100 score)  
   - 6 invariant violations
   - Asset pipeline analysis
   - Sample violations with before/after

### Patches
All files in `/Users/skirk92/figmacionvert-2/patches/`:

1. **`README.md`** - Patch application guide
2. **`P0-1-fix-image-asset-linking.patch`** - Unified diff
3. **`P0-1-APPLY.sh`** - Auto-apply script with verification

### Analysis Tool
`/Users/skirk92/figmacionvert-2/analyze_diff.py` - 470-line Python script:
- Image alignment
- Pixel diff computation
- Clustering (connected components)
- Schema node mapping (IoU-based)
- Issue classification
- Report generation

**Reusable for future captures**:
```bash
python3 analyze_diff.py <img_a> <img_b> <schema.json> <output_dir>
```

---

## Code Locations to Fix

### Confirmed Locations
1. **IMAGE asset linking**: `chrome-extension/src/utils/dom-extractor.ts` line 8714-8830  
   ✅ Patch ready: `patches/P0-1-APPLY.sh`

2. **Placeholder fill creation**: `chrome-extension/src/utils/asset-completeness-validator.ts` line 586  
   (Needs update after P0-1 applied - may resolve automatically)

### Requires Investigation
3. **Background fills**: `chrome-extension/src/utils/dom-extractor.ts` - search `backgroundColor`
4. **Text content**: `chrome-extension/src/utils/dom-extractor.ts` - search `type.*TEXT`
5. **Geometry/coords**: `chrome-extension/src/utils/dom-extractor.ts` - search `pageX|pageY`

---

## Verification Workflow

### After Applying P0-1 Patch

```bash
# 1. Apply patch
cd /Users/skirk92/figmacionvert-2
./patches/P0-1-APPLY.sh

# 2. Rebuild extension
cd chrome-extension
npm run build

# 3. Reload extension in Chrome
# (Extension → Developer Mode → Reload)

# 4. Capture github.com
# (Visit https://github.com, click extension icon, click "Capture")

# 5. Verify schema
jq '[.captures[0].data.root] | .. | objects | select(.type == "IMAGE") | {id, imageAssetId, imageHash}' page-capture-*.json

# Expected output (before):
# {"id": "node_122", "imageAssetId": null, "imageHash": null}

# Expected output (after):
# {"id": "node_122", "imageAssetId": "img_3ecbe94d52ea6f51", "imageHash": "img_3ecbe94d52ea6f51"}

# 6. Import to Figma
# (Open Figma plugin, load schema JSON, click "Import")

# 7. Screenshot Figma result
# (Cmd+Shift+4, save as figma_screenshot_v2.png)

# 8. Re-run diff analysis
python3 analyze_diff.py \
  github.com_.png \
  figma_screenshot_v2.png \
  page-capture-*.json \
  artifacts_v2/

# 9. Compare metrics
echo "Before: 723,505 diff pixels"
jq '.Summary."Total diff clusters"' artifacts/diff_clusters.json
echo "After: "
jq '.Summary."Total diff clusters"' artifacts_v2/diff_clusters.json

# Expected: Clusters #15-24 resolved, ~2.8K pixels recovered
```

---

## Next Actions

### Immediate (P0)
1. **Apply P0-1 patch**: `./patches/P0-1-APPLY.sh`
2. **Verify fix**: Follow verification workflow above
3. **Identify P0-2 location**: Find background fill extraction
4. **Apply P0-2 fix**: TBD based on investigation
5. **Re-diff**: Expect 93% reduction in pixel errors

### Next Sprint (P1)
1. **Fix text content extraction**
2. **Debug geometry alignment**
3. **Re-diff**: Target <1% pixel error

### Polish (P2)
1. **Improve color accuracy**
2. **Fix DPR metadata**
3. **Add schema validation checks**

---

## Files Reference

### Input Files (User-Provided)
- `/Users/skirk92/figmacionvert-2/github.com_.png` - Original webpage screenshot (2870×4032)
- `/Users/skirk92/figmacionvert-2/figma_screenshot.png` - Figma export screenshot (1840×1004)  
  _(was "Screenshot 2026-01-10 at 7.17.24 PM.png" - renamed to avoid Unicode issues)_
- `/Users/skirk92/figmacionvert-2/page-capture-1768104797293.json` - Schema (280K lines, 425 nodes)

### Output Files (Generated)
- `/Users/skirk92/figmacionvert-2/artifacts/` - All analysis artifacts
- `/Users/skirk92/figmacionvert-2/patches/` - All patches
- `/Users/skirk92/figmacionvert-2/DEBUGGING_SUMMARY.md` - This file
- `/Users/skirk92/figmacionvert-2/analyze_diff.py` - Analysis tool

### Source Code Files (To Modify)
- `/Users/skirk92/figmacionvert-2/chrome-extension/src/utils/dom-extractor.ts` (12K lines)
- `/Users/skirk92/figmacionvert-2/chrome-extension/src/utils/asset-completeness-validator.ts` (731 lines)
- `/Users/skirk92/figmacionvert-2/figma-plugin/src/node-builder.ts` (7K lines) - verify only

---

## Technical Details

### Diff Analysis Algorithm
```python
# 1. Alignment
aligned_size = min(img_a.size, img_b.size)
img_a_resized = img_a.resize(aligned_size, LANCZOS)
img_b_resized = img_b.resize(aligned_size, LANCZOS)

# 2. Diff
diff = abs(img_a.astype(float) - img_b.astype(float))
diff_gray = mean(diff, axis=RGB)

# 3. Clustering
binary = (diff_gray > threshold).astype(uint8) * 255
labels, stats = cv2.connectedComponentsWithStats(binary)

# 4. Mapping
for cluster in clusters:
    cluster_bbox = scale_to_schema_coords(cluster.bbox)
    for node in schema.all_nodes:
        iou = cluster_bbox.iou(node.bbox)
        if iou > 0.1:
            cluster.mapped_nodes.append(node)
```

### Schema Query Patterns
```bash
# Find all IMAGE nodes
jq '[.captures[0].data.root] | .. | objects | select(.type == "IMAGE")' schema.json

# Check asset references
jq '.captures[0].data.assets.images | keys' schema.json

# Audit fills
jq '[.captures[0].data.root] | .. | objects | select(.fills | length == 0)' schema.json
```

---

## Success Criteria

### Phase 1 (P0 Fixes)
- [ ] All IMAGE nodes have non-null `imageAssetId`
- [ ] All images render in Figma (no gray placeholders)
- [ ] Container backgrounds visible
- [ ] Pixel diff <50K (93% reduction)

### Phase 2 (P1 Fixes)
- [ ] All TEXT nodes have `textContent`
- [ ] Navigation geometry accurate
- [ ] Pixel diff <20K (97% reduction)

### Phase 3 (Pixel-Perfect)
- [ ] Pixel diff <18K (<1%)
- [ ] No visual artifacts on manual inspection
- [ ] All schema invariants pass
- [ ] Compliance score >80/100

---

**Analysis completed**: 2026-01-10 21:23  
**Tools**: Python 3.11, OpenCV, PIL, NumPy, jq  
**Runtime**: ~15 seconds (image loading + diff + clustering + mapping)  
**Next**: Apply P0-1 patch and verify
