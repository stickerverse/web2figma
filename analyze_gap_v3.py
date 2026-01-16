#!/usr/bin/env python3
"""
Pixel-perfect gap analysis for Web2Figma pipeline - V3

Adds optional Figma "built node snapshot" ingestion to improve diagnosis:
- cluster -> schema nodes (expected)
- cluster -> figma nodes (actual imported/rendered)

Diagnosis categories:
- Schema OK + Figma node missing ⇒ IMPORT_MAPPING_BUG (or upstream asset pipeline if it's an image fill)
- Schema OK + Figma node exists but wrong bbox ⇒ GEOMETRY_BUG / layout constraints
- Schema OK + Figma node exists but wrong paints/effects ⇒ IMPORT_MAPPING_BUG
- Unsupported visuals + Figma node present but simplified ⇒ NEEDS_RASTER_FALLBACK
"""

import argparse
import cv2
import numpy as np
import json
from pathlib import Path
from sklearn.cluster import DBSCAN
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple


# -----------------------------
# Utils
# -----------------------------

def read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def safe_float(v, default=0.0) -> float:
    try:
        return float(v)
    except Exception:
        return float(default)

def safe_int(v, default=0) -> int:
    try:
        return int(round(float(v)))
    except Exception:
        return int(default)

def normalize_bbox(obj: Any) -> Optional[Dict[str, int]]:
    """
    Normalize various bbox shapes to {x,y,width,height} ints.
    Supports:
      - {x,y,width,height}
      - {left,top,right,bottom}
      - {xMin,yMin,xMax,yMax}
      - Figma: {x,y,width,height} already
    """
    if not isinstance(obj, dict):
        return None

    # x,y,w,h
    if all(k in obj for k in ("x", "y", "width", "height")):
        x = safe_int(obj.get("x"))
        y = safe_int(obj.get("y"))
        w = max(0, safe_int(obj.get("width")))
        h = max(0, safe_int(obj.get("height")))
        return {"x": x, "y": y, "width": w, "height": h}

    # left/top/right/bottom
    if all(k in obj for k in ("left", "top", "right", "bottom")):
        left = safe_int(obj.get("left"))
        top = safe_int(obj.get("top"))
        right = safe_int(obj.get("right"))
        bottom = safe_int(obj.get("bottom"))
        return {"x": left, "y": top, "width": max(0, right - left), "height": max(0, bottom - top)}

    # xMin/yMin/xMax/yMax
    if all(k in obj for k in ("xMin", "yMin", "xMax", "yMax")):
        x0 = safe_int(obj.get("xMin"))
        y0 = safe_int(obj.get("yMin"))
        x1 = safe_int(obj.get("xMax"))
        y1 = safe_int(obj.get("yMax"))
        return {"x": x0, "y": y0, "width": max(0, x1 - x0), "height": max(0, y1 - y0)}

    return None

def bbox_area(b: Dict[str, int]) -> int:
    return max(0, b["width"]) * max(0, b["height"])

def bbox_intersection(a: Dict[str, int], b: Dict[str, int]) -> int:
    ax0, ay0 = a["x"], a["y"]
    ax1, ay1 = a["x"] + a["width"], a["y"] + a["height"]
    bx0, by0 = b["x"], b["y"]
    bx1, by1 = b["x"] + b["width"], b["y"] + b["height"]

    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    return iw * ih

def bbox_iou(a: Dict[str, int], b: Dict[str, int]) -> float:
    inter = bbox_intersection(a, b)
    if inter <= 0:
        return 0.0
    union = bbox_area(a) + bbox_area(b) - inter
    return float(inter) / float(union) if union > 0 else 0.0

def bbox_contains_point(b: Dict[str, int], x: int, y: int) -> bool:
    return (b["x"] <= x <= b["x"] + b["width"]) and (b["y"] <= y <= b["y"] + b["height"])


# -----------------------------
# Image pipeline
# -----------------------------

