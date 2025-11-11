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

import { chromium, Browser, Page } from 'playwright';
import fetch from 'node-fetch';

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
  viewport?: { width: number; height: number };
}

/**
 * Main extraction function with all features
 */
export async function extractComplete(url: string, options: ExtractionOptions = {}) {
  const {
    captureFonts = true,
    captureScreenshots = true,
    screenshotComplexOnly = true,
    captureStates = false,
    capturePseudoElements = true,
    extractSVG = true,
    viewport = { width: 1440, height: 900 }
  } = options;

  console.log('Starting extraction with options:', options);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security'
    ]
  });
  
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  // Navigate and wait for full load
  await page.goto(url, { 
    waitUntil: 'networkidle',
    timeout: 30000 
  });
  
  // Scroll to load lazy content
  await autoScroll(page);
  
  // Extract fonts
  let fonts: ExtractedFont[] = [];
  if (captureFonts) {
    console.log('Extracting fonts...');
    fonts = await extractFonts(page, url);
    console.log(`Extracted ${fonts.length} fonts`);
  }
  
  // Extract DOM data
  console.log('Extracting DOM data...');
  const data = await page.evaluate((opts) => {
    const generateId = () => Math.random().toString(36).substr(2, 9);
    
    /**
     * PHASE 1: Comprehensive CSS extraction (60+ properties)
     */
    const extractAllStyles = (styles: CSSStyleDeclaration) => {
      return {
        // Typography
        color: styles.color !== 'rgb(0, 0, 0)' ? styles.color : undefined,
        fontSize: styles.fontSize !== '16px' ? styles.fontSize : undefined,
        fontWeight: styles.fontWeight !== '400' ? styles.fontWeight : undefined,
        fontFamily: styles.fontFamily,
        fontStyle: styles.fontStyle !== 'normal' ? styles.fontStyle : undefined,
        lineHeight: styles.lineHeight !== 'normal' ? styles.lineHeight : undefined,
        letterSpacing: styles.letterSpacing !== 'normal' ? styles.letterSpacing : undefined,
        textAlign: styles.textAlign !== 'start' ? styles.textAlign : undefined,
        textTransform: styles.textTransform !== 'none' ? styles.textTransform : undefined,
        textDecoration: styles.textDecoration !== 'none' ? styles.textDecoration : undefined,
        textShadow: styles.textShadow !== 'none' ? styles.textShadow : undefined,
        
        // Background
        backgroundColor: styles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? styles.backgroundColor : undefined,
        backgroundImage: styles.backgroundImage !== 'none' ? styles.backgroundImage : undefined,
        backgroundSize: styles.backgroundSize !== 'auto' ? styles.backgroundSize : undefined,
        backgroundPosition: styles.backgroundPosition !== '0% 0%' ? styles.backgroundPosition : undefined,
        backgroundRepeat: styles.backgroundRepeat !== 'repeat' ? styles.backgroundRepeat : undefined,
        backgroundClip: styles.backgroundClip !== 'border-box' ? styles.backgroundClip : undefined,
        backgroundOrigin: styles.backgroundOrigin !== 'padding-box' ? styles.backgroundOrigin : undefined,
        
        // Layout
        display: styles.display,
        position: styles.position !== 'static' ? styles.position : undefined,
        top: styles.top !== 'auto' ? styles.top : undefined,
        right: styles.right !== 'auto' ? styles.right : undefined,
        bottom: styles.bottom !== 'auto' ? styles.bottom : undefined,
        left: styles.left !== 'auto' ? styles.left : undefined,
        zIndex: styles.zIndex !== 'auto' ? styles.zIndex : undefined,
        
        // Flexbox
        flexDirection: styles.flexDirection !== 'row' ? styles.flexDirection : undefined,
        justifyContent: styles.justifyContent !== 'normal' ? styles.justifyContent : undefined,
        alignItems: styles.alignItems !== 'normal' ? styles.alignItems : undefined,
        alignContent: styles.alignContent !== 'normal' ? styles.alignContent : undefined,
        flexWrap: styles.flexWrap !== 'nowrap' ? styles.flexWrap : undefined,
        flexGrow: styles.flexGrow !== '0' ? styles.flexGrow : undefined,
        flexShrink: styles.flexShrink !== '1' ? styles.flexShrink : undefined,
        gap: styles.gap !== 'normal' ? styles.gap : undefined,
        rowGap: styles.rowGap !== 'normal' ? styles.rowGap : undefined,
        columnGap: styles.columnGap !== 'normal' ? styles.columnGap : undefined,
        
        // Grid
        gridTemplateColumns: styles.gridTemplateColumns !== 'none' ? styles.gridTemplateColumns : undefined,
        gridTemplateRows: styles.gridTemplateRows !== 'none' ? styles.gridTemplateRows : undefined,
        gridAutoFlow: styles.gridAutoFlow !== 'row' ? styles.gridAutoFlow : undefined,
        
        // Box model
        width: styles.width !== 'auto' ? styles.width : undefined,
        height: styles.height !== 'auto' ? styles.height : undefined,
        minWidth: styles.minWidth !== '0px' ? styles.minWidth : undefined,
        minHeight: styles.minHeight !== '0px' ? styles.minHeight : undefined,
        maxWidth: styles.maxWidth !== 'none' ? styles.maxWidth : undefined,
        maxHeight: styles.maxHeight !== 'none' ? styles.maxHeight : undefined,
        padding: styles.padding !== '0px' ? styles.padding : undefined,
        paddingTop: styles.paddingTop !== '0px' ? styles.paddingTop : undefined,
        paddingRight: styles.paddingRight !== '0px' ? styles.paddingRight : undefined,
        paddingBottom: styles.paddingBottom !== '0px' ? styles.paddingBottom : undefined,
        paddingLeft: styles.paddingLeft !== '0px' ? styles.paddingLeft : undefined,
        margin: styles.margin !== '0px' ? styles.margin : undefined,
        marginTop: styles.marginTop !== '0px' ? styles.marginTop : undefined,
        marginRight: styles.marginRight !== '0px' ? styles.marginRight : undefined,
        marginBottom: styles.marginBottom !== '0px' ? styles.marginBottom : undefined,
        marginLeft: styles.marginLeft !== '0px' ? styles.marginLeft : undefined,
        
        // Border
        border: styles.border !== '' ? styles.border : undefined,
        borderTop: styles.borderTop !== styles.border ? styles.borderTop : undefined,
        borderRight: styles.borderRight !== styles.border ? styles.borderRight : undefined,
        borderBottom: styles.borderBottom !== styles.border ? styles.borderBottom : undefined,
        borderLeft: styles.borderLeft !== styles.border ? styles.borderLeft : undefined,
        borderRadius: styles.borderRadius !== '0px' ? styles.borderRadius : undefined,
        borderTopLeftRadius: styles.borderTopLeftRadius !== '0px' ? styles.borderTopLeftRadius : undefined,
        borderTopRightRadius: styles.borderTopRightRadius !== '0px' ? styles.borderTopRightRadius : undefined,
        borderBottomRightRadius: styles.borderBottomRightRadius !== '0px' ? styles.borderBottomRightRadius : undefined,
        borderBottomLeftRadius: styles.borderBottomLeftRadius !== '0px' ? styles.borderBottomLeftRadius : undefined,
        borderColor: styles.borderColor,
        borderWidth: styles.borderWidth,
        borderStyle: styles.borderStyle,
        
        // Effects (Phase 5)
        boxShadow: styles.boxShadow !== 'none' ? styles.boxShadow : undefined,
        opacity: styles.opacity !== '1' ? styles.opacity : undefined,
        filter: styles.filter !== 'none' ? styles.filter : undefined,
        backdropFilter: styles.backdropFilter !== 'none' ? styles.backdropFilter : undefined,
        transform: styles.transform !== 'none' ? styles.transform : undefined,
        transformOrigin: styles.transformOrigin !== '50% 50%' ? styles.transformOrigin : undefined,
        
        // Clipping & Masking
        clipPath: styles.clipPath !== 'none' ? styles.clipPath : undefined,
        maskImage: styles.maskImage !== 'none' ? styles.maskImage : undefined,
        overflow: styles.overflow !== 'visible' ? styles.overflow : undefined,
        overflowX: styles.overflowX !== 'visible' ? styles.overflowX : undefined,
        overflowY: styles.overflowY !== 'visible' ? styles.overflowY : undefined,
        
        // Visual
        visibility: styles.visibility !== 'visible' ? styles.visibility : undefined,
        cursor: styles.cursor !== 'auto' ? styles.cursor : undefined,
        pointerEvents: styles.pointerEvents !== 'auto' ? styles.pointerEvents : undefined,
        mixBlendMode: styles.mixBlendMode !== 'normal' ? styles.mixBlendMode : undefined,
        isolation: styles.isolation !== 'auto' ? styles.isolation : undefined,
        
        // Transitions & Animations
        transition: styles.transition !== 'all 0s ease 0s' ? styles.transition : undefined,
        animation: styles.animation !== 'none' ? styles.animation : undefined
      };
    };
    
    /**
     * PHASE 6: Extract pseudo-elements
     */
    const extractPseudoElements = (el: Element) => {
      const pseudos: any[] = [];
      
      try {
        const before = window.getComputedStyle(el, ':before');
        const after = window.getComputedStyle(el, ':after');
        
        if (before.content && before.content !== 'none' && before.content !== '""') {
          pseudos.push({
            type: 'before',
            content: before.content.replace(/^["']|["']$/g, ''),
            styles: extractAllStyles(before)
          });
        }
        
        if (after.content && after.content !== 'none' && after.content !== '""') {
          pseudos.push({
            type: 'after',
            content: after.content.replace(/^["']|["']$/g, ''),
            styles: extractAllStyles(after)
          });
        }
      } catch (e) {
        // Pseudo-element access failed
      }
      
      return pseudos;
    };
    
    const getCSSVariables = () => {
      const vars: Record<string, any> = {};
      const root = getComputedStyle(document.documentElement);
      for (let i = 0; i < root.length; i++) {
        const prop = root[i];
        if (prop.startsWith('--')) {
          vars[prop] = root.getPropertyValue(prop);
        }
      }
      return vars;
    };
    
    const detectComponentPattern = (el: Element, styles: CSSStyleDeclaration) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role');
      const classList = Array.from(el.classList).join(' ');
      
      if (tag === 'button' || role === 'button' || classList.includes('btn')) return 'button';
      if (classList.includes('card') || (styles.boxShadow !== 'none' && styles.borderRadius !== '0px')) return 'card';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
      if (tag === 'nav' || role === 'navigation') return 'navigation';
      if (tag === 'header' || role === 'banner') return 'header';
      if (tag === 'footer' || role === 'contentinfo') return 'footer';
      if (tag === 'aside' || role === 'complementary') return 'sidebar';
      if (tag === 'article' || role === 'article') return 'article';
      if (tag === 'section') return 'section';
      return null;
    };
    
    /**
     * PHASE 3: Check if element needs screenshot
     */
    const needsScreenshot = (styles: CSSStyleDeclaration, el: Element) => {
      return !!(
        (styles.backgroundImage && styles.backgroundImage.includes('gradient')) ||
        styles.filter !== 'none' ||
        styles.backdropFilter !== 'none' ||
        (styles.transform && (styles.transform.includes('rotate') || styles.transform.includes('skew'))) ||
        styles.clipPath !== 'none' ||
        styles.maskImage !== 'none' ||
        (styles.boxShadow !== 'none' && styles.boxShadow.split(',').length > 2) || // Multi-layer shadows
        el.tagName === 'CANVAS' ||
        el.tagName === 'VIDEO'
      );
    };
    
    /**
     * Generate unique CSS selector for element
     */
    const generateSelector = (element: Element): string => {
      if (element.id) return `#${element.id}`;
      
      const classes = Array.from(element.classList).filter(c => c && !c.includes(' '));
      if (classes.length > 0) {
        const selector = `.${classes[0]}`;
        // Check if unique
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
      
      // Build path
      const path: string[] = [];
      let current: Element | null = element;
      
      while (current && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child): child is Element => child.tagName === current!.tagName
          );
          const index = siblings.indexOf(current) + 1;
          path.unshift(`${tag}:nth-of-type(${index})`);
        } else {
          path.unshift(tag);
        }
        
        current = parent;
      }
      
      return path.join(' > ');
    };
    
    const nodes: any[] = [];
    const valueFrequency = new Map();
    const cssVars = getCSSVariables();
    
    const elements = document.querySelectorAll('*');
    const nodeMap = new Map();
    
    // First pass: Create nodes
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLElement;
      const rect = el.getBoundingClientRect();
      
      // Skip zero-size and invisible elements
      if (rect.width === 0 || rect.height === 0) continue;
      
      const styles = getComputedStyle(el);
      if (styles.display === 'none' || styles.visibility === 'hidden') continue;
      
      const nodeId = generateId();
      nodeMap.set(el, nodeId);
      
      const styleData = extractAllStyles(styles);
      
      // Track value frequency for token generation
      if (styleData.backgroundColor) {
        valueFrequency.set(styleData.backgroundColor, (valueFrequency.get(styleData.backgroundColor) || 0) + 1);
      }
      if (styleData.color) {
        valueFrequency.set(styleData.color, (valueFrequency.get(styleData.color) || 0) + 1);
      }
      
      const pattern = detectComponentPattern(el, styles);
      
      // Image handling
      let imageData = null;
      if (el.tagName === 'IMG') {
        const img = el as HTMLImageElement;
        imageData = {
          url: img.src,
          alt: img.alt,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          needsProxy: !img.src.startsWith('data:')
        };
      }
      
      // PHASE 4: SVG handling
      let svgData = null;
      if (el.tagName === 'SVG') {
        svgData = {
          content: el.outerHTML,
          viewBox: el.getAttribute('viewBox'),
          width: el.getAttribute('width'),
          height: el.getAttribute('height')
        };
      }
      
      // PHASE 6: Pseudo-elements
      const pseudoElements = opts.capturePseudoElements ? extractPseudoElements(el) : [];
      
      const node = {
        id: nodeId,
        type: el.tagName === 'IMG' ? 'IMAGE' : 
              el.tagName === 'SVG' ? 'SVG' :
              el.tagName === 'CANVAS' ? 'CANVAS' :
              el.tagName === 'VIDEO' ? 'VIDEO' :
              (el.children.length > 0 ? 'FRAME' : 'TEXT'),
        tag: el.tagName.toLowerCase(),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        styles: styleData,
        text: el.children.length === 0 ? el.textContent?.trim() : undefined,
        image: imageData,
        svg: svgData,
        pseudoElements: pseudoElements.length > 0 ? pseudoElements : undefined,
        parent: el.parentElement ? nodeMap.get(el.parentElement) : undefined,
        children: [],
        componentHint: pattern,
        selector: generateSelector(el),
        needsScreenshot: opts.screenshotComplexOnly ? needsScreenshot(styles, el) : true
      };
      
      nodes.push(node);
    }
    
    // Second pass: Build parent-child relationships
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const nodeId = nodeMap.get(el);
      if (!nodeId) continue;
      
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;
      
      const childNodes = Array.from(el.children)
        .map(child => nodeMap.get(child))
        .filter(id => id);
      
      node.children = childNodes;
    }
    
    // Generate tokens
    const generateImplicitTokens = (frequency: Map<string, number>) => {
      const tokens: Record<string, string> = {};
      let colorIndex = 0;
      let spaceIndex = 0;
      
      frequency.forEach((count, value) => {
        if (count >= 3) {
          if (value.includes('rgb') || value.startsWith('#')) {
            tokens[value] = `color-${++colorIndex}`;
          } else if (value.includes('px')) {
            tokens[value] = `space-${++spaceIndex}`;
          }
        }
      });
      
      return tokens;
    };
    
    const inferDesignSystem = (nodes: any[]) => {
      const spacings = new Set<number>();
      const radii = new Set<number>();
      const colors = new Set<string>();
      const fontSizes = new Set<number>();
      const fontWeights = new Set<string>();
      
      nodes.forEach(node => {
        if (node.styles.padding) {
          const values = node.styles.padding.match(/\d+/g);
          if (values) values.forEach((v: string) => spacings.add(parseInt(v)));
        }
        if (node.styles.gap) {
          const value = node.styles.gap.match(/\d+/);
          if (value) spacings.add(parseInt(value[0]));
        }
        if (node.styles.borderRadius) {
          const values = node.styles.borderRadius.match(/\d+/g);
          if (values) values.forEach((v: string) => radii.add(parseInt(v)));
        }
        if (node.styles.backgroundColor) colors.add(node.styles.backgroundColor);
        if (node.styles.color) colors.add(node.styles.color);
        if (node.styles.fontSize) {
          const size = parseFloat(node.styles.fontSize);
          if (!isNaN(size)) fontSizes.add(size);
        }
        if (node.styles.fontWeight) fontWeights.add(node.styles.fontWeight);
      });
      
      return {
        spacing: Array.from(spacings).sort((a, b) => a - b),
        radii: Array.from(radii).sort((a, b) => a - b),
        colors: Array.from(colors),
        fontSizes: Array.from(fontSizes).sort((a, b) => a - b),
        fontWeights: Array.from(fontWeights).sort()
      };
    };
    
    return {
      nodes,
      tokens: {
        explicit: cssVars,
        implicit: generateImplicitTokens(valueFrequency),
        inferred: inferDesignSystem(nodes)
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };
  }, { capturePseudoElements, screenshotComplexOnly });
  
  // PHASE 3: Capture element screenshots
  let screenshots: Record<string, string> = {};
  if (captureScreenshots) {
    console.log('Capturing element screenshots...');
    const nodesToScreenshot = screenshotComplexOnly 
      ? data.nodes.filter((n: any) => n.needsScreenshot)
      : data.nodes;
    
    screenshots = await captureElementScreenshots(page, nodesToScreenshot);
    console.log(`Captured ${Object.keys(screenshots).length} screenshots`);
  }
  
  // PHASE 6: Capture states (hover, focus, active)
  let states: Record<string, any> = {};
  if (captureStates) {
    console.log('Capturing interaction states...');
    states = await captureInteractionStates(page, data.nodes.filter((n: any) => 
      n.componentHint === 'button' || n.componentHint === 'input'
    ));
    console.log(`Captured states for ${Object.keys(states).length} elements`);
  }
  
  await browser.close();
  
  return {
    ...data,
    fonts,
    screenshots,
    states,
    assets: []
  };
}

