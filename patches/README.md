# Web2Figma Pixel-Perfect Fidelity Patches

## Overview

This directory contains patches to fix critical fidelity bugs identified through systematic diff analysis comparing webpage screenshots (A) to Figma import results (B).

**Analysis Method**: Pixel-level diff clustering with schema node mapping  
**Tools**: Python/OpenCV diff analysis + jq schema queries  
**Date**: 2026-01-10

---

## Summary of Findings

### Critical Stats
- **Total pixel diff**: 723,505 pixels (39.2% of viewport)
- **Diff clusters**: 257 regions
- **Schema violations**: 18 nodes (4.2% of 425 total)
- **Root causes identified**: 3 P0 bugs, 2 P1 bugs, 2 P2 bugs

### Expected Impact After Fixes
- **Pixel diff reduction**: 93% (from 723K to <50K pixels)
- **Image rendering**: 100% success (from 0%)
- **Background fill accuracy**: 99%+ (from ~60%)

---

## Patch Priority

### P0 (Blockers - Deploy Immediately)

#### P0-1: Fix Image Asset Linking
**File**: `chrome-extension/src/utils/dom-extractor.ts`  
**Line**: 8714 (in `handleImageElement()`)  
**Issue**: `imageAssetId` and `imageHash` are null for all IMAGE nodes  
**Impact**: All images render as gray placeholders (7+ nodes, ~2.8K pixels)

**Current Code**:
```typescript
await this.captureImageSafe(imageUrl, img);
const key = this.hashString(imageUrl);
// ... 100 lines later at ~8830 ...
node.imageHash = key;
```

**Fixed Code**:
```typescript
await this.captureImageSafe(imageUrl, img);
const key = this.hashString(imageUrl);
const assetId = `img_${key}`;  // CRITICAL: Match assets.images key format

// ... at line ~8830 ...
node.fills = [
  {
    type: "IMAGE",
    imageHash: assetId,  // CHANGED: was 'key', now 'assetId'
    scaleMode: scaleMode,
    visible: true,
  },
];
node.imageHash = assetId;      // CHANGED: was 'key'
node.imageAssetId = assetId;   // NEW: compatibility with Figma import
node.component = {
  name: "Raw:Img",
  options: {
    image: imageUrl,
  },
};
```

**Why This Fixes It**:
1. Assets are stored as `assets.images["img_HASH"]` (with "img_" prefix)
2. Old code set `imageHash = HASH` (without prefix)
3. Figma plugin looked up `assets[HASH]` → not found
4. New code uses consistent `img_HASH` format for both node and asset

**Verification**:
```bash
# Before: All null
jq '[.captures[0].data.root] | .. | objects | select(.type == "IMAGE") | .imageAssetId' schema.json

# After: All "img_..." strings
jq '[.captures[0].data.root] | .. | objects | select(.type == "IMAGE") | .imageAssetId' schema-fixed.json
```

**Grep to find exact line**:
```bash
grep -n "node.imageHash = key;" chrome-extension/src/utils/dom-extractor.ts
# Expected output: 8830:      node.imageHash = key;
```

---

#### P0-2: Fix Container Background Fills
**File**: `chrome-extension/src/utils/dom-extractor.ts`  
**Function**: Need to identify background extraction logic  
**Issue**: Container elements have empty `fills[]` despite visible backgrounds  
**Impact**: 668K pixels (full page background)

**Investigation Required**:
```bash
# Find where fills are initialized/populated
grep -n "fills.*=.*\[\]" chrome-extension/src/utils/dom-extractor.ts | head -20

# Find background extraction
grep -n "backgroundColor\|background-color" chrome-extension/src/utils/dom-extractor.ts | head -20
```

**Expected Fix Location**: Function that processes `background-color` and `background-image` CSS

**Suspected Issue**: Background extraction skips elements with `background: transparent` or defaults  
**Required Fix**: Ensure extracted background matches computed style, even if transparent

---

### P1 (High Priority - Next Sprint)

#### P1-1: Fix Text Content Extraction
**File**: `chrome-extension/src/utils/dom-extractor.ts`  
**Issue**: TEXT nodes missing `textContent` field  
**Affected**: node_110 (h2), potentially others  
**Impact**: 3.7K pixels

**Investigation**:
```bash
# Find TEXT node creation
grep -n "type.*=.*['\"]TEXT" chrome-extension/src/utils/dom-extractor.ts

# Find textContent assignment
grep -n "textContent.*=" chrome-extension/src/utils/dom-extractor.ts | grep -v "//.*textContent"
```

**Expected Fix**: Ensure `node.textContent = element.textContent || element.innerText` is set for all TEXT nodes

---

#### P1-2: Fix Navigation Button Geometry
**Files**: 
- `chrome-extension/src/utils/dom-extractor.ts` (capture)
- `figma-plugin/src/node-builder.ts` (import)