def load_images(original_path: Path, figma_path: Path) -> Tuple[np.ndarray, np.ndarray, Tuple[int, int]]:
    """Load and naïvely align images by cropping to common min dimensions."""
    img_a = cv2.imread(str(original_path))
    img_b = cv2.imread(str(figma_path))

    if img_a is None or img_b is None:
        raise ValueError(f"Failed to load images: {original_path}, {figma_path}")

    h_a, w_a = img_a.shape[:2]
    h_b, w_b = img_b.shape[:2]
    h = min(h_a, h_b)
    w = min(w_a, w_b)

    img_a = img_a[:h, :w]
    img_b = img_b[:h, :w]
    return img_a, img_b, (h, w)

def compute_diff(img_a: np.ndarray, img_b: np.ndarray) -> np.ndarray:
    diff = cv2.absdiff(img_a.astype(np.float32), img_b.astype(np.float32))
    diff_magnitude = np.sqrt(np.sum(diff ** 2, axis=2))
    return diff_magnitude

def cluster_differences(diff_magnitude: np.ndarray, threshold: float = 20.0, min_cluster_size: int = 100) -> Tuple[List[Dict[str, Any]], np.ndarray]:
    """Cluster significant differences using DBSCAN in (y,x) pixel space."""
    mask = diff_magnitude > threshold
    coords = np.column_stack(np.where(mask))  # (y,x)

    if len(coords) == 0:
        return [], mask

    clustering = DBSCAN(eps=30, min_samples=10).fit(coords)
    labels = clustering.labels_

    clusters: List[Dict[str, Any]] = []
    for label in set(labels):
        if label == -1:
            continue

        cluster_coords = coords[labels == label]
        y_coords, x_coords = cluster_coords[:, 0], cluster_coords[:, 1]

        bbox = {
            "x": int(x_coords.min()),
            "y": int(y_coords.min()),
            "width": int(x_coords.max() - x_coords.min() + 1),
            "height": int(y_coords.max() - y_coords.min() + 1),
        }

        y_min, y_max = int(y_coords.min()), int(y_coords.max()) + 1
        x_min, x_max = int(x_coords.min()), int(x_coords.max()) + 1
        cluster_diff = diff_magnitude[y_min:y_max, x_min:x_max]

        cluster = {
            "id": len(clusters),
            "bbox": bbox,
            "pixel_count": int(len(cluster_coords)),
            "diff_mean": float(cluster_diff.mean()),
            "diff_max": float(cluster_diff.max()),
            "diff_std": float(cluster_diff.std()),
        }

        if cluster["pixel_count"] >= min_cluster_size:
            clusters.append(cluster)

    clusters.sort(key=lambda c: c["pixel_count"] * c["diff_mean"], reverse=True)
    return clusters, mask

def classify_gap(cluster: Dict[str, Any], img_a: np.ndarray, img_b: np.ndarray) -> str:
    """Heuristic classification of gap types based on local texture + darkness."""
    bbox = cluster["bbox"]
    x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]

    region_a = img_a[y:y+h, x:x+w]
    region_b = img_b[y:y+h, x:x+w]

    if region_a.size == 0 or region_b.size == 0:
        return "UNKNOWN"

    is_mostly_black_b = float(np.mean(region_b)) < 20.0
    is_mostly_flat_a = float(np.std(region_a)) < 30.0

    gray_a = cv2.cvtColor(region_a, cv2.COLOR_BGR2GRAY)
    has_high_frequency_a = float(cv2.Laplacian(gray_a, cv2.CV_64F).var()) > 500.0

    if is_mostly_black_b and not is_mostly_flat_a:
        return "MISSING_ELEMENT"
    if is_mostly_black_b and is_mostly_flat_a:
        return "MISSING_BACKGROUND"
    if has_high_frequency_a:
        return "MISSING_DETAIL"
    return "STYLE_MISMATCH"


# -----------------------------
# Schema extraction + matching
# -----------------------------

