/**
 * FINAL WEB-TO-FIGMA SCRAPER - ALL PHASES (1-6)
 *
 * Features:
 * - Phase 1: Extended CSS extraction, auto-scroll, image proxy support
 * - Phase 2: Font extraction and downloading
 * - Phase 3: Element screenshots and hybrid rendering
 * - Phase 4: SVG extraction and processing
 * - Phase 5: Advanced effect parsing (gradients, shadows, filters, transforms)
 * - Phase 6: Pseudo-elements, state capture, optimization
 *
 * Target Accuracy: 95-100%
 */
export interface ExtractedFont {
    family: string;
    style: string;
    weight: string;
    src: string;
    data?: string;
    format?: string;
}
export interface ExtractedPseudoElement {
    type: 'before' | 'after';
    content: string;
    styles: Record<string, any>;
}
export interface ExtractionOptions {
    captureFonts?: boolean;
    captureScreenshots?: boolean;
    screenshotComplexOnly?: boolean;
    captureStates?: boolean;
    capturePseudoElements?: boolean;
    extractSVG?: boolean;
    viewport?: {
        width: number;
        height: number;
    };
}
/**
 * Main extraction function with all features
 */
export declare function extractComplete(url: string, options?: ExtractionOptions): Promise<{
    fonts: ExtractedFont[];
    screenshots: Record<string, string>;
    states: Record<string, any>;
    assets: never[];
    nodes: any[];
    tokens: {
        explicit: Record<string, any>;
        implicit: Record<string, string>;
        inferred: {
            spacing: number[];
            radii: number[];
            colors: string[];
            fontSizes: number[];
            fontWeights: string[];
        };
    };
    viewport: {
        width: number;
        height: number;
    };
}>;
export declare function extractBasic(url: string): Promise<{
    fonts: ExtractedFont[];
    screenshots: Record<string, string>;
    states: Record<string, any>;
    assets: never[];
    nodes: any[];
    tokens: {
        explicit: Record<string, any>;
        implicit: Record<string, string>;
        inferred: {
            spacing: number[];
            radii: number[];
            colors: string[];
            fontSizes: number[];
            fontWeights: string[];
        };
    };
    viewport: {
        width: number;
        height: number;
    };
}>;
export declare function extractHybrid(url: string): Promise<{
    fonts: ExtractedFont[];
    screenshots: Record<string, string>;
    states: Record<string, any>;
    assets: never[];
    nodes: any[];
    tokens: {
        explicit: Record<string, any>;
        implicit: Record<string, string>;
        inferred: {
            spacing: number[];
            radii: number[];
            colors: string[];
            fontSizes: number[];
            fontWeights: string[];
        };
    };
    viewport: {
        width: number;
        height: number;
    };
}>;
export declare function extractMaximum(url: string): Promise<{
    fonts: ExtractedFont[];
    screenshots: Record<string, string>;
    states: Record<string, any>;
    assets: never[];
    nodes: any[];
    tokens: {
        explicit: Record<string, any>;
        implicit: Record<string, string>;
        inferred: {
            spacing: number[];
            radii: number[];
            colors: string[];
            fontSizes: number[];
            fontWeights: string[];
        };
    };
    viewport: {
        width: number;
        height: number;
    };
}>;
export declare function extractWithTokens(url: string): Promise<{
    fonts: ExtractedFont[];
    screenshots: Record<string, string>;
    states: Record<string, any>;
    assets: never[];
    nodes: any[];
    tokens: {
        explicit: Record<string, any>;
        implicit: Record<string, string>;
        inferred: {
            spacing: number[];
            radii: number[];
            colors: string[];
            fontSizes: number[];
            fontWeights: string[];
        };
    };
    viewport: {
        width: number;
        height: number;
    };
}>;
export declare function extractWithFontsAndScreenshots(url: string, options?: any): Promise<{
    fonts: ExtractedFont[];
    screenshots: Record<string, string>;
    states: Record<string, any>;
    assets: never[];
    nodes: any[];
    tokens: {
        explicit: Record<string, any>;
        implicit: Record<string, string>;
        inferred: {
            spacing: number[];
            radii: number[];
            colors: string[];
            fontSizes: number[];
            fontWeights: string[];
        };
    };
    viewport: {
        width: number;
        height: number;
    };
}>;
//# sourceMappingURL=scraper.d.ts.map