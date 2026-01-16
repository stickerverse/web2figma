/**
 * Tree Chunker - Splits large node trees into manageable chunks to prevent WASM OOM
 *
 * **Problem:** Figma's WASM plugin runtime has limited heap memory (~16MB).
 * Large imports (>5000 nodes) trigger:
 * - RuntimeError: memory access out of bounds
 * - RuntimeError: null function or function signature mismatch
 *
 * **Solution:** Split the tree into chunks of ~1500 nodes each, creating separate
 * frames for each chunk. This stays well below the 5000-node OOM threshold.
 */

import type { ElementNode } from "../../shared/schema";

export interface TreeChunk {
  nodes: ElementNode[];
  startY: number; // Vertical offset for this chunk
  endY: number;   // Bottom boundary of this chunk
  nodeCount: number;
  chunkIndex: number;
}

export interface ChunkingOptions {
  maxNodesPerChunk: number; // Default: 1500 (well below 5000-node OOM threshold)
  chunkingStrategy: "depth-first" | "breadth-first" | "spatial-vertical";
}

/**
 * Count total nodes in tree (recursive)
 */
export function countNodes(node: ElementNode): number {
  if (!node) return 0;
  let count = 1;
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

/**
 * Split tree into chunks using spatial-vertical strategy.
 * Groups nodes by their vertical position on the page.
 */
export function chunkTreeSpatialVertical(
  root: ElementNode,
  maxNodesPerChunk: number
): TreeChunk[] {
  const chunks: TreeChunk[] = [];

  // Get all direct children (top-level sections of the page)
  const children = root.children || [];
  if (children.length === 0) {
    return [];
  }

  let currentChunk: ElementNode[] = [];
  let currentNodeCount = 0;
  let currentStartY = 0;
  let currentEndY = 0;
  let chunkIndex = 0;

  for (const child of children) {
    const nodeCount = countNodes(child);
    const childY = child.layout?.y || child.absoluteLayout?.y || 0;
    const childHeight = child.layout?.height || child.absoluteLayout?.height || 0;
    const childEndY = childY + childHeight;

    // Start first chunk
    if (currentChunk.length === 0) {
      currentStartY = childY;
    }

    // Check if adding this child would exceed chunk size
    if (currentNodeCount + nodeCount > maxNodesPerChunk && currentChunk.length > 0) {
      // Finalize current chunk
      chunks.push({
        nodes: currentChunk,
        startY: currentStartY,
        endY: currentEndY,
        nodeCount: currentNodeCount,
        chunkIndex: chunkIndex++,
      });

      // Start new chunk
      currentChunk = [child];
      currentNodeCount = nodeCount;
      currentStartY = childY;
      currentEndY = childEndY;
    } else {
      // Add to current chunk
      currentChunk.push(child);
      currentNodeCount += nodeCount;
      currentEndY = Math.max(currentEndY, childEndY);
    }
  }

  // Add final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      nodes: currentChunk,
      startY: currentStartY,
      endY: currentEndY,
      nodeCount: currentNodeCount,
      chunkIndex: chunkIndex,
    });
  }

  return chunks;
}

/**
 * Split tree into chunks using depth-first strategy.
 * Traverses tree depth-first and creates chunks when size limit is reached.
 */
export function chunkTreeDepthFirst(
  root: ElementNode,
  maxNodesPerChunk: number
): TreeChunk[] {
  const chunks: TreeChunk[] = [];
  const children = root.children || [];

  if (children.length === 0) {
    return [];
  }

  let currentChunk: ElementNode[] = [];
  let currentNodeCount = 0;
  let chunkIndex = 0;

  for (const child of children) {
    const nodeCount = countNodes(child);

    // If this single child exceeds chunk size, put it in its own chunk
    if (nodeCount >= maxNodesPerChunk) {
      // Finalize current chunk if not empty
      if (currentChunk.length > 0) {
        chunks.push({
          nodes: currentChunk,
          startY: 0,
          endY: 0,
          nodeCount: currentNodeCount,
          chunkIndex: chunkIndex++,
        });
        currentChunk = [];
        currentNodeCount = 0;
      }

      // Add oversized child as its own chunk
      chunks.push({
        nodes: [child],
        startY: 0,
        endY: 0,
        nodeCount,
        chunkIndex: chunkIndex++,
      });
    }
    // Check if adding this child would exceed chunk size
    else if (currentNodeCount + nodeCount > maxNodesPerChunk && currentChunk.length > 0) {
      // Finalize current chunk
      chunks.push({
        nodes: currentChunk,
        startY: 0,
        endY: 0,
        nodeCount: currentNodeCount,
        chunkIndex: chunkIndex++,
      });

      // Start new chunk
      currentChunk = [child];
      currentNodeCount = nodeCount;
    } else {
      // Add to current chunk
      currentChunk.push(child);
      currentNodeCount += nodeCount;
    }
  }

  // Add final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      nodes: currentChunk,
      startY: 0,
      endY: 0,
      nodeCount: currentNodeCount,
      chunkIndex: chunkIndex,
    });
  }

  return chunks;
}

/**
 * Main chunking function. Auto-selects best strategy based on tree structure.
 */
export function chunkTree(
  root: ElementNode,
  options: Partial<ChunkingOptions> = {}
): TreeChunk[] {
  const maxNodesPerChunk = options.maxNodesPerChunk || 1500;
  const strategy = options.chunkingStrategy || "spatial-vertical";

  const totalNodes = countNodes(root);
  console.log(`🪓 [CHUNKER] Chunking tree: ${totalNodes} total nodes, max ${maxNodesPerChunk} per chunk, strategy: ${strategy}`);

  let chunks: TreeChunk[];

  if (strategy === "spatial-vertical") {
    chunks = chunkTreeSpatialVertical(root, maxNodesPerChunk);
  } else if (strategy === "depth-first") {
    chunks = chunkTreeDepthFirst(root, maxNodesPerChunk);
  } else {
    // Default to depth-first
    chunks = chunkTreeDepthFirst(root, maxNodesPerChunk);
  }

  console.log(`✅ [CHUNKER] Created ${chunks.length} chunks:`, chunks.map((c, i) =>
    `Chunk ${i}: ${c.nodeCount} nodes (Y: ${c.startY.toFixed(0)}-${c.endY.toFixed(0)})`
  ));

  return chunks;
}

/**
 * Check if chunking is recommended for this tree
 */
export function shouldChunkTree(root: ElementNode, threshold: number = 5000): boolean {
  const totalNodes = countNodes(root);
  return totalNodes > threshold;
}
