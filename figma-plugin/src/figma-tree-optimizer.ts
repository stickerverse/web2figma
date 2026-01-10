/**
 * Figma Tree Optimizer
 *
 * Applies semantic enhancements to actual Figma nodes:
 * - Sets layoutMode for auto-layout
 * - Creates components from patterns
 * - Applies visual hierarchy markers
 * - Groups by semantic role
 */

import {
  enhanceTreeStructure,
  detectAutoLayoutDirection,
  detectComponentPatterns,
  type SemanticEnhancementOptions,
  type ComponentPattern,
} from "./semantic-tree-enhancer";

export interface FigmaOptimizationOptions extends SemanticEnhancementOptions {
  createComponentVariants: boolean;
  useAutoLayoutPadding: boolean;
  addSectionDividers: boolean;
  colorCodeByRole: boolean;
}

// ============================================================================
// AUTO-LAYOUT APPLICATION
// ============================================================================

/**
 * Apply auto-layout to Figma frame based on detected direction
 */
export function applyAutoLayout(
  figmaNode: FrameNode,
  direction: "HORIZONTAL" | "VERTICAL" | "NONE"
): void {
  if (direction === "NONE" || figmaNode.children.length < 2) return;

  try {
    // Set layout mode
    figmaNode.layoutMode = direction;

    // Set sensible defaults
    if (direction === "HORIZONTAL") {
      figmaNode.primaryAxisSizingMode = "AUTO";
      figmaNode.counterAxisSizingMode = "AUTO";
      figmaNode.primaryAxisAlignItems = "MIN"; // Align left
      figmaNode.counterAxisAlignItems = "CENTER"; // Center vertically
      figmaNode.itemSpacing = 16; // Default 16px gap
    } else {
      figmaNode.primaryAxisSizingMode = "AUTO";
      figmaNode.counterAxisSizingMode = "AUTO";
      figmaNode.primaryAxisAlignItems = "MIN"; // Align top
      figmaNode.counterAxisAlignItems = "CENTER"; // Center horizontally
      figmaNode.itemSpacing = 16; // Default 16px gap
    }

    // Add padding
    figmaNode.paddingLeft = 0;
    figmaNode.paddingRight = 0;
    figmaNode.paddingTop = 0;
    figmaNode.paddingBottom = 0;

    console.log(
      `✅ [OPTIMIZER] Applied ${direction} auto-layout to: ${figmaNode.name}`
    );
  } catch (error) {
    console.warn(
      `⚠️ [OPTIMIZER] Failed to apply auto-layout to ${figmaNode.name}:`,
      error
    );
  }
}

/**
 * Intelligently detect and apply auto-layout spacing based on actual child positions
 */
export function detectAndApplySpacing(figmaNode: FrameNode): void {
  if (figmaNode.layoutMode === "NONE" || figmaNode.children.length < 2) return;

  const children = figmaNode.children as SceneNode[];
  const gaps: number[] = [];

  if (figmaNode.layoutMode === "HORIZONTAL") {
    for (let i = 1; i < children.length; i++) {
      const gap = children[i].x - (children[i - 1].x + children[i - 1].width);
      gaps.push(Math.max(0, gap));
    }
  } else {
    for (let i = 1; i < children.length; i++) {
      const gap = children[i].y - (children[i - 1].y + children[i - 1].height);
      gaps.push(Math.max(0, gap));
    }
  }

  if (gaps.length > 0) {
    // Use median gap to avoid outliers
    gaps.sort((a, b) => a - b);
    const medianGap = gaps[Math.floor(gaps.length / 2)];
    figmaNode.itemSpacing = Math.round(medianGap);
  }
}

// ============================================================================
// COMPONENT CREATION
// ============================================================================

/**
 * Create Figma component from pattern
 */
export function createComponentFromPattern(
  pattern: ComponentPattern,
  parentPage: PageNode
): ComponentNode | null {
  if (pattern.instances.length === 0) return null;

  try {
    const firstInstance = pattern.instances[0];

    // Clone first instance to create component
    const componentNode = figma.createComponent();
    componentNode.name = pattern.name;

    // Copy properties from first instance
    if (firstInstance.type === 'FRAME') {
      const frameInstance = firstInstance as FrameNode;
      componentNode.resize(frameInstance.width, frameInstance.height);
      componentNode.fills = frameInstance.fills;
      componentNode.strokes = frameInstance.strokes;
      componentNode.effects = frameInstance.effects;
      componentNode.cornerRadius = frameInstance.cornerRadius;

      // Copy children
      for (const child of frameInstance.children) {
        const clonedChild = child.clone();
        componentNode.appendChild(clonedChild);
      }
    }

    // Add to page in components section
    parentPage.appendChild(componentNode);
    componentNode.x = -1000; // Move off-canvas for now
    componentNode.y = pattern.instances.indexOf(firstInstance) * 200;

    console.log(
      `✅ [OPTIMIZER] Created component: ${pattern.name} (${pattern.instances.length} instances)`
    );

    return componentNode;
  } catch (error) {
    console.error(
      `❌ [OPTIMIZER] Failed to create component for ${pattern.name}:`,
      error
    );
    return null;
  }
}

