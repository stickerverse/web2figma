# P0 PATCH 1: Fix Fill Extraction for Inherited Backgrounds

## Severity
**P0 (Critical/Blocker)** - Blocks pixel-perfect fidelity

## Impact
71.5% of nodes (304/425) have no fills in schema because inherited backgrounds are skipped.

## Root Cause
File: `chrome-extension/src/utils/dom-extractor.ts`  
Lines: 5635-5668 in `extractStylesSafe()`

The code explicitly skips creating fills for elements with inherited backgrounds:

```typescript
const elementActuallyPaintsBackground = !isBackgroundInherited && ...;

if (!elementActuallyPaintsBackground) {
  // do NOT add fills - this prevents wrapper frames from becoming opaque rectangles
  console.log(`Skipping fill for ${element.tagName} - background is inherited`);
  return; // ✗ NO FILL CREATED
}
```

## Evidence
- diff_clusters.json: 37 clusters with MISSING elements
- schema_audit: 304 nodes with empty fills array
- cluster_analysis.json: All MISSING clusters have `missing_fields: ["fills_and_backgrounds"]`

## Resolution Plan

1. Locate the skip logic in extractStylesSafe (lines 5635-5668)
2. Replace with: always create fills for visible backgrounds
3. Add metadata `_inherited: true` for plugin to handle transparency
4. Add logging for verification
5. Re-run capture and verify fills count increases from 121 to ~400+

## Implementation

**File:** `chrome-extension/src/utils/dom-extractor.ts`

**Find (approx lines 5635-5668):**

```typescript
const isBackgroundInherited =
  node.inheritanceFlags?.backgroundColorInherited === true;
const elementActuallyPaintsBackground =
  !isBackgroundInherited &&
  (hasBgColor || hasBgImage || hasGradient);

if (!elementActuallyPaintsBackground) {
  // do NOT add fills - this prevents wrapper frames from becoming opaque rectangles
  console.log(
    `  ⚪ [FILL] Skipping fill for ${element.tagName} - background is ${isBackgroundInherited ? "inherited" : "not painted"}, hasBgColor=${hasBgColor}, hasBgImage=${hasBgImage}`
  );

  // CRITICAL: Store inheritance metadata for plugin processing (always, regardless of fill creation)
  if (!node.colorInheritance) node.colorInheritance = {};
  node.colorInheritance.backgroundColorSource = isBackgroundInherited
    ? "inherited"
    : "explicit";

  // CRITICAL: Even if we don't add fills, ensure computedStyle is set for plugin fallback
  if (hasBgColor || effectiveBgColor) {
    const bgColorToStore = effectiveBgColor || bgColor;
    if (!node.style) node.style = {};
    node.style.backgroundColor = bgColorToStore;
    node.backgroundColor = bgColorToStore;

    if (effectiveBgColor) {
      if (!node.style) node.style = {};
      node.style.backgroundColor = effectiveBgColor;
      node.backgroundColor = effectiveBgColor;

      / CRITICAL: Also store in computedStyle (where plugin looks first)
      if (!node.computedStyle) node.computedStyle = {};
      node.computedStyle.backgroundColor = effectiveBgColor;
    }
  }
} else {
  // Element actually paints background - create fills
  console.log(
    `  ✅ [FILL] Creating fill for ${element.tagName} - background is ${isBackgroundInherited ? "inherited" : "explicit"}, hasBgColor=${hasBgColor}, hasBgImage=${hasBgImage}`
  );
  
  // ... existing fill creation code ...
}
```

**Replace with:**

```typescript
const isBackgroundInherited =
  node.inheritanceFlags?.backgroundColorInherited === true;
const hasVisibleBackground = hasBgColor || hasBgImage || hasGradient;

// CRITICAL FIX: Store inheritance metadata BEFORE processing fills
if (!node.colorInheritance) node.colorInheritance = {};
node.colorInheritance.backgroundColorSource = isBackgroundInherited
  ? "inherited"
  : "explicit";

// CRITICAL FIX: Always create fills for visible backgrounds (even if inherited)
// The plugin will handle transparency/opacity based on _inherited metadata
if (hasVisibleBackground) {
  console.log(
    `  ✅ [FILL] Creating fill for ${element.tagName} - background is ${isBackgroundInherited ? "inherited" : "explicit"}, hasBgColor=${hasBgColor}, hasBgImage=${hasBgImage}`
  );
  
  // Process background color
  if (hasBgColor || effectiveBgColor) {
    const bgColorToStore = effectiveBgColor || bgColor;
    
    // Store in style/backgroundColor for reference
    if (!node.style) node.style = {};
    node.style.backgroundColor = bgColorToStore;
    node.backgroundColor = bgColorToStore;
    
    // Store in computedStyle (where plugin looks first)
    if (!node.computedStyle) node.computedStyle = {};
    node.computedStyle.backgroundColor = bgColorToStore;
    
    // CRITICAL: Create fill (even if inherited)
    const parsedColor = this.parseColorSafe(bgColorToStore);
    if (parsedColor && parsedColor.a > 0.001) {
      const fill = {
        type: "SOLID" as const,
        color: {
          r: parsedColor.r,
          g: parsedColor.g,
          b: parsedColor.b,
        },
        opacity: parsedColor.a,
        visible: true,
        _inherited: isBackgroundInherited, // Metadata for plugin
      };
      
      node.fills.push(fill);
      
      console.log(
        `    ✓ Created SOLID fill: rgba(${Math.round(parsedColor.r*255)}, ${Math.round(parsedColor.g*255)}, ${Math.round(parsedColor.b*255)}, ${parsedColor.a.toFixed(2)}) [inherited: ${isBackgroundInherited}]`
      );
    } else {
      console.log(
        `    ⚠️ Parsed color is transparent or invalid: ${bgColorToStore}`
      );
    }
  }
  
  // Process background images/gradients (existing code)
  if (hasBgImage || hasGradient) {
    // ... existing background image/gradient processing code ...
    // (keep this section as-is)
  }
} else {
  // No visible background
  console.log(
    `  ⚪ [FILL] No visible background for ${element.tagName} - hasBgColor=${hasBgColor}, hasBgImage=${hasBgImage}`
  );
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
with_fills = sum(1 for n in nodes if n.get('fills'))
print(f"Nodes with fills: {with_fills}/{len(nodes)}")
CHECK
```
Expected output: `Nodes with fills: 121/425`

### Post-patch verification:
```bash
# 1. Rebuild extension
cd /Users/skirk92/figmacionvert-2/chrome-extension
npm run build

# 2. Re-capture github.com page
# (use extension to capture - manual step)

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
with_fills = sum(1 for n in nodes if n.get('fills'))
print(f"Nodes with fills: {with_fills}/{len(nodes)}")
# Also check for _inherited metadata
inherited = sum(1 for n in nodes if any(f.get('_inherited') for f in n.get('fills', [])))
print(f"Nodes with inherited fills: {inherited}")
CHECK
```
Expected output: `Nodes with fills: 400+/425` (90%+ coverage)

### Success criteria:
- Fills count increases from 121 to 400+
- P0 clusters in diff analysis decrease from 37 to <10
- SSIM score improves from 0.5141 to >0.75

## Rollback
If patch causes issues:

```bash
git diff chrome-extension/src/utils/dom-extractor.ts > rollback.patch
git checkout chrome-extension/src/utils/dom-extractor.ts
npm run build
```

## Related Patches
- P0 PATCH 2: SVG Rasterization (also needed for full fix)
- P1 PATCH 1: Plugin fill synthesis (complementary fix)
