// shared/schema.ts

export type WebToFigmaSchema = {
    metadata: any;
    root: ElementNode;
    assets: {
        images: Record<string, ImageAsset>;
        svgs: Record<string, SVGAsset>;
        fonts?: any;
    };
    styles?: any;
    chunked?: boolean;
    [key: string]: any;
};

export type ElementNode = {
    id: string;
    type: string;
    children?: ElementNode[];
    fills?: any[];
    backgrounds?: any[];
    [key: string]: any;
};

export type ImageAsset = {
    data: string;
    mimeType: string;
    width: number;
    height: number;
    [key: string]: any;
};

export type SVGAsset = {
    content?: string;
    [key: string]: any;
};

export type OCRResult = any;
export type ColorPaletteResult = any;
export type MLComponentDetections = any;
export type ComponentRegistry = any;
export type DesignTokensRegistry = any;

export type ValidationIssue = {
    severity: ValidationIssueSeverity;
    code: ValidationIssueCode;
    message: string;
    [key: string]: any;
};

export type ValidationIssueSeverity = "FATAL" | "WARN" | "INFO" | "ERROR";

export type ValidationIssueCode = string;

export type NodeValidation = any;

export type FigmaNodeType = string;

export type DesignToken = any;
export type TokenCollection = any;
export type TokenAlias = any;
export type TokenUsage = any;
export type TokenType = any;
export type TokenScope = any;
export type TokenValue = any;
export type RGBA = { r: number; g: number; b: number; a: number };
export type FontDefinition = any;

// Diagnostic and Pipeline Types
export type PipelinePhase =
  | "CREATED"
  | "PARENTED"
  | "RESIZED"
  | "TRANSFORM_APPLIED"
  | "FILTERS_APPLIED"
  | "FILLS_APPLIED"
  | "STROKES_APPLIED"
  | "EFFECTS_APPLIED"
  | "CHILDREN_PROCESSED"
  | "COMPLETE";

export type RasterizationReason = string;
export type CaptureMethod = string;

export type RasterizationAttempt = {
  method: CaptureMethod;
  success: boolean;
  timestamp: number;
  error?: string;
  [key: string]: any;
};

export type RasterizationAudit = {
  nodeId: string;
  reason: RasterizationReason;
  cssFeatures: string[];
  attempts: RasterizationAttempt[];
  finalMethod: CaptureMethod | null;
  fallbackChain: CaptureMethod[];
  [key: string]: any;
};

export type NodePipelineStatus = {
  schemaNodeId: string;
  figmaNodeId: string | null;
  completedPhases: PipelinePhase[];
  failedAt?: PipelinePhase;
  earlyReturnDetected: boolean;
  completionTimestamp: number;
  errorMessages: string[];
  [key: string]: any;
};

export type SchemaMappingVerification = {
  schemaNodeId: string;
  figmaNodeId: string | null;
  schemaType: any;
  figmaType: string | null;
  expectedDimensions: { width: number; height: number };
  actualDimensions?: { width: number; height: number };
  transformApplied: boolean;
  fillsCount: { expected: number; actual: number };
  strokesCount: { expected: number; actual: number };
  effectsCount: { expected: number; actual: number };
  childrenCount: { expected: number; actual: number };
  dimensionMismatch: boolean;
  countMismatches: string[];
  [key: string]: any;
};

export type LayoutSolverDecision = {
  nodeId: string;
  cssLayoutMode: string;
  inferredLayoutMode: "HORIZONTAL" | "VERTICAL" | "NONE";
  autoLayoutApplied: boolean;
  autoLayoutProperties?: {
    mode?: string;
    spacing?: number;
    padding?: any;
    [key: string]: any;
  };
  fallbackReason?: string;
  [key: string]: any;
};

export type NodeDiagnostic = {
  nodeId: string;
  pipelineStatus: NodePipelineStatus;
  mappingVerification?: SchemaMappingVerification;
  rasterizationAudit?: RasterizationAudit;
  layoutDecision?: LayoutSolverDecision;
  warnings: string[];
  errors: string[];
  [key: string]: any;
};

export type ImportDiagnosticSummary = {
  totalNodes: number;
  successfulNodes: number;
  failedNodes: string[];
  whiteBlankFrames: string[];
  rasterizedNodes: number;
  autoLayoutNodes: number;
  transformedNodes: number;
  earlyReturns: string[];
  criticalFailures: number;
  [key: string]: any;
};

export type ImportDiagnosticExport = {
  importId: string;
  timestamp: string;
  schemaVersion: string;
  sourceUrl: string;
  summary: ImportDiagnosticSummary;
  nodeDetails: NodeDiagnostic[];
  performanceMetrics: {
    totalImportDurationMs: number;
    averageNodeBuildTimeMs: number;
    rasterizationTimeMs: number;
    layoutSolverTimeMs: number;
    [key: string]: any;
  };
  systemInfo: {
    figmaVersion: string;
    pluginVersion: string;
    platform: string;
    [key: string]: any;
  };
  [key: string]: any;
};
