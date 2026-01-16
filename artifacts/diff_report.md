# Pixel-Perfect Fidelity Analysis Report
Generated: 2026-01-11

## Executive Summary
- Total clusters analyzed: 50
- Root causes identified: 2
- P0 (Critical/Missing): 37
- P1 (High/Geometry): 1
- P2 (Medium/Styling): 12

## Findings by Root Cause

### CAPTURE_SCHEMA_BUG (37 clusters)
**Suspect File:** `chrome-extension/src/utils/dom-extractor.ts`

#### Cluster #0 [P0]
- **Issue:** MISSING - element
- **BBox:** x=0, y=0, w=1839, h=1003
- **Impact Score:** 33702384
- **Schema Nodes:**
  - `node_355` (svg) - overlap: 100.0%
  - `node_356_text` (span) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #88 [P0]
- **Issue:** MISSING - element
- **BBox:** x=46, y=405, w=35, h=35
- **Impact Score:** 275469
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_18` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #112 [P0]
- **Issue:** MISSING - element
- **BBox:** x=46, y=463, w=35, h=35
- **Impact Score:** 275469
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_18` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #167 [P0]
- **Issue:** MISSING - element
- **BBox:** x=46, y=521, w=35, h=35
- **Impact Score:** 275469
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_18` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #184 [P0]
- **Issue:** MISSING - element
- **BBox:** x=46, y=579, w=35, h=35
- **Impact Score:** 275469
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_18` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #233 [P0]
- **Issue:** MISSING - element
- **BBox:** x=46, y=637, w=35, h=35
- **Impact Score:** 275469
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_18` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #254 [P0]
- **Issue:** MISSING - element
- **BBox:** x=46, y=695, w=35, h=35
- **Impact Score:** 275469
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_18` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #286 [P0]
- **Issue:** MISSING - element
- **BBox:** x=788, y=870, w=35, h=35
- **Impact Score:** 268709
- **Schema Nodes:**
  - `node_228` (div) - overlap: 100.0%
  - `node_201` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #24 [P0]
- **Issue:** MISSING - element
- **BBox:** x=31, y=147, w=299, h=33
- **Impact Score:** 225505
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_125_text` (span) - overlap: 36.4%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes

#### Cluster #204 [P0]
- **Issue:** MISSING - element
- **BBox:** x=915, y=607, w=78, h=39
- **Impact Score:** 91999
- **Schema Nodes:**
  - `node_228` (div) - overlap: 100.0%
  - `node_201` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** fills_and_backgrounds, strokes


### IMPORT_MAPPING_BUG (13 clusters)
**Suspect File:** `figma-plugin/src/node-builder.ts`

#### Cluster #62 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=30, y=347, w=79, h=35
- **Impact Score:** 389640
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_179_text` (span) - overlap: 77.9%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #30 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=133, y=198, w=56, h=20
- **Impact Score:** 214008
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_136_text` (span) - overlap: 75.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #27 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=49, y=193, w=50, h=25
- **Impact Score:** 184600
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_134_text` (span) - overlap: 60.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #114 [P1]
- **Issue:** WRONG_GEOMETRY - position_or_size
- **BBox:** x=1237, y=469, w=115, h=29
- **Impact Score:** 149916
- **Schema Nodes:**
  - `node_300` (div) - overlap: 45.7%
  - `node_299` (section) - overlap: 45.7%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #22 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=771, y=93, w=275, h=4
- **Impact Score:** 134294
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_18` (div) - overlap: 100.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #29 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=100, y=198, w=31, h=18
- **Impact Score:** 103560
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_134_text` (span) - overlap: 61.3%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #188 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=448, y=586, w=20, h=20
- **Impact Score:** 102120
- **Schema Nodes:**
  - `node_351` (div) - overlap: 33.1%
  - `node_352` (div) - overlap: 66.9%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #118 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=448, y=471, w=20, h=20
- **Impact Score:** 102068
- **Schema Nodes:**
  - `node_307` (div) - overlap: 59.1%
  - `node_308` (div) - overlap: 40.9%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #63 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=142, y=354, w=28, h=21
- **Impact Score:** 94997
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_181_text` (span) - overlap: 50.0%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

#### Cluster #77 [P2]
- **Issue:** WRONG_COLOR - background_or_fill
- **BBox:** x=30, y=381, w=18, h=18
- **Impact Score:** 84495
- **Schema Nodes:**
  - `node_201` (div) - overlap: 100.0%
  - `node_184` (button) - overlap: 88.9%
- **Schema Status:** SCHEMA_BAD
- **Missing Fields:** strokes

