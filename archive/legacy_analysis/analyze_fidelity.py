#!/usr/bin/env python3
"""
Pixel-Perfect Fidelity Analysis Pipeline
Generates alignment, diff, cluster analysis, and root cause identification
"""

import json
import sys
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage
try:
    import cv2
    HAS_CV2 = True
except:
    HAS_CV2 = False
from pathlib import Path

# Configuration
REPO_ROOT = Path("/Users/skirk92/figmacionvert-2")
ORIGINAL = REPO_ROOT / "github.com_.png"
FIGMA = REPO_ROOT / "figma_screenshot.png"
SCHEMA = REPO_ROOT / "page-capture-1768104797293.json"
ARTIFACTS = REPO_ROOT / "artifacts"
PATCHES = REPO_ROOT / "patches"

ARTIFACTS.mkdir(exist_ok=True)
PATCHES.mkdir(exist_ok=True)

def load_images():
    """Load and analyze original and Figma screenshots"""
    print("=== LOADING IMAGES ===")
    orig = Image.open(ORIGINAL).convert('RGB')
    figma = Image.open(FIGMA).convert('RGB')
    
    print(f"Original: {orig.size} ({orig.mode})")
    print(f"Figma: {figma.size} ({figma.mode})")
    
    return orig, figma

def align_images(orig, figma):
    """Align images to same scale/crop/DPR"""
    print("\n=== ALIGNING IMAGES ===")
    
    # Get dimensions
    orig_w, orig_h = orig.size
    figma_w, figma_h = figma.size
    
    print(f"Original size: {orig_w}x{orig_h}")
    print(f"Figma size: {figma_w}x{figma_h}")
    
    # Determine alignment strategy
    # Strategy: Use the smaller dimensions and crop from top-left
    target_w = min(orig_w, figma_w)
    target_h = min(orig_h, figma_h)
    
    # Crop both to same size
    aligned_orig = orig.crop((0, 0, target_w, target_h))
    aligned_figma = figma.crop((0, 0, target_w, target_h))
    
    # Save aligned images
    aligned_orig.save(ARTIFACTS / "aligned_A.png")
    aligned_figma.save(ARTIFACTS / "aligned_B.png")
    
    # Save alignment metadata
    alignment_data = {
        "original": {"width": orig_w, "height": orig_h},
        "figma": {"width": figma_w, "height": figma_h},
        "aligned": {"width": target_w, "height": target_h},
        "crop_region": {"x": 0, "y": 0, "width": target_w, "height": target_h},
        "method": "crop_to_common_size"
    }
    
    with open(ARTIFACTS / "alignment.json", 'w') as f:
        json.dump(alignment_data, f, indent=2)
    
    print(f"Aligned to: {target_w}x{target_h}")
    print(f"Saved: aligned_A.png, aligned_B.png, alignment.json")
    
    return aligned_orig, aligned_figma, alignment_data

def compute_ssim_simple(orig_gray, figma_gray, window_size=11):
    """Simple SSIM implementation"""
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2
    
    # Use uniform filter for means
    mu1 = ndimage.uniform_filter(orig_gray.astype(float), window_size)
    mu2 = ndimage.uniform_filter(figma_gray.astype(float), window_size)
    
    mu1_sq = mu1 ** 2
    mu2_sq = mu2 ** 2
    mu1_mu2 = mu1 * mu2
    
    sigma1_sq = ndimage.uniform_filter(orig_gray.astype(float) ** 2, window_size) - mu1_sq
    sigma2_sq = ndimage.uniform_filter(figma_gray.astype(float) ** 2, window_size) - mu2_sq
    sigma12 = ndimage.uniform_filter(orig_gray.astype(float) * figma_gray.astype(float), window_size) - mu1_mu2
    
    ssim_map = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))
    
    return ssim_map.mean(), ssim_map

