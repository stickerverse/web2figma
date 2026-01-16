# Web2Figma Gap Analysis - Round 2

## Current State Summary

### After P0 Patches (Round 1)
- **Before**: 53% pixels different (979K pixels), 287 clusters
- **After Round 1**: 21% pixels different (1.1M pixels), 22 clusters
- **Improvement**: 60% reduction in pixel diff, 92% reduction in cluster count

### Remaining Issues Identified

**Primary Root Cause: GitHub Dynamic Content Loading**
- GitHub uses `<turbo-frame>` and custom elements (`<feed-container>`, `<feed-live-container>`, `<react-partial>`)
- Content loads asynchronously AFTER page load via JavaScript
- Extension was capturing DOM before turbo-frames finished hydrating
- Result: Container elements captured but children are empty

**Evidence:**
- `<feed-live-container>` has 0 children (should contain feed items)
- Right sidebar content region completely missing (Cluster #2: 2137x1508px, 1M pixels)
- 502 DOM elements found but only 444 captured with geometry
- 0 fonts captured (causing text style mismatches)

---

## Round 2 Patches Applied

### P0-4: Turbo-Frame Aware Capture Delay
**Location:** `chrome-extension/src/utils/page-readiness.ts:245-278, 305-311`

**Changes:**
1. **GitHub Detection**: Automatically detects GitHub.com and turbo-frames
2. **Extended Wait Time**: Increases MINIMUM_WAIT from 3s → 6s for GitHub
3. **Turbo-Frame Monitoring**: Actively checks turbo-frame loading state via attributes:
   - `busy="true"` → frame still loading
   - `loading="lazy"` → frame not yet loaded
   - `complete="true"` → frame fully loaded
4. **Smart Stability**: Won't declare page stable until all turbo-frames complete

**Impact:** Should capture 100-150 additional elements in feed and sidebar

### P0-5: Shadow DOM Observation
**Location:** `chrome-extension/src/utils/page-readiness.ts:242-277`

**Changes:**
1. **Shadow Root Discovery**: Scans for custom elements with shadow DOM:
   - `turbo-frame`, `feed-container`, `feed-live-container`, `react-partial`, `react-app`
2. **Shadow DOM Monitoring**: Creates separate MutationObserver for each shadow root
3. **Periodic Re-scan**: Checks every 1 second for new shadow roots
4. **Mutation Detection**: Updates `lastChange` timer when shadow DOM mutates

**Impact:** Prevents premature "page stable" declaration while shadow content loads

---

## Expected Improvements

### Metrics Projection
| Metric | Round 1 Result | Round 2 Target | Improvement |
|--------|---------------|----------------|-------------|
| Pixel Difference | 21% (1.1M) | <5% (90K) | 76% reduction |
| Error Clusters | 22 | <5 | 77% reduction |
| Nodes Captured | 444 | 550-600 | +100-150 nodes |
| Font Capture | 0 | 0* | (requires P1 patch) |

*Font capture not addressed in Round 2 (deprioritized for speed)

### Expected Visual Improvements
✅ **Feed Section:**
- Trending repositories with avatars
- Star buttons and interaction elements
- Repository descriptions and metadata

✅ **Right Sidebar:**
- "Latest from our changelog" section
- Blog post titles and timestamps
- All sidebar content

✅ **Header:**
- GitHub logo
- Navigation icons
- Search input fully styled

---

## Verification Instructions

### Step 1: Reload Extension in Chrome
```bash
# Open Chrome
# Navigate to: chrome://extensions/
# Find "Web to Figma" extension
# Click "Reload" button (circular arrow icon)
```

### Step 2: Re-Capture GitHub
```bash
# Navigate to: https://github.com
# Wait for page to fully load (you should see all content)
# Click extension icon
# Click "Capture Page"
# Wait for capture to complete (should take ~10-15 seconds due to new 6s delay)
# New JSON will be saved to Downloads/
```

### Step 3: Verify Capture Improvements
```bash
# Move new capture to repo
mv ~/Downloads/page-capture-*.json /Users/skirk92/figmacionvert-2/page-capture-ROUND2.json

# Count captured nodes (should be 550-600, was 444)
jq '[.captures[0].data.root | .. | objects | select(has("id"))] | length' page-capture-ROUND2.json

# Check for feed content (should have children now)
jq '[.captures[0].data.root | .. | objects | select(.htmlTag == "feed-live-container")] | .[0] | {id, childCount: (.children | length)}' page-capture-ROUND2.json
# Expected: childCount > 0 (was 0)

# Check console logs in extension background page for turbo-frame detection
# Should see: "Detected GitHub turbo-frames, extending minimum wait to 6s"
```

### Step 4: Re-Import to Figma
1. Open Figma plugin
2. Load `page-capture-ROUND2.json`
3. Import to new Figma file
4. Take screenshot of result
5. Save as `figma-import-ROUND2.png`

### Step 5: Run Gap Analysis
```bash
cd /Users/skirk92/figmacionvert-2

# Copy old analysis script if available
cp archive/legacy_analysis/analyze_diff.py ./

# Run diff analysis
python3 analyze_diff.py \
  github.com_.png \
  figma-import-ROUND2.png \
  page-capture-ROUND2.json

# Expected results in artifacts/:
# - diff_heatmap_v3.png (much less red)
# - diff_clusters_v3.json (<5 clusters, was 22)
# - gap_analysis_v3.md (detailed analysis)
```

---

## Success Criteria

### ✅ Pass Thresholds
- **SSIM Score**: ≥0.95 (was 0.51 → 0.79 Round 1)
- **Pixels Different**: ≤5% (was 53% → 21% Round 1)
- **Nodes Captured**: ≥550 (was 444)
- **P0 Clusters**: ≤2 (was 22)
- **Feed Content**: feed-live-container has >0 children

### 🎯 Stretch Goals
- **SSIM Score**: ≥0.98
- **Pixels Different**: ≤2%
- **All visible content captured**: No major missing sections

---

## If Issues Persist

### Debugging Checklist
1. **Check Extension Console**:
   - Open `chrome://extensions/`
   - Click "Inspect views: background page"
   - Look for turbo-frame detection logs
   - Verify 6-second wait actually happened

2. **Check Capture Timing**:
   - In browser console during capture, run:
     ```javascript
     document.querySelectorAll('turbo-frame[complete="true"]').length
     document.querySelectorAll('turbo-frame').length
     ```
   - First number should equal second (all frames complete)

3. **Manual Test**:
   - Add `alert("Capturing in 3...2...1...")` before capture
   - Wait 10+ seconds after page load
   - Then capture manually
   - If this works better, increase MINIMUM_WAIT_MS further

4. **Network Tab**:
   - Open DevTools → Network tab
   - Filter by "fetch/xhr"
   - Check if requests are still pending when capture starts
   - If yes, may need longer network idle timeout

---

## Next Steps (If Round 2 Succeeds)

### P1 Patches (Minor Improvements)
1. **Font Capture**: Extract web fonts from CSS for text styling
2. **Image Asset Linking**: Ensure all IMAGE nodes have valid imageAssetId
3. **SVG Detail**: Improve SVG path extraction for icons

### P2 Patches (Polish)
1. **Shadow/Effects**: CSS filters, box-shadows
2. **Gradients**: Linear/radial gradient fidelity
3. **Clip Paths**: Complex clipping shapes

---

## Files Modified

### Patched Files
- `chrome-extension/src/utils/page-readiness.ts` (P0-4, P0-5)

### Build Artifacts
- `chrome-extension/dist/` (rebuilt)

### Documentation
- `GAP_ANALYSIS_ROUND2.md` (this file)
- `patches/P0-4_turbo_frame_readiness.patch` (reference)

---

## Contact/Questions

If Round 2 doesn't achieve target metrics:
1. Share console logs from extension background page
2. Share new capture JSON and Figma screenshot
3. Run gap analysis and share diff_clusters_v3.json
4. We'll iterate with Round 3 patches