def extract_schema_nodes(schema: Any) -> List[Dict[str, Any]]:
    """
    Extract nodes from schema by scanning dicts recursively.
    Supports common bbox fields: boundingBox, bbox, layout, absoluteBoundingBox.
    """
    nodes: List[Dict[str, Any]] = []

    def walk(obj: Any):
        if isinstance(obj, dict):
            bbox = None
            for key in ("boundingBox", "bbox", "layout", "absoluteBoundingBox", "absoluteBoundingBoxCSS", "absoluteLayout"):
                if key in obj:
                    bbox = normalize_bbox(obj.get(key))
                    if bbox:
                        break

            if bbox:
                nodes.append({
                    "id": obj.get("id"),
                    "name": obj.get("name") or obj.get("tag") or obj.get("htmlTag"),
                    "tag": obj.get("tag") or obj.get("htmlTag"),
                    "type": obj.get("type"),
                    "bbox": bbox,
                    "_requiresRasterization": obj.get("_requiresRasterization", False),
                    "fills": obj.get("fills"),
                    "effects": obj.get("effects"),
                })

            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(schema)
    return nodes

def match_clusters_to_schema(clusters: List[Dict[str, Any]], schema_nodes: List[Dict[str, Any]], min_iou: float = 0.01) -> None:
    """Attach schema matches per cluster based on bbox overlap."""
    for cluster in clusters:
        cb = cluster["bbox"]
        cx, cy = cb["x"] + cb["width"] // 2, cb["y"] + cb["height"] // 2

        matches = []
        for node in schema_nodes:
            nb = node["bbox"]
            if bbox_contains_point(nb, cx, cy) or bbox_iou(cb, nb) >= min_iou:
                matches.append({
                    "id": node.get("id"),
                    "name": node.get("name"),
                    "type": node.get("type"),
                    "tag": node.get("tag"),
                    "bbox": nb,
                    "iou": bbox_iou(cb, nb),
                    "_requiresRasterization": node.get("_requiresRasterization", False),
                })

        matches.sort(key=lambda m: m["iou"], reverse=True)
        cluster["schema_matches"] = matches[:10]
        cluster["has_schema_node"] = len(matches) > 0


# -----------------------------
# Figma built-nodes ingestion + matching
# -----------------------------

