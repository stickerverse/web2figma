# Gap Analysis Report v2 - Post P0 Patches

## Summary Statistics
- Total image pixels: 5,349,680
- Pixels with differences: 1,130,424 (21.13%)
- Significant difference clusters: 22
- Image dimensions: 2870x1864

## Gap Classification

### MISSING_ELEMENT: 10 clusters (73,328 pixels)
  - Cluster #16: 804x109 at (1356, 1384)
    Pixels: 40745, Diff mean: 32.9
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #13: 220x56 at (1949, 864)
    Pixels: 12212, Diff mean: 58.5
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #15: 220x56 at (1949, 1126)
    Pixels: 12212, Diff mean: 58.5
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #3: 60x58 at (122, 34)
    Pixels: 1576, Diff mean: 176.9
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #18: 305x61 at (770, 1419)
    Pixels: 3613, Diff mean: 39.4
    ⚠️  NO SCHEMA NODE FOUND

### MISSING_DETAIL: 7 clusters (1,042,027 pixels)
  - Cluster #2: 2137x1508 at (733, 30)
    Pixels: 1004122, Diff mean: 28.0
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #9: 374x383 at (49, 350)
    Pixels: 28160, Diff mean: 50.9
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #7: 218x34 at (48, 192)
    Pixels: 3240, Diff mean: 131.8
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #5: 145x28 at (213, 52)
    Pixels: 2172, Diff mean: 166.6
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #8: 233x28 at (76, 268)
    Pixels: 1861, Diff mean: 49.7
    ⚠️  NO SCHEMA NODE FOUND

### STYLE_MISMATCH: 3 clusters (7,665 pixels)
  - Cluster #17: 183x36 at (2193, 1384)
    Pixels: 6409, Diff mean: 43.5
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #0: 2x544 at (8, 0)
    Pixels: 1084, Diff mean: 66.3
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #1: 16x12 at (48, 0)
    Pixels: 172, Diff mean: 242.2
    ⚠️  NO SCHEMA NODE FOUND

### MISSING_BACKGROUND: 2 clusters (7,404 pixels)
  - Cluster #21: 2198x2 at (672, 1577)
    Pixels: 4396, Diff mean: 111.5
    ⚠️  NO SCHEMA NODE FOUND
  - Cluster #14: 670x836 at (0, 1028)
    Pixels: 3008, Diff mean: 1.3
    ⚠️  NO SCHEMA NODE FOUND

## Priority Ranking (Top 20)

| Rank | Cluster | Type | Size | Impact | Schema |
|------|---------|------|------|--------|--------|
| 1 | #2 | MISSING_DETAIL | 2137x1508 | 28,068,369 | ✗ |
| 2 | #9 | MISSING_DETAIL | 374x383 | 1,432,474 | ✗ |
| 3 | #16 | MISSING_ELEMENT | 804x109 | 1,338,616 | ✗ |
| 4 | #13 | MISSING_ELEMENT | 220x56 | 715,012 | ✗ |
| 5 | #15 | MISSING_ELEMENT | 220x56 | 715,012 | ✗ |
| 6 | #21 | MISSING_BACKGROUND | 2198x2 | 490,326 | ✗ |
| 7 | #7 | MISSING_DETAIL | 218x34 | 427,054 | ✗ |
| 8 | #5 | MISSING_DETAIL | 145x28 | 361,795 | ✗ |
| 9 | #17 | STYLE_MISMATCH | 183x36 | 278,843 | ✗ |
| 10 | #3 | MISSING_ELEMENT | 60x58 | 278,743 | ✗ |
| 11 | #18 | MISSING_ELEMENT | 305x61 | 142,496 | ✗ |
| 12 | #8 | MISSING_DETAIL | 233x28 | 92,448 | ✗ |
| 13 | #12 | MISSING_DETAIL | 124x24 | 90,076 | ✗ |
| 14 | #11 | MISSING_ELEMENT | 175x23 | 72,435 | ✗ |
| 15 | #0 | STYLE_MISMATCH | 2x544 | 71,822 | ✗ |
| 16 | #6 | MISSING_DETAIL | 129x56 | 48,883 | ✗ |
| 17 | #1 | STYLE_MISMATCH | 16x12 | 41,659 | ✗ |
| 18 | #19 | MISSING_ELEMENT | 80x24 | 39,850 | ✗ |
| 19 | #20 | MISSING_ELEMENT | 69x19 | 38,909 | ✗ |
| 20 | #10 | MISSING_ELEMENT | 32x28 | 28,101 | ✗ |