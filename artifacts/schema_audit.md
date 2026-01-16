# Schema Audit Report

## Critical Findings

### 1. Missing Fills/Backgrounds Coverage

**OBSERVATION:**
- Total nodes: 425
- Nodes with fills: 121 (28.5%)
- Nodes with backgrounds: 41 (9.6%)
- **Nodes with NEITHER: 304 (71.5%)**
- Nodes requiring rasterization: 0

**ROOT CAUSE:**
71.5% of nodes have NO fills or backgrounds in the schema. This is a **CAPTURE_SCHEMA_BUG** in `chrome-extension/src/utils/dom-extractor.ts`.

### 2. Schema Invariants

#### Invariant 1: All Visible Elements Must Have Fill Data
**STATUS:** VIOLATED

**Evidence:**
```
- node_355 (svg): fills=0, backgrounds=0, strokes=0
- node_201 (div): fills=0, backgrounds=0, strokes=0
- node_228 (div): fills=0, backgrounds=0, strokes=0
```

These nodes appear in the diff clusters as MISSING elements, confirming they render visibly in browser but have no fill data in schema.

#### Invariant 2: SVG Elements Must Be Rasterized or Have Vector Data
**STATUS:** VIOLATED

**Evidence:**
36 SVG nodes in schema, ALL have:
- fills=0
- backgrounds=0
- _requiresRasterization=False

SVGs require either:
1. Embedded SVG content (for vector rendering)
2. Rasterized image (for complex SVGs)
3. Fill data from computed styles

None of these are present.

#### Invariant 3: Background Colors Must Be Captured
**STATUS:** PARTIALLY VIOLATED

**Evidence:**
The dom-extractor.ts code shows extensive backgroundColor extraction logic (lines 4161-4705), BUT the actual fills array is initialized empty (line 2930) and only populated by `extractStylesSafe`.

**Critical Code Path:**
```typescript
// Line 2928-2930 in dom-extractor.ts
// CRITICAL FIX: Initialize fills as empty - extractStylesSafe will populate
// fills properly with inheritance check.
fills: [],
```

The comment suggests `extractStylesSafe` should populate fills, but the audit shows 71.5% of nodes have empty fills.

#### Invariant 4: Images Must Have Asset References
**STATUS:** VIOLATED

**Evidence:**
```
Assets in schema: 3
  images: type=None, size=0 bytes
  svgs: type=None, size=0 bytes
  fonts: type=None, size=0 bytes
```

Asset arrays exist but contain NO actual data. The 9 IMG nodes in schema have fills/backgrounds, but external SVG/background-image assets are missing.

### 3. Critical Schema Gaps

#### Gap 1: extractStylesSafe Not Populating Fills
**Location:** `chrome-extension/src/utils/dom-extractor.ts:5604-5705`

**Analysis:**
The code has extensive logic to:
1. Detect backgroundColor (lines 5605-5607)
2. Check inheritance (lines 5625-5638)
3. Store in computedStyle (lines 5698-5705)

BUT it explicitly does NOT create fills for inherited backgrounds:
```typescript
// Lines 5635-5668
const isBackgroundInherited = node.inheritanceFlags?.backgroundColorInherited === true;
const elementActuallyPaintsBackground = !isBackgroundInherited && ...;

if (!elementActuallyPaintsBackground) {
  // do NOT add fills - this prevents wrapper frames from becoming opaque rectangles
  ...
}
```

**Impact:** Nodes with inherited backgrounds (containers, divs, sections) get NO fills, appearing as missing in Figma.

#### Gap 2: SVG Content Not Captured
**Location:** `chrome-extension/src/utils/dom-extractor.ts`

**Evidence:** 36 SVG nodes, none have:
- `svgContent` field
- Vector path data
- Rasterization flag set

**Impact:** All SVGs render as missing elements in Figma.

#### Gap 3: Background Images Not in Assets
**Location:** `chrome-extension/src/utils/dom-extractor.ts`

**Evidence:**
```javascript
// Background image detection exists (lines 4213-4214)
const hasBgImage = computed.backgroundImage && computed.backgroundImage !== "none";
```

But assets array contains 0 bytes of data.

**Impact:** Background images missing from Figma output.

### 4. Plugin Processing Gaps

**Location:** `figma-plugin/src/node-builder.ts:4044-4250`

**Analysis:**
The plugin's `applyCommonStyles` method has extensive fallback logic for missing fills:
```typescript
// Lines 4119-4138
if (!fillsAreInherited) {
  const fillPaints = await this.convertFillsAsync(data.fills);
  paints.push(...filteredFills);
}
```

BUT if `data.fills` is empty array, `convertFillsAsync([])` returns empty array, and NO fills are applied.

**Fallback exists** (lines 4240-4250) but only activates if early fallback color was found. For nodes with no computedStyle.backgroundColor, no fills are created.

## Recommendations

### Priority 0 (Critical - Blocking Pixel-Perfect)

1. **Fix Fill Extraction in extractStylesSafe**
   - Location: `chrome-extension/src/utils/dom-extractor.ts:5635-5668`
   - Issue: Inherited backgrounds not creating fills
   - Fix: Create fills for ALL visible backgrounds, mark them with metadata for plugin to handle transparency

2. **Fix SVG Capture**
   - Location: `chrome-extension/src/utils/dom-extractor.ts`
   - Issue: SVG content not extracted
   - Fix: Extract inline SVG markup or set _requiresRasterization=true

3. **Fix Asset Pipeline**
   - Location: `chrome-extension/src/utils/dom-extractor.ts`
   - Issue: Assets array empty
   - Fix: Populate images/svgs assets with actual data

### Priority 1 (High - Major Fidelity Impact)

4. **Enhance Plugin Fallback**
   - Location: `figma-plugin/src/node-builder.ts:4044-4250`
   - Issue: Nodes with empty fills array have no fallback
   - Fix: If data.fills is empty but node is visible, synthesize fill from computedStyle or rasterize

### Priority 2 (Medium - Edge Cases)

5. **Add Schema Validation**
   - Location: `chrome-extension/src/utils/schema-preflight.ts`
   - Issue: Invalid schema not caught before import
   - Fix: Validate all visible nodes have at least one of: fills, backgrounds, imageHash, or _requiresRasterization