def compute_diff(aligned_orig, aligned_figma):
    """Generate pixel-level and SSIM-based diff"""
    print("\n=== COMPUTING DIFF ===")
    
    # Convert to numpy arrays
    orig_arr = np.array(aligned_orig)
    figma_arr = np.array(aligned_figma)
    
    # Pixel-level difference
    diff_arr = np.abs(orig_arr.astype(np.float32) - figma_arr.astype(np.float32))
    diff_magnitude = np.sqrt(np.sum(diff_arr**2, axis=2))
    
    # Normalize to 0-255
    diff_normalized = (diff_magnitude / diff_magnitude.max() * 255).astype(np.uint8) if diff_magnitude.max() > 0 else diff_magnitude.astype(np.uint8)
    
    # Create heatmap (simple color mapping)
    heatmap = np.zeros((*diff_normalized.shape, 3), dtype=np.uint8)
    heatmap[:,:,2] = 255 - diff_normalized  # Blue for no diff
    heatmap[:,:,0] = diff_normalized  # Red for diff
    
    # Save heatmap
    Image.fromarray(heatmap).save(ARTIFACTS / "diff_heatmap.png")
    
    # Compute SSIM
    orig_gray = np.dot(orig_arr[...,:3], [0.299, 0.587, 0.114]).astype(np.uint8)
    figma_gray = np.dot(figma_arr[...,:3], [0.299, 0.587, 0.114]).astype(np.uint8)
    
    ssim_score, ssim_map = compute_ssim_simple(orig_gray, figma_gray)
    
    print(f"Overall SSIM: {ssim_score:.4f}")
    print(f"Diff magnitude range: {diff_magnitude.min():.2f} - {diff_magnitude.max():.2f}")
    
    # Find significant differences (threshold)
    threshold = 10  # Minimum RGB distance to consider
    diff_mask = diff_magnitude > threshold
    
    num_diff_pixels = np.sum(diff_mask)
    total_pixels = diff_mask.size
    diff_percentage = (num_diff_pixels / total_pixels) * 100
    
    print(f"Pixels with diff > {threshold}: {num_diff_pixels:,} ({diff_percentage:.2f}%)")
    
    return diff_magnitude, diff_mask, ssim_score

def cluster_differences(diff_magnitude, diff_mask):
    """Cluster differences by proximity"""
    print("\n=== CLUSTERING DIFFERENCES ===")
    
    # Find connected components in diff mask
    labeled, num_features = ndimage.label(diff_mask)
    
    print(f"Found {num_features} connected regions")
    
    # Extract clusters with bbox and stats
    clusters = []
    
    for region_id in range(1, num_features + 1):
        region_mask = labeled == region_id
        region_pixels = np.sum(region_mask)
        
        # Skip very small regions (noise)
        if region_pixels < 20:
            continue
        
        # Get bounding box
        coords = np.argwhere(region_mask)
        y_min, x_min = coords.min(axis=0)
        y_max, x_max = coords.max(axis=0)
        
        # Compute stats
        region_diff = diff_magnitude[region_mask]
        
        cluster = {
            "id": len(clusters),
            "bbox": {
                "x": int(x_min),
                "y": int(y_min),
                "width": int(x_max - x_min),
                "height": int(y_max - y_min)
            },
            "pixel_count": int(region_pixels),
            "diff_mean": float(region_diff.mean()),
            "diff_max": float(region_diff.max()),
            "diff_std": float(region_diff.std())
        }
        
        clusters.append(cluster)
    
    # Sort by impact (pixel_count * diff_mean)
    clusters.sort(key=lambda c: c['pixel_count'] * c['diff_mean'], reverse=True)
    
    # Visualize clusters
    cluster_img = Image.open(ARTIFACTS / "aligned_A.png").convert('RGB')
    draw = ImageDraw.Draw(cluster_img)
    
    for i, cluster in enumerate(clusters[:50]):  # Top 50
        bbox = cluster['bbox']
        x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
        
        # Color based on severity
        severity = min(255, int(cluster['diff_mean'] * 2))
        color = (severity, 0, 255 - severity)
        
        # Draw rectangle
        draw.rectangle([x, y, x+w, y+h], outline=color, width=2)
        
        # Draw label
        try:
            draw.text((x, y-10), f"#{i}", fill=color)
        except:
            pass
    
    cluster_img.save(ARTIFACTS / "diff_clusters.png")
    
    # Save cluster data
    with open(ARTIFACTS / "diff_clusters.json", 'w') as f:
        json.dump({"clusters": clusters[:100], "total_found": len(clusters)}, f, indent=2)
    
    print(f"Saved top {min(100, len(clusters))} clusters to diff_clusters.json")
    print(f"Visualized top 50 in diff_clusters.png")
    
    return clusters