def extract_figma_nodes(figma_snapshot: Any) -> List[Dict[str, Any]]:
    """
    Accepts either:
      - {"nodes":[...]}  (flat)
      - {"flatNodes":[...]}
      - {"root": {...}}  (tree)
    Produces a flat list with normalized bbox and key metadata.
    """
    out: List[Dict[str, Any]] = []

    def norm_entry(n: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(n, dict):
            return None

        bbox = None
        for key in ("absoluteBoundingBox", "absoluteRenderBounds", "bbox"):
            if key in n:
                bbox = normalize_bbox(n.get(key))
                if bbox:
                    break

        if not bbox:
            # sometimes x/y/width/height are top-level
            bbox = normalize_bbox(n)
        if not bbox:
            return None

        return {
            "figmaId": n.get("id") or n.get("figmaId"),
            "schemaId": n.get("schemaId") or n.get("pluginData", {}).get("schemaId"),
            "name": n.get("name"),
            "type": n.get("type"),
            "visible": n.get("visible", True),
            "opacity": safe_float(n.get("opacity", 1.0), 1.0),
            "clipsContent": n.get("clipsContent", False),
            "bbox": bbox,
            # optionally pass through paints/effects summary if present
            "fills": n.get("fills"),
            "strokes": n.get("strokes"),
            "effects": n.get("effects"),
        }

    def walk(obj: Any):
        if isinstance(obj, dict):
            # If this dict looks like a node, try to normalize it.
            maybe = norm_entry(obj)
            if maybe:
                out.append(maybe)

            # Tree children
            if "children" in obj and isinstance(obj["children"], list):
                for c in obj["children"]:
                    walk(c)

            # Otherwise walk all values
            for v in obj.values():
                walk(v)

        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    if isinstance(figma_snapshot, dict) and isinstance(figma_snapshot.get("nodes"), list):
        for n in figma_snapshot["nodes"]:
            maybe = norm_entry(n)
            if maybe:
                out.append(maybe)
        return out

    if isinstance(figma_snapshot, dict) and isinstance(figma_snapshot.get("flatNodes"), list):
        for n in figma_snapshot["flatNodes"]:
            maybe = norm_entry(n)
            if maybe:
                out.append(maybe)
        return out

    # fallback tree walk
    walk(figma_snapshot)
    return out

def build_figma_index(figma_nodes: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Index figma nodes by schemaId when available."""
    idx: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for n in figma_nodes:
        sid = n.get("schemaId")
        if sid:
            idx[str(sid)].append(n)
    return idx

def match_clusters_to_figma(
    clusters: List[Dict[str, Any]],
    figma_nodes: List[Dict[str, Any]],
    figma_by_schema_id: Dict[str, List[Dict[str, Any]]],
    min_iou: float = 0.01
) -> None:
    """
    Attach figma matches per cluster:
      - Prefer schemaId linkage using cluster schema_matches ids
      - Otherwise fall back to bbox IoU against all figma nodes
    """
    for cluster in clusters:
        cb = cluster["bbox"]
        candidates: List[Dict[str, Any]] = []

        # Prefer schemaId mapping if schema matches exist
        schema_matches = cluster.get("schema_matches") or []
        linked = []
        for sm in schema_matches:
            sid = sm.get("id")
            if sid and str(sid) in figma_by_schema_id:
                linked.extend(figma_by_schema_id[str(sid)])

        # Deduplicate linked nodes by figmaId
        seen = set()
        for n in linked:
            fid = n.get("figmaId")
            if fid and fid not in seen:
                seen.add(fid)
                candidates.append(n)

        # If nothing linked, do bbox IoU matching
        if not candidates:
            for n in figma_nodes:
                iou = bbox_iou(cb, n["bbox"])
                if iou >= min_iou:
                    candidates.append({**n, "iou": iou})
            candidates.sort(key=lambda m: m.get("iou", 0.0), reverse=True)
        else:
            # compute iou for linked candidates too
            tmp = []
            for n in candidates:
                tmp.append({**n, "iou": bbox_iou(cb, n["bbox"])})
            candidates = sorted(tmp, key=lambda m: m.get("iou", 0.0), reverse=True)

        cluster["figma_matches"] = candidates[:10]
        cluster["has_figma_node"] = len(candidates) > 0

        # Add quick "actual state" flags
        if candidates:
            top = candidates[0]
            cluster["figma_top_type"] = top.get("type")
            cluster["figma_top_visible"] = bool(top.get("visible", True))
            cluster["figma_top_opacity"] = float(top.get("opacity", 1.0))
            cluster["figma_top_clipped"] = bool(top.get("clipsContent", False))


# -----------------------------
# Root cause classification
# -----------------------------

def classify_root_cause(cluster: Dict[str, Any]) -> Tuple[str, str, str]:
    """
    Classify root cause based on schema + figma coverage.
    Returns: (root_cause, suspect_file, explanation)
    """
    has_schema = cluster.get("has_schema_node", False)
    has_figma = cluster.get("has_figma_node", False)
    gap_type = cluster.get("gap_type", "UNKNOWN")
    
    # Check if any schema node requires rasterization
    requires_raster = False
    for sm in cluster.get("schema_matches", []):
        if sm.get("_requiresRasterization"):
            requires_raster = True
            break
    
    # Schema OK + Figma node missing ⇒ IMPORT_MAPPING_BUG
    if has_schema and not has_figma:
        if requires_raster:
            return (
                "NEEDS_RASTER_FALLBACK",
                "figma-plugin/src/screenshot-overlay.ts",
                "Schema node marked for rasterization but not found in Figma"
            )
        # Check if it's likely an image asset issue
        for sm in cluster.get("schema_matches", []):
            tag = sm.get("tag", "")
            if tag in ["img", "svg", "picture", "canvas", "video"]:
                return (
                    "ASSET_PIPELINE_BUG",
                    "figma-plugin/src/enhanced-figma-importer.ts",
                    f"Image/media element ({tag}) not created in Figma"
                )
        return (
            "IMPORT_MAPPING_BUG",
            "figma-plugin/src/node-builder.ts",
            "Schema node exists but Figma node missing - importer skipped node"
        )
    
    # Schema OK + Figma node exists but potential bbox mismatch
    if has_schema and has_figma:
        figma_top_visible = cluster.get("figma_top_visible", True)
        figma_top_opacity = cluster.get("figma_top_opacity", 1.0)
        figma_top_clipped = cluster.get("figma_top_clipped", False)
        
        if not figma_top_visible or figma_top_opacity < 0.01:
            return (
                "VISIBILITY_BUG",
                "figma-plugin/src/node-builder.ts",
                "Figma node exists but is hidden or fully transparent"
            )
        
        if figma_top_clipped:
            return (
                "CLIPPING_BUG",
                "figma-plugin/src/node-builder.ts",
                "Figma node exists but parent clips content"
            )
        
        if gap_type == "MISSING_ELEMENT" or gap_type == "MISSING_BACKGROUND":
            return (
                "GEOMETRY_BUG",
                "figma-plugin/src/node-builder.ts",
                "Figma node exists but bbox/layout shifted it off-canvas or wrong size"
            )
        
        if gap_type == "STYLE_MISMATCH":
            return (
                "STYLE_MAPPING_BUG",
                "figma-plugin/src/node-builder.ts",
                "Figma node exists but paints/effects not matching schema"
            )
    
    # No schema node found
    if not has_schema:
        return (
            "CAPTURE_SCHEMA_BUG",
            "chrome-extension/src/utils/dom-extractor.ts",
            "Element not captured in schema - DOM extractor missed it"
        )
    
    return (
        "UNKNOWN",
        "unknown",
        "Could not determine root cause"
    )


# -----------------------------
# Output
# -----------------------------

def generate_visualizations(img_a, img_b, diff_magnitude, clusters, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    cv2.imwrite(str(output_dir / "aligned_A_v3.png"), img_a)
    cv2.imwrite(str(output_dir / "aligned_B_v3.png"), img_b)

    diff_max = float(diff_magnitude.max()) if float(diff_magnitude.max()) > 0 else 1.0
    diff_normalized = (diff_magnitude / diff_max * 255).astype(np.uint8)
    heatmap = cv2.applyColorMap(diff_normalized, cv2.COLORMAP_JET)
    heatmap_overlay = cv2.addWeighted(img_a, 0.6, heatmap, 0.4, 0)
    cv2.imwrite(str(output_dir / "diff_heatmap_v3.png"), heatmap_overlay)

    img_clusters = img_a.copy()
    for i, cluster in enumerate(clusters[:30]):
        bbox = cluster["bbox"]
        x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]

        if cluster["pixel_count"] > 1000:
            color = (0, 0, 255)  # Red
        elif cluster["pixel_count"] > 500:
            color = (0, 165, 255)  # Orange
        else:
            color = (0, 255, 255)  # Yellow

        cv2.rectangle(img_clusters, (x, y), (x + w, y + h), color, 2)
        label = f"#{i}"
        # annotate with schema/figma coverage
        s = "S✓" if cluster.get("has_schema_node") else "S✗"
        f = "F✓" if cluster.get("has_figma_node") else "F✗"
        cv2.putText(img_clusters, f"{label} {s}{f}", (x, max(0, y - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

    cv2.imwrite(str(output_dir / "diff_clusters_v3.png"), img_clusters)
    print(f"✓ Saved visualizations to {output_dir}")

def generate_report(clusters: List[Dict[str, Any]], img_shape: Tuple[int, int], output_path: Path, has_figma_nodes: bool) -> None:
    h, w = img_shape
    total_pixels = h * w
    diff_pixels = sum(c["pixel_count"] for c in clusters)
    diff_percentage = (diff_pixels / total_pixels) * 100.0 if total_pixels > 0 else 0.0

    report: List[str] = []
    report.append("# Gap Analysis Report v3 - With Figma Node Snapshot Support")
    report.append("")
    report.append("## Summary")
    report.append(f"- Image dimensions: {w}x{h}")
    report.append(f"- Total pixels: {total_pixels:,}")
    report.append(f"- Diff pixels (clustered): {diff_pixels:,} ({diff_percentage:.2f}%)")
    report.append(f"- Significant clusters: {len(clusters)}")
    report.append(f"- Figma node snapshot: {'✓ Loaded' if has_figma_nodes else '✗ Not provided (schema-only analysis)'}")

    # Coverage statistics
    schema_hits = sum(1 for c in clusters if c.get("has_schema_node"))
    figma_hits = sum(1 for c in clusters if c.get("has_figma_node"))
    report.append("")
    report.append("## Coverage Statistics")
    report.append(f"- Clusters with schema match: {schema_hits}/{len(clusters)} ({100*schema_hits/len(clusters) if clusters else 0:.1f}%)")
    if has_figma_nodes:
        report.append(f"- Clusters with figma match: {figma_hits}/{len(clusters)} ({100*figma_hits/len(clusters) if clusters else 0:.1f}%)")

    # Gap classification
    gap_types = defaultdict(list)
    for c in clusters:
        gap_types[c.get("gap_type", "UNKNOWN")].append(c)

    report.append("")
    report.append("## Gap Classification")
    for gap_type, gaps in sorted(gap_types.items(), key=lambda x: -len(x[1])):
        total = sum(g["pixel_count"] for g in gaps)
        report.append(f"")
        report.append(f"### {gap_type}: {len(gaps)} clusters ({total:,} pixels)")
        for g in gaps[:5]:
            b = g["bbox"]
            root_cause, suspect_file, explanation = classify_root_cause(g)
            report.append(f"- Cluster #{g['id']}: {b['width']}x{b['height']} @ ({b['x']},{b['y']}) "
                          f"pixels={g['pixel_count']} mean={g['diff_mean']:.1f}")
            if not g.get("has_schema_node"):
                report.append(f"  - ⚠️ No schema node match")
            if has_figma_nodes and not g.get("has_figma_node"):
                report.append(f"  - ⚠️ No figma built-node match")
            report.append(f"  - 🔍 Root cause: **{root_cause}** → `{suspect_file}`")
            report.append(f"  - 💡 {explanation}")

    # Root cause summary
    root_cause_counts = defaultdict(int)
    for c in clusters:
        rc, _, _ = classify_root_cause(c)
        root_cause_counts[rc] += 1
    
    report.append("")
    report.append("## Root Cause Summary")
    report.append("")
    report.append("| Root Cause | Count | Suspect File |")
    report.append("|------------|-------|--------------|")
    
    suspect_files = {
        "IMPORT_MAPPING_BUG": "figma-plugin/src/node-builder.ts",
        "ASSET_PIPELINE_BUG": "figma-plugin/src/enhanced-figma-importer.ts",
        "NEEDS_RASTER_FALLBACK": "figma-plugin/src/screenshot-overlay.ts",
        "GEOMETRY_BUG": "figma-plugin/src/node-builder.ts",
        "STYLE_MAPPING_BUG": "figma-plugin/src/node-builder.ts",
        "VISIBILITY_BUG": "figma-plugin/src/node-builder.ts",
        "CLIPPING_BUG": "figma-plugin/src/node-builder.ts",
        "CAPTURE_SCHEMA_BUG": "chrome-extension/src/utils/dom-extractor.ts",
        "UNKNOWN": "unknown",
    }
    
    for rc, count in sorted(root_cause_counts.items(), key=lambda x: -x[1]):
        report.append(f"| {rc} | {count} | `{suspect_files.get(rc, 'unknown')}` |")

    # Priority table
    report.append("")
    report.append("## Priority Ranking (Top 20)")
    report.append("")
    if has_figma_nodes:
        report.append("| Rank | Cluster | Type | Size | Impact | Schema | Figma | FigmaTop | Root Cause |")
        report.append("|------|---------|------|------|--------|--------|-------|----------|------------|")
    else:
        report.append("| Rank | Cluster | Type | Size | Impact | Schema | Root Cause |")
        report.append("|------|---------|------|------|--------|--------|------------|")
    
    for i, c in enumerate(clusters[:20], 1):
        b = c["bbox"]
        impact = c["pixel_count"] * c["diff_mean"]
        s = "✓" if c.get("has_schema_node") else "✗"
        root_cause, _, _ = classify_root_cause(c)
        
        if has_figma_nodes:
            f = "✓" if c.get("has_figma_node") else "✗"
            top = c.get("figma_top_type", "")
            report.append(f"| {i} | #{c['id']} | {c.get('gap_type','UNKNOWN')} | {b['width']}x{b['height']} | {impact:,.0f} | {s} | {f} | {top} | {root_cause} |")
        else:
            report.append(f"| {i} | #{c['id']} | {c.get('gap_type','UNKNOWN')} | {b['width']}x{b['height']} | {impact:,.0f} | {s} | {root_cause} |")

    # Diagnostic recommendations
    report.append("")
    report.append("## Diagnostic Recommendations")
    report.append("")
    
    if root_cause_counts.get("CAPTURE_SCHEMA_BUG", 0) > 0:
        report.append("### Capture Schema Issues")
        report.append("- Review `chrome-extension/src/utils/dom-extractor.ts`")
        report.append("- Check if elements are being skipped due to visibility/size thresholds")
        report.append("- Verify bbox extraction handles all CSS transform cases")
        report.append("")
    
    if root_cause_counts.get("IMPORT_MAPPING_BUG", 0) > 0:
        report.append("### Import Mapping Issues")
        report.append("- Review `figma-plugin/src/node-builder.ts` and `enhanced-figma-importer.ts`")
        report.append("- Check if node types are being filtered incorrectly")
        report.append("- Verify all schema node types have corresponding Figma node creators")
        report.append("")
    
    if root_cause_counts.get("GEOMETRY_BUG", 0) > 0 or root_cause_counts.get("STYLE_MAPPING_BUG", 0) > 0:
        report.append("### Geometry/Style Issues")
        report.append("- Nodes exist but rendering differs - check layout constraint application")
        report.append("- Verify fill/stroke/effect translation in node-builder.ts")
        report.append("- Check for DPR scaling issues between schema and Figma")
        report.append("")
    
    if root_cause_counts.get("NEEDS_RASTER_FALLBACK", 0) > 0:
        report.append("### Raster Fallback Needed")
        report.append("- Elements marked for rasterization but not rendered")
        report.append("- Review `figma-plugin/src/screenshot-overlay.ts`")
        report.append("- Check if screenshot bytes are being correctly embedded")
        report.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(report))
    print(f"✓ Saved gap analysis report to {output_path}")


# -----------------------------
# Main
# -----------------------------

def main():
    ap = argparse.ArgumentParser(description="Pixel-perfect gap analysis for Web2Figma pipeline (v3)")
    ap.add_argument("--repo-root", type=str, default="/Users/skirk92/figmacionvert-2", help="Repo root path")
    ap.add_argument("--original", type=str, default="github.com_.png", help="Path to original screenshot (A), relative to repo root unless absolute")
    ap.add_argument("--figma", type=str, default="artifacts/handoff/debug/9d935f49-3f22-4c77-82b3-1f2eee9f079c/import_render.png", help="Path to figma render screenshot (B)")
    ap.add_argument("--schema", type=str, default="page-capture-1768104797293.json", help="Path to capture schema JSON")
    ap.add_argument("--figma-nodes", type=str, default="", help="Optional: path to figma built nodes snapshot JSON")
    ap.add_argument("--out", type=str, default="artifacts", help="Output dir, relative to repo root unless absolute")
    ap.add_argument("--threshold", type=float, default=20.0, help="Pixel diff threshold")
    ap.add_argument("--min-cluster", type=int, default=100, help="Minimum cluster pixel count")
    ap.add_argument("--min-iou", type=float, default=0.01, help="Min IoU for bbox matching")
    args = ap.parse_args()

    repo_root = Path(args.repo_root)

    def resolve(p: str) -> Path:
        pp = Path(p)
        return pp if pp.is_absolute() else (repo_root / pp)

    original_img = resolve(args.original)
    figma_img = resolve(args.figma)
    schema_file = resolve(args.schema)
    output_dir = resolve(args.out)

    print("=" * 60)
    print("PIXEL-PERFECT GAP ANALYSIS v3")
    print("With Figma Built-Node Snapshot Support")
    print("=" * 60)
    
    print("\nLoading images...")
    img_a, img_b, shape = load_images(original_img, figma_img)
    print(f"  Original: {original_img}")
    print(f"  Figma: {figma_img}")
    print(f"  Aligned size: {shape[1]}x{shape[0]}")

    print("\nComputing pixel differences...")
    diff_magnitude = compute_diff(img_a, img_b)

    print("\nClustering differences...")
    clusters, _mask = cluster_differences(diff_magnitude, threshold=args.threshold, min_cluster_size=args.min_cluster)
    print(f"  Found {len(clusters)} significant difference clusters")

    print("\nClassifying gaps...")
    for cluster in clusters:
        cluster["gap_type"] = classify_gap(cluster, img_a, img_b)

    print("\nLoading schema + matching clusters to schema...")
    schema = read_json(schema_file)
    schema_nodes = extract_schema_nodes(schema)
    print(f"  Extracted {len(schema_nodes)} schema nodes with bbox")
    match_clusters_to_schema(clusters, schema_nodes, min_iou=args.min_iou)
    schema_hits = sum(1 for c in clusters if c.get("has_schema_node"))
    print(f"  Clusters with schema match: {schema_hits}/{len(clusters)}")

    # Optional: Figma built nodes
    figma_nodes: List[Dict[str, Any]] = []
    has_figma_nodes = False
    if args.figma_nodes:
        figma_nodes_path = resolve(args.figma_nodes)
        print(f"\nLoading figma built nodes snapshot: {figma_nodes_path}")
        figma_snapshot = read_json(figma_nodes_path)
        figma_nodes = extract_figma_nodes(figma_snapshot)
        figma_idx = build_figma_index(figma_nodes)
        match_clusters_to_figma(clusters, figma_nodes, figma_idx, min_iou=args.min_iou)
        has_figma_nodes = True
        figma_hits = sum(1 for c in clusters if c.get("has_figma_node"))
        print(f"  ✓ Figma nodes loaded: {len(figma_nodes)} (schema-linked: {len(figma_idx)})")
        print(f"  Clusters with figma match: {figma_hits}/{len(clusters)}")
    else:
        print("\n⚠️  No figma built-nodes snapshot provided (schema-only analysis).")
        print("   To enable full diagnosis, export figma nodes from your plugin and use --figma-nodes")

    print("\nGenerating visualizations...")
    generate_visualizations(img_a, img_b, diff_magnitude, clusters, output_dir)

    print("\nGenerating reports...")
    generate_report(clusters, shape, output_dir / "gap_analysis_v3.md", has_figma_nodes)

    # Save cluster data
    output_dir.mkdir(parents=True, exist_ok=True)
    with open(output_dir / "diff_clusters_v3.json", "w", encoding="utf-8") as f:
        json.dump({"clusters": clusters, "total_found": len(clusters), "has_figma_nodes": has_figma_nodes}, f, indent=2)

    print("\n" + "=" * 60)
    print("ANALYSIS COMPLETE!")
    print("=" * 60)
    print(f"\nOutputs:")
    print(f"  - Visualizations: {output_dir}")
    print(f"  - Gap analysis: {output_dir / 'gap_analysis_v3.md'}")
    print(f"  - Cluster data: {output_dir / 'diff_clusters_v3.json'}")
    
    # Print quick summary
    root_cause_counts = defaultdict(int)
    for c in clusters:
        rc, _, _ = classify_root_cause(c)
        root_cause_counts[rc] += 1
    
    print("\nRoot Cause Summary:")
    for rc, count in sorted(root_cause_counts.items(), key=lambda x: -x[1]):
        print(f"  - {rc}: {count} clusters")

if __name__ == "__main__":
    main()
