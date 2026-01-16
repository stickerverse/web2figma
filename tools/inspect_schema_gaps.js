#!/usr/bin/env node
/**
 * Inspect schema to understand what elements are captured
 * and identify gaps in the rendering
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = '/Users/skirk92/figmacionvert-2/page-capture-1768104797293.json';
const CLUSTERS_PATH = '/Users/skirk92/figmacionvert-2/artifacts/diff_clusters_v2.json';

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function traverseNode(node, depth = 0, callback) {
  callback(node, depth);
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => traverseNode(child, depth + 1, callback));
  }
}

function extractNodeStats(schema) {
  const stats = {
    totalNodes: 0,
    nodesByTag: {},
    nodesByType: {},
    nodesWithImages: 0,
    nodesWithText: 0,
    nodesWithBackground: 0,
    nodesWithBorder: 0,
    rasterized: 0,
    hidden: 0,
    positioned: 0
  };

  traverseNode(schema, 0, (node, depth) => {
    stats.totalNodes++;
    
    // Count by tag
    if (node.tag) {
      stats.nodesByTag[node.tag] = (stats.nodesByTag[node.tag] || 0) + 1;
    }
    
    // Count by type
    if (node.type) {
      stats.nodesByType[node.type] = (stats.nodesByType[node.type] || 0) + 1;
    }
    
    // Images
    if (node.imageData || node.backgroundImage) {
      stats.nodesWithImages++;
    }
    
    // Text
    if (node.text || node.textContent) {
      stats.nodesWithText++;
    }
    
    // Background
    if (node.styles?.backgroundColor || node.styles?.background) {
      stats.nodesWithBackground++;
    }
    
    // Border
    if (node.styles?.border || node.styles?.borderColor) {
      stats.nodesWithBorder++;
    }
    
    // Special flags
    if (node.rasterized) stats.rasterized++;
    if (node.hidden || node.styles?.display === 'none') stats.hidden++;
    if (node.styles?.position === 'absolute' || node.styles?.position === 'fixed') {
      stats.positioned++;
    }
  });

  return stats;
}

function findNodesInRegion(schema, bbox) {
  const matches = [];
  
  traverseNode(schema, 0, (node, depth) => {
    if (!node.boundingBox) return;
    
    const nb = node.boundingBox;
    const centerX = nb.x + nb.width / 2;
    const centerY = nb.y + nb.height / 2;
    
    // Check if center of node is in cluster bbox
    if (centerX >= bbox.x && centerX <= bbox.x + bbox.width &&
        centerY >= bbox.y && centerY <= bbox.y + bbox.height) {
      matches.push({
        id: node.id,
        tag: node.tag,
        type: node.type,
        bbox: nb,
        hasText: !!(node.text || node.textContent),
        hasImage: !!(node.imageData || node.backgroundImage),
        hasBackground: !!(node.styles?.backgroundColor || node.styles?.background),
        depth: depth
      });
    }
  });
  
  return matches;
}

function analyzeClusterGaps(schema, clusters) {
  const analysis = [];
  
  // Focus on top 10 clusters by impact
  const topClusters = clusters.clusters
    .slice(0, 10)
    .sort((a, b) => (b.pixel_count * b.diff_mean) - (a.pixel_count * a.diff_mean));
  
  for (const cluster of topClusters) {
    const matches = findNodesInRegion(schema, cluster.bbox);
    
    analysis.push({
      cluster_id: cluster.id,
      gap_type: cluster.gap_type,
      bbox: cluster.bbox,
      impact: cluster.pixel_count * cluster.diff_mean,
      schema_nodes_found: matches.length,
      nodes_summary: {
        total: matches.length,
        with_text: matches.filter(n => n.hasText).length,
        with_image: matches.filter(n => n.hasImage).length,
        with_background: matches.filter(n => n.hasBackground).length,
        tags: [...new Set(matches.map(n => n.tag))],
        types: [...new Set(matches.map(n => n.type))]
      },
      sample_nodes: matches.slice(0, 5)
    });
  }
  
  return analysis;
}

function main() {
  console.log('Loading schema...');
  const schema = loadJSON(SCHEMA_PATH);
  
  console.log('Loading cluster data...');
  const clusters = loadJSON(CLUSTERS_PATH);
  
  console.log('\n=== SCHEMA STATISTICS ===\n');
  const stats = extractNodeStats(schema);
  console.log(`Total nodes: ${stats.totalNodes}`);
  console.log(`\nNodes with content:`);
  console.log(`  - Text: ${stats.nodesWithText}`);
  console.log(`  - Images: ${stats.nodesWithImages}`);
  console.log(`  - Background: ${stats.nodesWithBackground}`);
  console.log(`  - Border: ${stats.nodesWithBorder}`);
  console.log(`\nSpecial nodes:`);
  console.log(`  - Rasterized: ${stats.rasterized}`);
  console.log(`  - Hidden: ${stats.hidden}`);
  console.log(`  - Positioned: ${stats.positioned}`);
  
  console.log(`\nTop tags:`);
  const sortedTags = Object.entries(stats.nodesByTag)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  sortedTags.forEach(([tag, count]) => console.log(`  ${tag}: ${count}`));
  
  console.log(`\nTop types:`);
  const sortedTypes = Object.entries(stats.nodesByType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  sortedTypes.forEach(([type, count]) => console.log(`  ${type}: ${count}`));
  
  console.log('\n=== GAP ANALYSIS ===\n');
  const gapAnalysis = analyzeClusterGaps(schema, clusters);
  
  gapAnalysis.forEach(gap => {
    console.log(`\nCluster #${gap.cluster_id} (${gap.gap_type})`);
    console.log(`  Impact: ${gap.impact.toFixed(0)}`);
    console.log(`  Bbox: ${gap.bbox.width}x${gap.bbox.height} at (${gap.bbox.x}, ${gap.bbox.y})`);
    console.log(`  Schema nodes in region: ${gap.schema_nodes_found}`);
    
    if (gap.schema_nodes_found > 0) {
      console.log(`  Content summary:`);
      console.log(`    - Text nodes: ${gap.nodes_summary.with_text}`);
      console.log(`    - Image nodes: ${gap.nodes_summary.with_image}`);
      console.log(`    - Background nodes: ${gap.nodes_summary.with_background}`);
      console.log(`    - Tags: ${gap.nodes_summary.tags.join(', ')}`);
      console.log(`    - Types: ${gap.nodes_summary.types.join(', ')}`);
      
      if (gap.sample_nodes.length > 0) {
        console.log(`  Sample nodes:`);
        gap.sample_nodes.forEach(node => {
          console.log(`    - ${node.tag} (${node.type}): ${node.bbox.width}x${node.bbox.height}`);
        });
      }
    } else {
      console.log(`  ⚠️  NO SCHEMA NODES FOUND IN THIS REGION`);
    }
  });
  
  // Save detailed analysis
  const outputPath = '/Users/skirk92/figmacionvert-2/artifacts/schema_gap_analysis.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    stats,
    gap_analysis: gapAnalysis
  }, null, 2));
  console.log(`\n✓ Saved detailed analysis to ${outputPath}`);
}

main();