def load_schema():
    """Load and index the capture schema"""
    print("\n=== LOADING SCHEMA ===")
    
    with open(SCHEMA) as f:
        schema = json.load(f)
    
    cap_data = schema['captures'][0]['data']
    
    # Build node index by ID and bbox
    node_index = {}
    bbox_index = []
    
    def index_node(node, depth=0):
        node_id = node.get('id')
        if node_id:
            node_index[node_id] = node
        
        # Index by bbox
        layout = node.get('absoluteLayout') or node.get('layout', {})
        if layout:
            left = layout.get('left', layout.get('x', 0))
            top = layout.get('top', layout.get('y', 0))
            width = layout.get('width', 0)
            height = layout.get('height', 0)
            
            if width > 0 and height > 0:
                bbox_index.append({
                    'id': node_id,
                    'bbox': {'x': left, 'y': top, 'width': width, 'height': height},
                    'node': node,
                    'depth': depth
                })
        
        # Recurse
        for child in node.get('children', []):
            index_node(child, depth + 1)
    
    index_node(cap_data['root'])
    
    print(f"Indexed {len(node_index)} nodes")
    print(f"Bbox index: {len(bbox_index)} nodes with valid bbox")
    
    return cap_data, node_index, bbox_index

def find_overlapping_nodes(cluster_bbox, bbox_index, min_overlap=0.3):
    """Find schema nodes that overlap with cluster bbox"""
    cx, cy, cw, ch = cluster_bbox['x'], cluster_bbox['y'], cluster_bbox['width'], cluster_bbox['height']
    
    overlapping = []
    
    for entry in bbox_index:
        nb = entry['bbox']
        nx, ny, nw, nh = nb['x'], nb['y'], nb['width'], nb['height']
        
        # Compute intersection
        ix1 = max(cx, nx)
        iy1 = max(cy, ny)
        ix2 = min(cx + cw, nx + nw)
        iy2 = min(cy + ch, ny + nh)
        
        if ix2 > ix1 and iy2 > iy1:
            intersection_area = (ix2 - ix1) * (iy2 - iy1)
            cluster_area = cw * ch
            node_area = nw * nh
            
            overlap_ratio = intersection_area / min(cluster_area, node_area)
            
            if overlap_ratio >= min_overlap:
                overlapping.append({
                    'node_id': entry['id'],
                    'node': entry['node'],
                    'overlap_ratio': overlap_ratio,
                    'depth': entry['depth']
                })
    
    # Sort by depth (deeper = more specific)
    overlapping.sort(key=lambda x: x['depth'], reverse=True)
    
    return overlapping

def classify_cluster_issue(cluster, aligned_orig, aligned_figma, overlapping_nodes):
    """Classify the issue type for a cluster"""
    bbox = cluster['bbox']
    x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
    
    # Extract regions
    orig_region = np.array(aligned_orig.crop((x, y, x+w, y+h)))
    figma_region = np.array(aligned_figma.crop((x, y, x+w, y+h)))
    
    # Check if Figma region is mostly black/empty
    figma_mean = figma_region.mean()
    figma_std = figma_region.std()
    
    is_missing = figma_mean < 30 and figma_std < 20
    
    # Compare colors
    orig_mean_color = orig_region.mean(axis=(0,1))
    figma_mean_color = figma_region.mean(axis=(0,1))
    color_diff = np.linalg.norm(orig_mean_color - figma_mean_color)
    
    # Classify
    if is_missing:
        issue_type = "MISSING"
        subtype = "element"
    elif color_diff > 50:
        issue_type = "WRONG_COLOR"
        subtype = "background_or_fill"
    else:
        issue_type = "WRONG_GEOMETRY"
        subtype = "position_or_size"
    
    # Analyze schema nodes
    schema_status = "SCHEMA_OK"
    missing_fields = []
    
    if overlapping_nodes:
        node = overlapping_nodes[0]['node']
        
        # Check for common missing fields
        fills = node.get('fills', [])
        backgrounds = node.get('backgrounds', [])
        
        if not fills and not backgrounds and is_missing:
            missing_fields.append('fills_and_backgrounds')
        if not node.get('strokes'):
            missing_fields.append('strokes')
        if node.get('_requiresRasterization') and is_missing:
            missing_fields.append('_rasterization_failed')
        
        if missing_fields:
            schema_status = "SCHEMA_BAD"
    else:
        schema_status = "NODE_NOT_FOUND"
        missing_fields.append('node_missing_from_schema')
    
    return {
        'issue_type': issue_type,
        'subtype': subtype,
        'schema_status': schema_status,
        'missing_fields': missing_fields,
        'metrics': {
            'figma_mean': float(figma_mean),
            'figma_std': float(figma_std),
            'color_diff': float(color_diff)
        }
    }