/**
 * PHASE 2: Extract fonts from page
 */
async function extractFonts(page: Page, baseUrl: string): Promise<ExtractedFont[]> {
  const fonts = await page.evaluate(() => {
    const fontFaces: any[] = [];
    
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSFontFaceRule) {
              const style = rule.style;
              
              let family = style.getPropertyValue('font-family');
              family = family.replace(/['"]/g, '').trim();
              
              const src = style.getPropertyValue('src');
              const urlMatches = src.match(/url\(['"]?([^'"()]+)['"]?\)/g);
              
              if (urlMatches) {
                urlMatches.forEach(match => {
                  const urlMatch = match.match(/url\(['"]?([^'"()]+)['"]?\)/);
                  const formatMatch = match.match(/format\(['"]?([^'"()]+)['"]?\)/);
                  
                  if (urlMatch) {
                    fontFaces.push({
                      family,
                      style: style.getPropertyValue('font-style') || 'normal',
                      weight: style.getPropertyValue('font-weight') || '400',
                      src: urlMatch[1],
                      format: formatMatch ? formatMatch[1] : undefined
                    });
                  }
                });
              }
            }
          }
        } catch (e) {
          // CORS blocked
        }
      }
    } catch (e) {
      console.error('Font extraction error:', e);
    }
    
    return fontFaces;
  });
  
  // Download fonts
  const fontsWithData = await Promise.all(
    fonts.map(async (font) => {
      try {
        const fontUrl = new URL(font.src, baseUrl).href;
        const response = await fetch(fontUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        });
        
        if (response.ok) {
          const buffer = await response.buffer();
          const base64 = buffer.toString('base64');
          const mimeType = response.headers.get('content-type') || 'font/woff2';
          
          return {
            ...font,
            src: fontUrl,
            data: `data:${mimeType};base64,${base64}`
          };
        }
      } catch (e) {
        console.warn(`Failed to download font: ${font.src}`);
      }
      
      return font;
    })
  );
  
  return fontsWithData.filter(f => f.data);
}