/**
 * Replace instances with component instances
 */
export function replaceWithComponentInstances(
  component: ComponentNode,
  instances: SceneNode[]
): void {
  for (const node of instances) {
    try {
      if (!node.parent) continue;

      const instance = component.createInstance();
      instance.name = node.name;
      instance.x = node.x;
      instance.y = node.y;

      const parent = node.parent;
      const index = parent.children.indexOf(node);

      node.remove();
      parent.insertChild(index, instance);

      console.log(
        `✅ [OPTIMIZER] Replaced ${node.name} with component instance`
      );
    } catch (error) {
      console.warn(
        `⚠️ [OPTIMIZER] Failed to replace instance ${node.name}:`,
        error
      );
    }
  }
}

// ============================================================================
// ROLE-BASED GROUPING
// ============================================================================

const ROLE_COLORS: Record<string, RGB> = {
  HEADER: { r: 0.2, g: 0.4, b: 0.8 }, // Blue
  NAVIGATION: { r: 0.4, g: 0.2, b: 0.8 }, // Purple
  MAIN: { r: 0.2, g: 0.8, b: 0.4 }, // Green
  FOOTER: { r: 0.6, g: 0.4, b: 0.2 }, // Brown
  ASIDE: { r: 0.8, g: 0.6, b: 0.2 }, // Orange
  CARD: { r: 0.8, g: 0.2, b: 0.4 }, // Pink
  FORM: { r: 0.2, g: 0.8, b: 0.8 }, // Cyan
};

/**
 * Apply visual marker to frame based on semantic role
 */
export function applyRoleVisualMarker(
  figmaNode: FrameNode,
  role: string
): void {
  if (!role) return;

  // Add emoji prefix to name
  const emoji = getRoleEmoji(role);
  if (emoji && !figmaNode.name.startsWith(emoji)) {
    figmaNode.name = `${emoji} ${figmaNode.name}`;
  }

  // Optional: Add subtle background tint for role (very light)
  if (ROLE_COLORS[role]) {
    const color = ROLE_COLORS[role];
    figmaNode.fills = [
      {
        type: "SOLID",
        color: color,
        opacity: 0.05, // Very subtle tint
      },
    ];
  }

  // Add stroke color for role
  if (ROLE_COLORS[role]) {
    figmaNode.strokes = [
      {
        type: "SOLID",
        color: ROLE_COLORS[role],
      },
    ];
    figmaNode.strokeWeight = 2;
    figmaNode.dashPattern = [5, 5]; // Dashed line
  }
}

function getRoleEmoji(role: string): string {
  const emojiMap: Record<string, string> = {
    HEADER: "📋",
    NAVIGATION: "🧭",
    MAIN: "📄",
    FOOTER: "📍",
    ASIDE: "📌",
    BUTTON: "🔘",
    CARD: "🃏",
    FORM: "📝",
    LIST: "📑",
    MODAL: "💬",
    IMAGE: "🖼️",
    VIDEO: "🎬",
  };

  return emojiMap[role] || "";
}

// ============================================================================
// SECTION GROUPING
// ============================================================================

/**
 * Group top-level frames by semantic sections
 */
export function groupBySemanticSections(
  rootFrame: FrameNode,
  nodes: SceneNode[]
): void {
  const sections = new Map<string, FrameNode>();

  for (const node of nodes) {
    const metadata = (node as any).metadata;
    const role = metadata?.role || "CONTENT";

    // Get or create section frame
    if (!sections.has(role)) {
      const sectionFrame = figma.createFrame();
      sectionFrame.name = `${getRoleEmoji(role)} ${role}`;
      sectionFrame.layoutMode = "VERTICAL";
      sectionFrame.itemSpacing = 24;
      sectionFrame.paddingLeft = 0;
      sectionFrame.paddingRight = 0;
      sectionFrame.paddingTop = 0;
      sectionFrame.paddingBottom = 0;
      sections.set(role, sectionFrame);
      rootFrame.appendChild(sectionFrame);
    }

    // Move node to section
    const sectionFrame = sections.get(role)!;
    node.remove();
    sectionFrame.appendChild(node);
  }

  console.log(
    `✅ [OPTIMIZER] Grouped nodes into ${sections.size} semantic sections`
  );
}

// ============================================================================
// MAIN OPTIMIZATION PIPELINE
// ============================================================================

/**
 * Optimize entire Figma tree structure
 */