def assign_root_cause(cluster_analysis, overlapping_nodes):
    """Assign root cause category"""
    issue_type = cluster_analysis['issue_type']
    schema_status = cluster_analysis['schema_status']
    
    if schema_status == "NODE_NOT_FOUND":
        return "CAPTURE_SCHEMA_BUG", "chrome-extension/src/utils/dom-extractor.ts"
    
    if schema_status == "SCHEMA_BAD":
        if '_rasterization_failed' in cluster_analysis['missing_fields']:
            return "RASTER_FALLBACK", "figma-plugin/src/screenshot-overlay.ts"
        if 'fills_and_backgrounds' in cluster_analysis['missing_fields']:
            return "CAPTURE_SCHEMA_BUG", "chrome-extension/src/utils/dom-extractor.ts"
    
    if issue_type == "MISSING":
        # Check node type
        if overlapping_nodes:
            node = overlapping_nodes[0]['node']
            html_tag = node.get('htmlTag', '')
            
            if html_tag in ['img', 'svg', 'picture']:
                return "ASSET_PIPELINE_BUG", "figma-plugin/src/enhanced-figma-importer.ts"
            elif html_tag in ['div', 'span', 'section', 'header']:
                return "IMPORT_MAPPING_BUG", "figma-plugin/src/node-builder.ts"
    
    if issue_type in ["WRONG_GEOMETRY", "WRONG_COLOR"]:
        return "IMPORT_MAPPING_BUG", "figma-plugin/src/node-builder.ts"
    
    return "UNKNOWN", "unknown"

def analyze_clusters(clusters, aligned_orig, aligned_figma, bbox_index):
    """Perform full cluster analysis"""
    print("\n=== ANALYZING CLUSTERS ===")
    
    analyzed = []
    
    for i, cluster in enumerate(clusters[:50]):  # Top 50 by impact
        print(f"Analyzing cluster {i+1}/{min(50, len(clusters))}...", end='\r')
        
        # Find overlapping nodes
        overlapping = find_overlapping_nodes(cluster['bbox'], bbox_index)
        
        # Classify issue
        classification = classify_cluster_issue(cluster, aligned_orig, aligned_figma, overlapping)
        
        # Assign root cause
        root_cause, suspect_file = assign_root_cause(classification, overlapping)
        
        analyzed.append({
            'cluster_id': cluster['id'],
            'bbox': cluster['bbox'],
            'impact_score': cluster['pixel_count'] * cluster['diff_mean'],
            'overlapping_nodes': [
                {
                    'id': n['node_id'],
                    'htmlTag': n['node'].get('htmlTag'),
                    'name': n['node'].get('name'),
                    'overlap_ratio': n['overlap_ratio']
                } for n in overlapping[:3]
            ],
            'classification': classification,
            'root_cause': root_cause,
            'suspect_file': suspect_file
        })
    
    print("\nAnalysis complete!                    ")
    
    # Save analysis
    with open(ARTIFACTS / "cluster_analysis.json", 'w') as f:
        json.dump(analyzed, f, indent=2)
    
    return analyzed

