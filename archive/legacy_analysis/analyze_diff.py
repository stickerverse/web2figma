#!/usr/bin/env python3
"""
Pixel-perfect gap analysis for Web2Figma pipeline
Analyzes remaining fidelity issues after P0 patches
"""

import cv2
import numpy as np
import json
from pathlib import Path
from sklearn.cluster import DBSCAN
from collections import defaultdict
import sys

def load_images(original_path, figma_path):
    """Load and align images"""
    img_a = cv2.imread(str(original_path))
    img_b = cv2.imread(str(figma_path))
    
    if img_a is None or img_b is None:
        raise ValueError(f"Failed to load images: {original_path}, {figma_path}")
    
    # Get dimensions
    h_a, w_a = img_a.shape[:2]
    h_b, w_b = img_b.shape[:2]
    
    # Use minimum dimensions to avoid edge artifacts
    h = min(h_a, h_b)
    w = min(w_a, w_b)
    
    # Crop to common size
    img_a = img_a[:h, :w]
    img_b = img_b[:h, :w]
    
    return img_a, img_b, (h, w)

def compute_diff(img_a, img_b):
    """Compute pixel difference"""
    # Convert to float for accurate diff
    diff = cv2.absdiff(img_a.astype(np.float32), img_b.astype(np.float32))
    
    # Compute per-pixel magnitude
    diff_magnitude = np.sqrt(np.sum(diff ** 2, axis=2))
    
    return diff_magnitude

def cluster_differences(diff_magnitude, threshold=20, min_cluster_size=100):
    """Cluster significant differences using DBSCAN"""
    # Find pixels with significant differences
    mask = diff_magnitude > threshold
    coords = np.column_stack(np.where(mask))
    
    if len(coords) == 0:
        return [], mask
    
    # Cluster using DBSCAN
    clustering = DBSCAN(eps=30, min_samples=10).fit(coords)
    labels = clustering.labels_
    
    # Build clusters
    clusters = []
    unique_labels = set(labels)
    
    for label in unique_labels:
        if label == -1:  # Noise
            continue
        
        cluster_coords = coords[labels == label]
        y_coords, x_coords = cluster_coords[:, 0], cluster_coords[:, 1]
        
        bbox = {
            'x': int(x_coords.min()),
            'y': int(y_coords.min()),
            'width': int(x_coords.max() - x_coords.min() + 1),
            'height': int(y_coords.max() - y_coords.min() + 1)
        }
        
        # Extract cluster region
        y_min, y_max = y_coords.min(), y_coords.max() + 1
        x_min, x_max = x_coords.min(), x_coords.max() + 1
        cluster_diff = diff_magnitude[y_min:y_max, x_min:x_max]
        
        cluster = {
            'id': len(clusters),
            'bbox': bbox,
            'pixel_count': len(cluster_coords),
            'diff_mean': float(cluster_diff.mean()),
            'diff_max': float(cluster_diff.max()),
            'diff_std': float(cluster_diff.std())
        }
        
        # Only include significant clusters
        if cluster['pixel_count'] >= min_cluster_size:
            clusters.append(cluster)
    
    # Sort by impact (pixel_count * diff_mean)
    clusters.sort(key=lambda c: c['pixel_count'] * c['diff_mean'], reverse=True)
    
    return clusters, mask

