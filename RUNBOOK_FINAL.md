# Web2Figma Pixel-Perfect Fidelity - Patch Application Runbook

**Date:** 2026-01-11
**Status:** Ready for Implementation

## Quick Summary

**ROOT CAUSES IDENTIFIED:**
1. CAPTURE_SCHEMA_BUG: Fills skipped for inherited backgrounds (71.5% of nodes affected)
2. IMPORT_MAPPING_BUG: Plugin skips inherited fills, no synthesis fallback

**PATCHES READY:**
- P0_dom_extractor_fill_inheritance.patch
- P0_dom_extractor_svg_rasterization.patch
- P1_node_builder_fill_synthesis.patch

**EXPECTED IMPROVEMENT:**
- SSIM: 0.5141 → 0.95+ (+85%)
- Nodes with fills: 121 (28.5%) → 400+ (94%+)
- P0 clusters: 37 → 0

## Step 1: Apply Patches

```bash
cd /Users/skirk92/figmacionvert-2

# Verify patches exist
ls -la patches/*.patch

# Apply all patches
git apply patches/P0_dom_extractor_fill_inheritance.patch
git apply patches/P0_dom_extractor_svg_rasterization.patch
git apply patches/P1_node_builder_fill_synthesis.patch

# Verify application
git status
git diff --name-only
```

## Step 2: Rebuild Extension

```bash
cd chrome-extension
npm install
npm run build

# Verify build
ls -la dist/background.js dist/content-script.js

# Expected output:
# dist/background.js (should exist)
# dist/content-script.js (should exist)
```

## Step 3: Rebuild Plugin

```bash
cd ../figma-plugin
npm install
npm run build

# Verify build
ls -la dist/code.js

# Expected output:
# dist/code.js (should exist)
```

## Step 4: Re-Capture Page

**Manual Steps:**

1. Open Chrome
2. Navigate to chrome://extensions
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select: /Users/skirk92/figmacionvert-2/chrome-extension/dist
6. Navigate to https://github.com
7. Click extension icon
8. Click "Capture Page" button
9. Wait for capture to complete (console should show fill creation logs)
10. Download JSON file as page-capture-AFTER.json

**Expected Console Logs:**
```
🎨 [FILL] Creating fill for DIV (inherited: true)
🎨 [FILL] Creating fill for SECTION (inherited: false)
🖼️ [SVG] Marked for rasterization: octicon-mark-github
```

## Step 5: Re-Import to Figma

**Manual Steps:**

1. Open Figma desktop app
2. Open any file or create new file
3. Menu → Plugins → Development → Web2Figma (or your plugin name)
4. Click "Import" tab
5. Click "Choose File"
6. Select page-capture-AFTER.json
7. Click "Import"
8. Wait for import (watch Plugins → Development → Open Console)
9. Verify synthesis logs appear

**Expected Console Logs:**
```
✓ [SYNTHESIS] Created fill from computedStyle for DIV: {r: 0.086, g: 0.106, b: 0.133}
🎨 [FILL DEBUG] Processing 1 fills for DIV (inherited: true)
```

## Step 6: Export New Screenshot

**Manual Steps:**

1. In Figma, select entire imported frame
2. Right-click → Export → PNG
3. Set scale to 1x
4. Click "Export"
5. Save as figma_screenshot_after.png in /Users/skirk92/figmacionvert-2/

## Step 7: Run Verification

```bash
cd /Users/skirk92/figmacionvert-2

# Check schema fills count
echo "Nodes with fills:"
jq '.captures[0].data.nodes | map(select(.fills | length > 0)) | length' page-capture-AFTER.json

# Expected: >400 (was 121)

# Visual comparison (manual)
open github.com_.png
open figma_screenshot_after.png

# Should look nearly identical
```

## Step 8: Validate Metrics

### Check Schema

```bash
cd /Users/skirk92/figmacionvert-2

# Total nodes
echo "Total nodes:"
jq '.captures[0].data.nodes | length' page-capture-AFTER.json

# Nodes with fills
echo "Nodes with fills:"
jq '.captures[0].data.nodes | map(select(.fills | length > 0)) | length' page-capture-AFTER.json

# SVGs with rasterization
echo "SVGs marked for rasterization:"
jq '.captures[0].data.nodes | map(select(.htmlTag == "svg" and ._requiresRasterization == true)) | length' page-capture-AFTER.json

# Expected:
# Total nodes: 425
# Nodes with fills: 400+ (was 121)
# SVGs rasterized: 36 (was 0)
```

### Success Criteria

| Metric | Before | Target | Pass? |
|--------|--------|--------|-------|
| Nodes with fills | 121 (28.5%) | >400 (>94%) | ✓ if >360 |
| SVGs rasterized | 0 | 36 | ✓ if 36 |
| Visual fidelity | 50% | 95%+ | ✓ if looks identical |

## Rollback (If Needed)

```bash
cd /Users/skirk92/figmacionvert-2

# Rollback patches
git apply -R patches/P0_dom_extractor_fill_inheritance.patch
git apply -R patches/P0_dom_extractor_svg_rasterization.patch
git apply -R patches/P1_node_builder_fill_synthesis.patch

# Rebuild
cd chrome-extension && npm run build
cd ../figma-plugin && npm run build
```

## Troubleshooting

### Issue: Fills still empty after patch

**Check:**
```bash
cd chrome-extension
grep -n "PIXEL-PERFECT FIX" src/utils/dom-extractor.ts
# Should show line ~5633
```

**Fix:** Verify patch applied correctly, rebuild

### Issue: SVGs still not visible

**Check:**
```bash
jq '.captures[0].data.nodes | map(select(.htmlTag == "svg")) | .[0]._requiresRasterization' page-capture-AFTER.json
# Should return: true
```

**Fix:** Check patch #2 applied, rebuild extension

### Issue: Plugin not synthesizing fills

**Check Figma console:**
- Look for "🔧 [SYNTHESIS]" logs
- If missing, patch #3 not applied or plugin not rebuilt

**Fix:** Verify patch applied, rebuild plugin, restart Figma

## Next Steps After Success

1. Commit patches to git
2. Update CHANGELOG.md
3. Run full test suite on other websites
4. Consider automated regression tests

---

**END OF RUNBOOK**