def generate_diff_report(analyzed_clusters):
    """Generate markdown diff report"""
    print("\n=== GENERATING DIFF REPORT ===")
    
    # Group by root cause
    by_root_cause = {}
    for cluster in analyzed_clusters:
        rc = cluster['root_cause']
        if rc not in by_root_cause:
            by_root_cause[rc] = []
        by_root_cause[rc].append(cluster)
    
    # Priority mapping
    priority_map = {
        'MISSING': 'P0',
        'WRONG_GEOMETRY': 'P1',
        'WRONG_COLOR': 'P2',
    }
    
    report = []
    report.append("# Pixel-Perfect Fidelity Analysis Report\n")
    report.append("Generated: 2026-01-11\n")
    report.append("\n## Executive Summary\n")
    report.append(f"- Total clusters analyzed: {len(analyzed_clusters)}\n")
    report.append(f"- Root causes identified: {len(by_root_cause)}\n")
    
    # Count by priority
    p0 = sum(1 for c in analyzed_clusters if priority_map.get(c['classification']['issue_type']) == 'P0')
    p1 = sum(1 for c in analyzed_clusters if priority_map.get(c['classification']['issue_type']) == 'P1')
    p2 = sum(1 for c in analyzed_clusters if priority_map.get(c['classification']['issue_type']) == 'P2')
    
    report.append(f"- P0 (Critical/Missing): {p0}\n")
    report.append(f"- P1 (High/Geometry): {p1}\n")
    report.append(f"- P2 (Medium/Styling): {p2}\n")
    
    report.append("\n## Findings by Root Cause\n")
    
    for root_cause in sorted(by_root_cause.keys()):
        clusters = by_root_cause[root_cause]
        report.append(f"\n### {root_cause} ({len(clusters)} clusters)\n")
        report.append(f"**Suspect File:** `{clusters[0]['suspect_file']}`\n\n")
        
        for cluster in clusters[:10]:  # Top 10 per root cause
            priority = priority_map.get(cluster['classification']['issue_type'], 'P2')
            report.append(f"#### Cluster #{cluster['cluster_id']} [{priority}]\n")
            report.append(f"- **Issue:** {cluster['classification']['issue_type']} - {cluster['classification']['subtype']}\n")
            report.append(f"- **BBox:** x={cluster['bbox']['x']}, y={cluster['bbox']['y']}, w={cluster['bbox']['width']}, h={cluster['bbox']['height']}\n")
            report.append(f"- **Impact Score:** {cluster['impact_score']:.0f}\n")
            
            if cluster['overlapping_nodes']:
                report.append(f"- **Schema Nodes:**\n")
                for node in cluster['overlapping_nodes'][:2]:
                    report.append(f"  - `{node['id']}` ({node['htmlTag']}) - overlap: {node['overlap_ratio']:.1%}\n")
            else:
                report.append(f"- **Schema Nodes:** None found (MISSING FROM CAPTURE)\n")
            
            report.append(f"- **Schema Status:** {cluster['classification']['schema_status']}\n")
            if cluster['classification']['missing_fields']:
                report.append(f"- **Missing Fields:** {', '.join(cluster['classification']['missing_fields'])}\n")
            report.append("\n")
    
    report_text = ''.join(report)
    
    with open(ARTIFACTS / "diff_report.md", 'w') as f:
        f.write(report_text)
    
    print(f"Saved diff_report.md")
    return report_text

def main():
    """Main analysis pipeline"""
    print("=" * 60)
    print("PIXEL-PERFECT FIDELITY ANALYSIS PIPELINE")
    print("=" * 60)
    
    # Step 1: Load images
    orig, figma = load_images()
    
    # Step 2: Align
    aligned_orig, aligned_figma, alignment_data = align_images(orig, figma)
    
    # Step 3: Compute diff
    diff_magnitude, diff_mask, ssim_score = compute_diff(aligned_orig, aligned_figma)
    
    # Step 4: Cluster differences
    clusters = cluster_differences(diff_magnitude, diff_mask)
    
    # Step 5: Load schema
    cap_data, node_index, bbox_index = load_schema()
    
    # Step 6: Analyze clusters
    analyzed_clusters = analyze_clusters(clusters, aligned_orig, aligned_figma, bbox_index)
    
    # Step 7: Generate report
    report = generate_diff_report(analyzed_clusters)
    
    print("\n" + "=" * 60)
    print("ANALYSIS COMPLETE")
    print("=" * 60)
    print(f"\nOutputs in: {ARTIFACTS}")
    print("- aligned_A.png, aligned_B.png")
    print("- diff_heatmap.png, diff_clusters.png")
    print("- diff_clusters.json, cluster_analysis.json")
    print("- diff_report.md")
    print(f"\nOverall SSIM: {ssim_score:.4f} (1.0 = perfect)")
    print(f"Total issues found: {len(analyzed_clusters)}")

if __name__ == '__main__':
    main()
