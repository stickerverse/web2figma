/**
 * FINAL INTERMEDIATE REPRESENTATION (IR) - ALL PHASES
 * 
 * Complete type definitions for web-to-Figma data exchange
 */

export interface IRNode {
  id: string;
  type: 'TEXT' | 'IMAGE' | 'FRAME' | 'SVG' | 'CANVAS' | 'VIDEO';
  tag: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  styles: IRStyles;
  text?: string;
  image?: IRImage;
  imageSource?: ImageSource;
  /**
   * Inline binary image payload for hybrid delivery. When present, this takes
   * precedence over base64 strings in {@link IRImage.data}.
   */
  imageData?: number[];
  /**
   * Reference metadata for streamed image delivery.
   */
  imageChunkRef?: ImageChunkReference;
  /**
   * Processing metadata describing conversion, resize and error details.
   */
  imageProcessing?: ImageProcessingMetadata;
  svg?: IRSVG;
  screenshot?: string; // base64 PNG
  pseudoElements?: IRPseudoElement[];
  states?: IRStates;
  children: string[];
  parent?: string;
  componentHint?: string;
  selector?: string;
  tokenRefs?: {
    color?: string;
    backgroundColor?: string;
    spacing?: string;
    radius?: string;
  };
  needsScreenshot?: boolean;
}

export interface IRStyles {
  // Typography (Phase 1-2)
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  fontStyle?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  textAlignVertical?: string;
  textTransform?: string;
  textDecoration?: string;
  textShadow?: string;
  
  // Background (Phase 1)
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  backgroundClip?: string;
  backgroundOrigin?: string;
  
  // Layout (Phase 1)
  display?: string;
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;
  
  // Flexbox (Phase 1)
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  alignContent?: string;
  flexWrap?: string;
  flexGrow?: string;
  flexShrink?: string;
  flexBasis?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  
  // Grid (Phase 1)
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: string;
  gridGap?: string;
  
  // Box model (Phase 1)
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  
  // Border (Phase 1)
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRadius?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomRightRadius?: string;
  borderBottomLeftRadius?: string;
  borderColor?: string;
  borderWidth?: string;
  borderStyle?: string;
  
  // Effects (Phase 5)
  boxShadow?: string;
  opacity?: string;
  filter?: string;
  backdropFilter?: string;
  transform?: string;
  transformOrigin?: string;
  
  // Clipping & Masking (Phase 5)
  clipPath?: string;
  maskImage?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
  
  // Visual (Phase 1)
  visibility?: string;
  cursor?: string;
  pointerEvents?: string;
  mixBlendMode?: string;
  isolation?: string;
  
  // Animation (Phase 6)
  transition?: string;
  animation?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
  animationDuration?: string;
  animationTimingFunction?: string;
}

export interface IRImage {
  url: string;
  alt?: string;
  data?: string; // base64 data (legacy inline support)
  naturalWidth?: number;
  naturalHeight?: number;
  needsProxy?: boolean; // Flag for CORS images
  sourceType?: 'img' | 'background' | 'svg';
  format?: 'png' | 'jpeg' | 'webp' | 'gif' | 'svg';
}

export interface ImageSource {
  originalUrl: string;
  resolvedUrl: string;
  sourceType: 'img' | 'background' | 'svg';
  naturalWidth?: number;
  naturalHeight?: number;
  format?: 'png' | 'jpeg' | 'webp' | 'gif' | 'svg';
}

export interface ImageChunkReference {
  totalSize: number;
  totalChunks: number;
  chunkSize: number;
  isStreamed: true;
}

export interface ImageProcessingMetadata {
  originalFormat: string;
  convertedFormat?: string;
  wasConverted: boolean;
  processingError?: string;
}

export interface ImageChunkMessage {
  type: 'IMAGE_CHUNK';
  nodeId: string;
  chunkIndex: number;
  totalChunks: number;
  data: number[];
  sequenceNumber: number;
  timestamp: number;
}

export interface StreamMessage {
  type: 'NODES' | 'IMAGE_CHUNK' | 'FONTS' | 'TOKENS' | 'COMPLETE' | 'ERROR' | 'PROGRESS';
  payload?: any;
  sequenceNumber: number;
}

export interface NodeBatchMessage {
  type: 'NODES';
  nodes: IRNode[];
  sequenceNumber: number;
}

export interface CompleteMessage {
  type: 'COMPLETE';
  totalNodes: number;
  totalImages: number;
  inlineImages: number;
  streamedImages: number;
  sequenceNumber: number;
}

export interface IRSVG {
  content: string; // Full SVG markup
  viewBox?: string;
  width?: string;
  height?: string;
}

export interface IRPseudoElement {
  type: 'before' | 'after';
  content: string;
  styles: IRStyles;
}

export interface IRStates {
  hover?: string; // base64 screenshot
  focus?: string; // base64 screenshot
  active?: string; // base64 screenshot
  disabled?: string; // base64 screenshot
}

export interface TokenSystem {
  explicit: Record<string, any>; // CSS custom properties (--var-name)
  implicit: Record<string, string>; // Auto-detected repeated values
  inferred: {
    spacing?: number[];
    colors?: string[];
    radii?: number[];
    fontSizes?: number[];
    fontWeights?: string[];
  };
}

export interface ExtractedFont {
  family: string;
  style: string;
  weight: string;
  src: string;
  data?: string; // base64 font file
  format?: string; // woff2, woff, ttf, etc.
}

export interface ExtractedData {
  nodes: IRNode[];
  tokens: TokenSystem;
  fonts: ExtractedFont[];
  screenshots: Record<string, string>; // nodeId → base64 PNG
  states: Record<string, IRStates>; // nodeId → states
  assets: Asset[];
  viewport: {
    width: number;
    height: number;
  };
}

export interface Asset {
  type: 'image' | 'font' | 'video' | 'svg';
  url: string;
  data?: string; // base64 or URL
  metadata?: any;
}

export interface ExtractionOptions {
  captureFonts?: boolean;
  captureScreenshots?: boolean;
  screenshotComplexOnly?: boolean;
  captureStates?: boolean;
  capturePseudoElements?: boolean;
  extractSVG?: boolean;
  viewport?: { width: number; height: number };
}

// Type guards
export function isTextNode(node: IRNode): boolean {
  return node.type === 'TEXT' && !!node.text;
}

export function isImageNode(node: IRNode): boolean {
  return node.type === 'IMAGE' && !!node.image;
}

export function isSVGNode(node: IRNode): boolean {
  return node.type === 'SVG' && !!node.svg;
}

export function isFrameNode(node: IRNode): boolean {
  return node.type === 'FRAME' && node.children.length > 0;
}

export function hasScreenshot(node: IRNode): boolean {
  return !!node.screenshot;
}

export function hasStates(node: IRNode): boolean {
  return !!node.states && Object.keys(node.states).length > 0;
}

export function hasPseudoElements(node: IRNode): boolean {
  return !!node.pseudoElements && node.pseudoElements.length > 0;
}
