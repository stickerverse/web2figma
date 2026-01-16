# P0 PATCH 2: Fix SVG Element Rasterization

## Severity
**P0 (Critical/Blocker)** - SVG icons completely missing from Figma output

## Impact
36 SVG nodes in schema have:
- No fills (fills=0)
- No backgrounds (backgrounds=0)  
- No rasterization flag (_requiresRasterization=false)
- Result: SVG icons render as empty rectangles in Figma

## Root Cause
File: `chrome-extension/src/utils/dom-extractor.ts`

SVG elements are captured as regular DOM nodes, but:
1. Inner SVG content (`<path>`, `<circle>`, etc.) is NOT extracted
2. `_requiresRasterization` flag is NOT set
3. No fallback mechanism for complex SVG rendering

## Evidence
From schema audit:
```
SVG Nodes: 36
  node_16: fills=0, backgrounds=0, raster=False
  node_21: fills=0, backgrounds=0, raster=False
  node_40: fills=0, backgrounds=0, raster=False
```

From diff analysis:
```
Cluster #0: node_355 (svg) - MISSING - Impact: 33,702,384
```

## Resolution Plan

1. Find SVG element processing in extractNode()
2. Add check: if element.tagName === 'svg'
3. Set _requiresRasterization = true
4. Optionally: extract svgContent for vector rendering (future enhancement)
5. Add logging for verification

## Implementation

**File:** `chrome-extension/src/utils/dom-extractor.ts`

**Find the section where node metadata is set (after line 2900, before extractStylesSafe):**

```typescript
// Around line 2900-3000 in extractNode method
const node: any = {
  id: nodeId,
  parentId: parentId || null,
  type: this.inferNodeType(element, computed),
  name: this.getElementName(element, computed, nodeId),
  htmlTag: element.tagName?.toLowerCase(),
  cssClasses: Array.from(element.classList || []),
  // ... other properties ...
```

**Add immediately after type/name/htmlTag assignment:**

```typescript
// CRITICAL FIX: SVG elements must be rasterized for pixel-perfect fidelity
// SVG rendering in Figma requires either:
// 1. Full vector path extraction (complex, future enhancement)
// 2. Rasterization to bitmap (simple, pixel-perfect)
// For now, always rasterize SVG elements to ensure visibility
if (element.tagName?.toLowerCase() === 'svg') {
  node._requiresRasterization = true;
  
  // Optional: Extract SVG markup for future vector rendering
  try {
    const svgMarkup = element.outerHTML;
    if (svgMarkup && svgMarkup.length < 100000) { // Limit to 100KB
      node.svgContent = svgMarkup;
      console.log(`  🎨 [SVG] Captured SVG content for ${nodeId} (${svgMarkup.length} bytes)`);
    }
  } catch (err) {
    console.warn(`  ⚠️ [SVG] Failed to extract SVG markup for ${nodeId}:`, err);
  }
  
  console.log(`  ✓ [SVG] Marked ${nodeId} for rasterization`);
}

// Also check for nested SVG elements (svg within div, etc.)
if (element.querySelector('svg')) {
  const hasSvgChild = true;
  node._containsSvg = true;
  console.log(`  ℹ️ [SVG] ${nodeId} contains nested SVG elements`);
}
```

**Alternative location (if above doesn't work):**

Find the `_requiresRasterization` initialization (around line 2927):

```typescript
_requiresRasterization: false,
```

**Replace with:**

```typescript
_requiresRasterization: element.tagName?.toLowerCase() === 'svg', // Auto-rasterize SVG elements
```

**AND add detailed logging in extractStylesSafe or after it:**

```typescript
// After extractStylesSafe call (around line 3100)
if (element.tagName?.toLowerCase() === 'svg') {
  if (!node._requiresRasterization) {
    node._requiresRasterization = true;
    console.log(`  ✓ [SVG FALLBACK] Force-enabled rasterization for ${nodeId}`);
  }
  
  // Extract SVG content
  try {
    const svgMarkup = element.outerHTML;
    if (svgMarkup && svgMarkup.length < 100000) {
      node.svgContent = svgMarkup;
    }
  } catch (err) {
    // Silent fail - rasterization will still work
  }
}
```

## Verification

### Pre-patch check:
```bash
python3 << 'CHECK'
import json
schema = json.load(open('/Users/skirk92/figmacionvert-2/page-capture-1768104797293.json'))
nodes = []
def collect(n):
    nodes.append(n)
    for c in n.get('children', []): collect(c)
collect(schema['captures'][0]['data']['root'])
svg_nodes = [n for n in nodes if n.get('htmlTag') == 'svg']
rasterized = sum(1 for n in svg_nodes if n.get('_requiresRasterization'))
print(f"SVG nodes: {len(svg_nodes)}")
print(f"SVG nodes marked for rasterization: {rasterized}")
print(f"SVG nodes with svgContent: {sum(1 for n in svg_nodes if n.get('svgContent'))}")
CHECK
```
Expected output: 
```
SVG nodes: 36
SVG nodes marked for rasterization: 0
SVG nodes with svgContent: 0
```

### Post-patch verification:
```bash
# 1. Rebuild extension
cd /Users/skirk92/figmacionvert-2/chrome-extension
npm run build

# 2. Re-capture github.com page
# (use extension - manual step)

# 3. Check new schema
python3 << 'CHECK'
import json
import glob
latest = max(glob.glob('/Users/skirk92/figmacionvert-2/page-capture-*.json'))
schema = json.load(open(latest))
nodes = []
def collect(n):
    nodes.append(n)
    for c in n.get('children', []): collect(c)
collect(schema['captures'][0]['data']['root'])
svg_nodes = [n for n in nodes if n.get('htmlTag') == 'svg']
rasterized = sum(1 for n in svg_nodes if n.get('_requiresRasterization'))
print(f"SVG nodes: {len(svg_nodes)}")
print(f"SVG nodes marked for rasterization: {rasterized}")
print(f"SVG nodes with svgContent: {sum(1 for n in svg_nodes if n.get('svgContent'))}")
CHECK
```
Expected output:
```
SVG nodes: 36
SVG nodes marked for rasterization: 36
SVG nodes with svgContent: 36 (optional)
```

### Visual verification:
```bash
# Re-import in Figma plugin and check for SVG icons
# Before patch: SVG icons missing (empty rectangles)
# After patch: SVG icons visible (rasterized images)
```

### Success criteria:
- All 36 SVG nodes have `_requiresRasterization: true`
- SVG-related diff clusters decrease significantly
- Visual inspection shows SVG icons in Figma

## Rollback
```bash
git diff chrome-extension/src/utils/dom-extractor.ts > svg_rollback.patch
git checkout chrome-extension/src/utils/dom-extractor.ts
npm run build
```

## Notes

**Why rasterization instead of vector conversion?**
1. SVG → Figma vector conversion is complex (path parsing, transforms, gradients)
2. Rasterization is pixel-perfect by definition
3. Most SVG icons are small (<100x100px), so raster quality is acceptable
4. Future enhancement: Parse simple SVG paths to Figma vectors

**Performance impact:**
- Minimal - only 36 SVG elements
- Each rasterization adds ~5-20KB to schema
- Total overhead: ~200KB-700KB (acceptable)

## Related Patches
- P0 PATCH 1: Fill extraction (must be applied first)
- P0 PATCH 3: Asset pipeline (for background-image SVGs)