def classify_gap(cluster, schema_data, img_a, img_b):
    """Classify the type of gap"""
    bbox = cluster['bbox']
    x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
    
    # Extract regions
    region_a = img_a[y:y+h, x:x+w]
    region_b = img_b[y:y+h, x:x+w]
    
    # Analyze region characteristics
    is_mostly_black_b = np.mean(region_b) < 20
    is_mostly_similar_color_a = np.std(region_a) < 30
    has_high_frequency_a = cv2.Laplacian(cv2.cvtColor(region_a, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() > 500
    
    # Classification
    if is_mostly_black_b and not is_mostly_similar_color_a:
        return 'MISSING_ELEMENT'
    elif is_mostly_black_b and is_mostly_similar_color_a:
        return 'MISSING_BACKGROUND'
    elif has_high_frequency_a:
        return 'MISSING_DETAIL'
    else:
        return 'STYLE_MISMATCH'

def generate_visualizations(img_a, img_b, diff_magnitude, clusters, output_dir):
    """Generate visualization outputs"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Save aligned images
    cv2.imwrite(str(output_dir / 'aligned_A_v2.png'), img_a)
    cv2.imwrite(str(output_dir / 'aligned_B_v2.png'), img_b)
    
    # Create heatmap
    diff_normalized = (diff_magnitude / diff_magnitude.max() * 255).astype(np.uint8)
    heatmap = cv2.applyColorMap(diff_normalized, cv2.COLORMAP_JET)
    
    # Overlay on original
    heatmap_overlay = cv2.addWeighted(img_a, 0.6, heatmap, 0.4, 0)
    cv2.imwrite(str(output_dir / 'diff_heatmap_v2.png'), heatmap_overlay)
    
    # Draw cluster boxes
    img_clusters = img_a.copy()
    for i, cluster in enumerate(clusters[:30]):  # Top 30 clusters
        bbox = cluster['bbox']
        x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
        
        # Color by severity
        if cluster['pixel_count'] > 1000:
            color = (0, 0, 255)  # Red for large
        elif cluster['pixel_count'] > 500:
            color = (0, 165, 255)  # Orange for medium
        else:
            color = (0, 255, 255)  # Yellow for small
        
        cv2.rectangle(img_clusters, (x, y), (x+w, y+h), color, 2)
        cv2.putText(img_clusters, f"#{i}", (x, y-5), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
    
    cv2.imwrite(str(output_dir / 'diff_clusters_v2.png'), img_clusters)
    
    print(f"✓ Saved visualizations to {output_dir}")

def analyze_schema_coverage(clusters, schema_path):
    """Analyze which schema nodes might be missing"""
    with open(schema_path, 'r') as f:
        schema = json.load(f)
    
    # Extract all nodes with positions
    def extract_nodes(node, nodes=[]):
        if isinstance(node, dict):
            if 'boundingBox' in node:
                nodes.append({
                    'id': node.get('id'),
                    'tag': node.get('tag'),
                    'type': node.get('type'),
                    'bbox': node['boundingBox']
                })
            if 'children' in node:
                for child in node['children']:
                    extract_nodes(child, nodes)
        return nodes
    
    schema_nodes = extract_nodes(schema)
    
    # Match clusters to schema nodes
    for cluster in clusters:
        cb = cluster['bbox']
        cx, cy = cb['x'] + cb['width']//2, cb['y'] + cb['height']//2
        
        # Find overlapping schema nodes
        matches = []
        for node in schema_nodes:
            nb = node['bbox']
            if (nb['x'] <= cx <= nb['x'] + nb['width'] and 
                nb['y'] <= cy <= nb['y'] + nb['height']):
                matches.append(node)
        
        cluster['schema_matches'] = matches
        cluster['has_schema_node'] = len(matches) > 0
    
    return clusters

def generate_report(clusters, img_shape, output_path):
    """Generate detailed gap analysis report"""
    h, w = img_shape
    total_pixels = h * w
    diff_pixels = sum(c['pixel_count'] for c in clusters)
    diff_percentage = (diff_pixels / total_pixels) * 100
    
    report = []
    report.append("# Gap Analysis Report v2 - Post P0 Patches")
    report.append(f"\n## Summary Statistics")
    report.append(f"- Total image pixels: {total_pixels:,}")
    report.append(f"- Pixels with differences: {diff_pixels:,} ({diff_percentage:.2f}%)")
    report.append(f"- Significant difference clusters: {len(clusters)}")
    report.append(f"- Image dimensions: {w}x{h}")
    
    # Classify gaps
    gap_types = defaultdict(list)
    for c in clusters:
        gap_type = c.get('gap_type', 'UNKNOWN')
        gap_types[gap_type].append(c)
    
    report.append(f"\n## Gap Classification")
    for gap_type, gaps in sorted(gap_types.items(), key=lambda x: -len(x[1])):
        total_pixels = sum(g['pixel_count'] for g in gaps)
        report.append(f"\n### {gap_type}: {len(gaps)} clusters ({total_pixels:,} pixels)")
        for gap in gaps[:5]:  # Top 5 per type
            bbox = gap['bbox']
            report.append(f"  - Cluster #{gap['id']}: {bbox['width']}x{bbox['height']} at ({bbox['x']}, {bbox['y']})")
            report.append(f"    Pixels: {gap['pixel_count']}, Diff mean: {gap['diff_mean']:.1f}")
            if not gap.get('has_schema_node'):
                report.append(f"    ⚠️  NO SCHEMA NODE FOUND")
    
    # Priority ranking
    report.append(f"\n## Priority Ranking (Top 20)")
    report.append("\n| Rank | Cluster | Type | Size | Impact | Schema |")
    report.append("|------|---------|------|------|--------|--------|")
    
    for i, cluster in enumerate(clusters[:20], 1):
        bbox = cluster['bbox']
        impact = cluster['pixel_count'] * cluster['diff_mean']
        gap_type = cluster.get('gap_type', 'UNKNOWN')
        has_schema = '✓' if cluster.get('has_schema_node') else '✗'
        report.append(f"| {i} | #{cluster['id']} | {gap_type} | {bbox['width']}x{bbox['height']} | {impact:,.0f} | {has_schema} |")
    
    with open(output_path, 'w') as f:
        f.write('\n'.join(report))
    
    print(f"✓ Saved gap analysis report to {output_path}")

def main():
    # Paths
    repo_root = Path('/Users/skirk92/figmacionvert-2')
    original_img = repo_root / 'github.com_.png'
    figma_img = repo_root / 'artifacts/handoff/debug/9d935f49-3f22-4c77-82b3-1f2eee9f079c/import_render.png'
    schema_file = repo_root / 'page-capture-1768104797293.json'
    output_dir = repo_root / 'artifacts'
    
    print("Loading images...")
    img_a, img_b, shape = load_images(original_img, figma_img)
    
    print("Computing pixel differences...")
    diff_magnitude = compute_diff(img_a, img_b)
    
    print("Clustering differences...")
    clusters, mask = cluster_differences(diff_magnitude, threshold=20, min_cluster_size=100)
    
    print(f"Found {len(clusters)} significant difference clusters")
    
    print("Classifying gaps...")
    for cluster in clusters:
        cluster['gap_type'] = classify_gap(cluster, schema_file, img_a, img_b)
    
    print("Analyzing schema coverage...")
    clusters = analyze_schema_coverage(clusters, schema_file)
    
    print("Generating visualizations...")
    generate_visualizations(img_a, img_b, diff_magnitude, clusters, output_dir)
    
    print("Generating reports...")
    generate_report(clusters, shape, output_dir / 'gap_analysis_v2.md')
    
    # Save cluster data
    with open(output_dir / 'diff_clusters_v2.json', 'w') as f:
        json.dump({'clusters': clusters, 'total_found': len(clusters)}, f, indent=2)
    
    print("\n✓ Analysis complete!")
    print(f"  - Visualizations: {output_dir}")
    print(f"  - Gap analysis: {output_dir / 'gap_analysis_v2.md'}")
    print(f"  - Cluster data: {output_dir / 'diff_clusters_v2.json'}")

if __name__ == '__main__':
    main()