export async function optimizeFigmaTree(
  rootFrame: FrameNode,
  schemaRoot: any,
  options: FigmaOptimizationOptions
): Promise<void> {
  console.log("🚀 [OPTIMIZER] Starting Figma tree optimization...");

  // Step 1: Enhance schema tree with semantic metadata
  const enhancedSchema = enhanceTreeStructure(schemaRoot, options);

  // Step 2: Apply semantic naming to all Figma nodes
  applySemanticNamingToFigmaNodes(rootFrame, enhancedSchema);

  // Step 3: Apply auto-layout where detected
  if (options.enableAutoLayout) {
    applyAutoLayoutRecursively(rootFrame, enhancedSchema);
  }

  // Step 4: Detect and create components
  if (options.detectComponents) {
    await createComponentsFromPatterns(rootFrame, options);
  }

  // Step 5: Apply visual markers
  if (options.colorCodeByRole) {
    applyVisualMarkersRecursively(rootFrame, enhancedSchema);
  }

  // Step 6: Group by sections
  if (options.groupByRole && rootFrame.children.length > 0) {
    groupBySemanticSections(rootFrame, rootFrame.children as SceneNode[]);
  }

  console.log("✅ [OPTIMIZER] Figma tree optimization complete!");
}

function applySemanticNamingToFigmaNodes(
  figmaNode: SceneNode,
  schemaNode: any
): void {
  if (schemaNode.name && schemaNode.name !== figmaNode.name) {
    figmaNode.name = schemaNode.name;
  }

  if ("children" in figmaNode && schemaNode.children) {
    const figmaChildren = figmaNode.children as SceneNode[];
    for (let i = 0; i < Math.min(figmaChildren.length, schemaNode.children.length); i++) {
      applySemanticNamingToFigmaNodes(figmaChildren[i], schemaNode.children[i]);
    }
  }
}

function applyAutoLayoutRecursively(
  figmaNode: SceneNode,
  schemaNode: any
): void {
  if (
    "children" in figmaNode &&
    schemaNode.metadata?.layoutDirection &&
    schemaNode.metadata.layoutDirection !== "NONE"
  ) {
    applyAutoLayout(
      figmaNode as FrameNode,
      schemaNode.metadata.layoutDirection
    );
    detectAndApplySpacing(figmaNode as FrameNode);
  }

  if ("children" in figmaNode && schemaNode.children) {
    const figmaChildren = figmaNode.children as SceneNode[];
    for (let i = 0; i < Math.min(figmaChildren.length, schemaNode.children.length); i++) {
      applyAutoLayoutRecursively(figmaChildren[i], schemaNode.children[i]);
    }
  }
}

function applyVisualMarkersRecursively(
  figmaNode: SceneNode,
  schemaNode: any
): void {
  if (
    "children" in figmaNode &&
    schemaNode.metadata?.role
  ) {
    applyRoleVisualMarker(figmaNode as FrameNode, schemaNode.metadata.role);
  }

  if ("children" in figmaNode && schemaNode.children) {
    const figmaChildren = figmaNode.children as SceneNode[];
    for (let i = 0; i < Math.min(figmaChildren.length, schemaNode.children.length); i++) {
      applyVisualMarkersRecursively(figmaChildren[i], schemaNode.children[i]);
    }
  }
}

async function createComponentsFromPatterns(
  rootFrame: FrameNode,
  options: FigmaOptimizationOptions
): Promise<void> {
  const allFigmaNodes: SceneNode[] = [];
  collectAllFigmaNodes(rootFrame, allFigmaNodes);

  // Map Figma nodes to schema nodes (approximate)
  const patterns = detectComponentPatterns(
    allFigmaNodes.map((n) => ({ ...n, metadata: (n as any).metadata })),
    options.minComponentInstances
  );

  const componentsFrame = figma.createFrame();
  componentsFrame.name = "🔄 Components";
  componentsFrame.x = rootFrame.x + rootFrame.width + 100;
  componentsFrame.y = rootFrame.y;
  componentsFrame.layoutMode = "VERTICAL";
  componentsFrame.itemSpacing = 40;

  figma.currentPage.appendChild(componentsFrame);

  for (const pattern of patterns) {
    const component = createComponentFromPattern(pattern, figma.currentPage);
    if (component) {
      // Move component to components frame
      component.remove();
      componentsFrame.appendChild(component);

      // Replace instances (if enabled)
      if (options.createComponentVariants) {
        replaceWithComponentInstances(component, pattern.instances as SceneNode[]);
      }
    }
  }

  console.log(
    `✅ [OPTIMIZER] Created ${patterns.length} components in Components frame`
  );
}

function collectAllFigmaNodes(node: BaseNode, result: SceneNode[]): void {
  if ("children" in node) {
    for (const child of (node as FrameNode).children) {
      result.push(child);
      collectAllFigmaNodes(child, result);
    }
  }
}