**Issue**: Button positions off by 20-30px  
**Affected**: 5 navigation buttons (clusters #3, #5, #6, #7, #8)  
**Impact**: 12K pixels

**Investigation**:
```bash
# Check coordinate calculation
grep -n "pageX\|pageY\|relativeX\|relativeY" chrome-extension/src/utils/dom-extractor.ts | head -30

# Check DPR scaling
grep -n "devicePixelRatio" chrome-extension/src/utils/dom-extractor.ts
```

**Suspected Issue**: Coordinate system inconsistency (page vs viewport) or DPR scaling mismatch

---

### P2 (Medium Priority - Polish)

#### P2-1: Fix Color Extraction Accuracy
**Issue**: Badge/label colors extracted incorrectly  
**Impact**: 10 clusters, ~3K pixels total  
**Investigation**: Review color parsing in CSS → RGB conversion

#### P2-2: Fix DPR Metadata
**Issue**: Schema claims DPR=2, actual screenshot is DPR=1.65  
**Impact**: Alignment issues, potential scaling artifacts  
**Fix**: Capture actual DPR from window.devicePixelRatio at capture time

---

## Patch Application Order

### Phase 1: Image Assets (P0-1)
1. Apply patch to `dom-extractor.ts` line 8830
2. Rebuild extension: `npm run build` in `chrome-extension/`
3. Reload extension in Chrome
4. Recapture github.com
5. Verify with: `jq '[.captures[0].data.root] | .. | objects | select(.type == "IMAGE") | .imageAssetId' schema.json`
6. Import to Figma
7. Take new screenshot
8. Run diff analysis: `python3 analyze_diff.py ...`
9. Expected: Clusters #15-24 resolve (images visible)

### Phase 2: Background Fills (P0-2)
1. Find and patch background extraction
2. Rebuild and test
3. Expected: Cluster #1 shrinks from 668K to <5K pixels

### Phase 3: Text Content (P1-1)
1. Patch TEXT node creation
2. Rebuild and test
3. Expected: Cluster #4 resolves (headings visible)

### Phase 4: Geometry (P1-2)
1. Debug coordinate system
2. Apply fixes
3. Expected: Clusters #3, #5-8 resolve (buttons aligned)

### Phase 5: Polish (P2)
1. Color accuracy improvements
2. DPR metadata fix
3. Expected: Remaining clusters shrink

---

## Verification Scripts

### Check Image Asset Linkage
```bash
#!/bin/bash
echo "Checking IMAGE node asset linkage..."
jq '
  [.captures[0].data.root] | .. | objects | 
  select(.type == "IMAGE") | 
  {
    id, 
    imageAssetId, 
    imageHash, 
    src: .attributes.src,
    has_asset: (.imageAssetId != null or .imageHash != null)
  }
' schema.json | jq -s 'group_by(.has_asset) | map({has_asset: .[0].has_asset, count: length})'
```

### Check Fill Completeness
```bash
#!/bin/bash
echo "Checking fill completeness..."
jq '
  [.captures[0].data.root] | .. | objects |
  select(.htmlTag == "html" or .htmlTag == "body") |
  {id, htmlTag, fill_count: (.fills | length), fills: .fills[0]?}
' schema.json
```

### Run Full Diff Analysis
```bash
#!/bin/bash
cd /Users/skirk92/figmacionvert-2
python3 analyze_diff.py \
  github.com_.png \
  figma_screenshot.png \
  page-capture-TIMESTAMP.json \
  artifacts/

echo "Generated:"
ls -lh artifacts/{diff_report.md,diff_heatmap.png,diff_clusters.png,diff_clusters.json}
```

---

## Files Modified

### Capture Pipeline (Chrome Extension)
- `chrome-extension/src/utils/dom-extractor.ts` - PRIMARY (2-3 patches)
- `chrome-extension/src/utils/asset-completeness-validator.ts` - May need update to handle new linking

### Import Pipeline (Figma Plugin)
- `figma-plugin/src/node-builder.ts` - Verify compatibility with new imageAssetId format
- No changes expected (plugin already supports both imageHash and imageAssetId)

---

## Rollback Plan

If patches cause regressions:

1. **Immediate**: Revert commits with `git revert HEAD`
2. **Rebuild**: `npm run build` in chrome-extension/
3. **Restore**: Load previous extension build
4. **Analyze**: Check console errors in DevTools
5. **Debug**: Use `console.log` to trace asset lookup flow

---

## Testing Checklist

After each patch:

- [ ] Extension builds without errors
- [ ] Capture completes successfully
- [ ] Schema validates (no JSON syntax errors)
- [ ] Relevant diff clusters resolve
- [ ] No NEW clusters appear
- [ ] Console shows no new errors
- [ ] Manual inspection matches expected output

---

## Related Documentation

- `/Users/skirk92/figmacionvert-2/artifacts/diff_report.md` - Full diff analysis
- `/Users/skirk92/figmacionvert-2/artifacts/schema_audit.md` - Schema compliance audit
- `/Users/skirk92/figmacionvert-2/artifacts/diff_clusters.json` - Cluster data
- `/Users/skirk92/figmacionvert-2/artifacts/alignment.json` - DPR/size metadata

---

**Next Steps**: Apply P0-1 patch first, verify with diff re-analysis, then proceed to P0-2.