/**
 * PHASE 3: Capture screenshots of specific elements
 */
async function captureElementScreenshots(
  page: Page, 
  nodes: any[]
): Promise<Record<string, string>> {
  const screenshots: Record<string, string> = {};
  const batchSize = 10;
  
  for (let i = 0; i < nodes.length; i += batchSize) {
    const batch = nodes.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (node) => {
        try {
          const element = await page.$(node.selector);
          if (element) {
            const screenshot = await element.screenshot({ 
              type: 'png',
              omitBackground: true
            });
            screenshots[node.id] = screenshot.toString('base64');
          }
        } catch (e) {
          // Screenshot failed, skip
        }
      })
    );
    
    if (i + batchSize < nodes.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return screenshots;
}

/**
 * PHASE 6: Capture interaction states
 */
async function captureInteractionStates(
  page: Page,
  nodes: any[]
): Promise<Record<string, any>> {
  const states: Record<string, any> = {};
  
  for (const node of nodes) {
    try {
      const element = await page.$(node.selector);
      if (!element) continue;
      
      const nodeStates: any = {};
      
      // Hover state
      try {
        await element.hover();
        await page.waitForTimeout(100);
        const hoverScreenshot = await element.screenshot({ type: 'png', omitBackground: true });
        nodeStates.hover = hoverScreenshot.toString('base64');
      } catch (e) {}
      
      // Focus state (for inputs/buttons)
      if (node.componentHint === 'button' || node.componentHint === 'input') {
        try {
          await element.focus();
          await page.waitForTimeout(100);
          const focusScreenshot = await element.screenshot({ type: 'png', omitBackground: true });
          nodeStates.focus = focusScreenshot.toString('base64');
        } catch (e) {}
      }
      
      // Active state (for buttons)
      if (node.componentHint === 'button') {
        try {
          await element.click({ delay: 50 });
          const activeScreenshot = await element.screenshot({ type: 'png', omitBackground: true });
          nodeStates.active = activeScreenshot.toString('base64');
        } catch (e) {}
      }
      
      if (Object.keys(nodeStates).length > 0) {
        states[node.id] = nodeStates;
      }
    } catch (e) {
      // Failed to capture states
    }
  }
  
  return states;
}

/**
 * Auto-scroll to load lazy content
 */
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          setTimeout(() => resolve(), 500);
        }
      }, 100);
    });
  });
}

// Preset extraction modes
export async function extractBasic(url: string) {
  return extractComplete(url, {
    captureFonts: false,
    captureScreenshots: false,
    captureStates: false,
    capturePseudoElements: false
  });
}

export async function extractHybrid(url: string) {
  return extractComplete(url, {
    captureFonts: true,
    captureScreenshots: true,
    screenshotComplexOnly: true,
    captureStates: false,
    capturePseudoElements: true
  });
}

export async function extractMaximum(url: string) {
  return extractComplete(url, {
    captureFonts: true,
    captureScreenshots: true,
    screenshotComplexOnly: false,
    captureStates: true,
    capturePseudoElements: true
  });
}

// Backward compatibility
export async function extractWithTokens(url: string) {
  return extractBasic(url);
}

export async function extractWithFontsAndScreenshots(url: string, options: any = {}) {
  return extractComplete(url, options);
}
