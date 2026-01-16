# Web2Figma Pixel-Perfect Fidelity Debug Report - FINAL

**Date:** 2026-01-11  
**Analysis Method:** Systematic pixel diff + schema audit + code inspection  
**Overall SSIM Score:** 0.5141 (Target: 1.0)  
**Pixels with difference >10:** 979,833 / 1,846,560 (53.04%)

## ROOT CAUSES (PROVEN)

### Root Cause #1: CAPTURE_SCHEMA_BUG

**File:** chrome-extension/src/utils/dom-extractor.ts  
**Lines:** 5633-5667  

**Mechanism:**
Lines 5636-5641 skip fill creation for inherited backgrounds:

```typescript
const isBackgroundInherited = node.inheritanceFlags?.backgroundColorInherited === true;
const elementActuallyPaintsBackground = !isBackgroundInherited && effectiveColorParsed && effectiveColorParsed.a > 0.001;

if (elementActuallyPaintsBackground && effectiveColorParsed) {
  node.fills.push({...}); // SKIPPED for inherited backgrounds
}
```

**Impact:** 71.5% of nodes (304/425) have no fills, rendering as black/transparent in Figma.

**Evidence:**
- Schema: 304 nodes with fills=[], backgrounds=[]
- Cluster #0 (node_355 svg): fills=0, backgrounds=0
- Cluster #88-254 (node_201 div): fills=0, backgrounds=0

### Root Cause #2: IMPORT_MAPPING_BUG

**File:** figma-plugin/src/node-builder.ts  
**Lines:** 4173-4182

**Mechanism:**
Plugin skips fills for inherited backgrounds:

```typescript
const fillsAreInherited = data.colorInheritance?.backgroundColorSource === "inherited";
const shouldSkipFills = computedBgIsTransparent && fillsAreInherited;

if (shouldSkipFills) {
  // FILLS SKIPPED - no paints created
}
```

**Impact:** Even nodes with valid computedStyle.backgroundColor render without fills if marked as inherited.

## PATCHES

See /Users/skirk92/figmacionvert-2/patches/ for implementation.
