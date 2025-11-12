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
import { chromium } from "playwright";
import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
/**
 * Main extraction function with all features
 */
export async function extractComplete(url, options = {}) {
    const { captureFonts = true, captureScreenshots = true, screenshotComplexOnly = true, captureStates = false, capturePseudoElements = true, extractSVG = true, viewport = { width: 1440, height: 900 }, } = options;
    console.log("Starting extraction with options:", options);
    const browser = await chromium.launch({
        headless: true,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
        ],
    });
    const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 2,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });
    const page = await context.newPage();
    // Navigate and wait for full load
    await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30000,
    });
    console.log("Waiting for page to be fully loaded...");
    const loadInfo = await waitForFullyLoaded(page);
    // Scroll to load lazy content
    await autoScroll(page);
    // Extract fonts
    let fonts = [];
    if (captureFonts) {
        console.log("Extracting fonts...");
        fonts = await extractFonts(page, url);
        console.log(`Extracted ${fonts.length} fonts`);
    }
    // Extract DOM data
    console.log("Extracting DOM data...");
    const data = await page.evaluate((opts) => {
        const generateId = () => Math.random().toString(36).substr(2, 9);
        /**
         * PHASE 1: Comprehensive CSS extraction (60+ properties)
         */
        const extractAllStyles = (styles) => {
            return {
                // Typography
                color: styles.color !== "rgb(0, 0, 0)" ? styles.color : undefined,
                fontSize: styles.fontSize !== "16px" ? styles.fontSize : undefined,
                fontWeight: styles.fontWeight !== "400" ? styles.fontWeight : undefined,
                fontFamily: styles.fontFamily,
                fontStyle: styles.fontStyle !== "normal" ? styles.fontStyle : undefined,
                lineHeight: styles.lineHeight !== "normal" ? styles.lineHeight : undefined,
                letterSpacing: styles.letterSpacing !== "normal"
                    ? styles.letterSpacing
                    : undefined,
                textAlign: styles.textAlign !== "start" ? styles.textAlign : undefined,
                textTransform: styles.textTransform !== "none" ? styles.textTransform : undefined,
                textDecoration: styles.textDecoration !== "none"
                    ? styles.textDecoration
                    : undefined,
                textShadow: styles.textShadow !== "none" ? styles.textShadow : undefined,
                // Background
                backgroundColor: styles.backgroundColor !== "rgba(0, 0, 0, 0)"
                    ? styles.backgroundColor
                    : undefined,
                backgroundImage: styles.backgroundImage !== "none"
                    ? styles.backgroundImage
                    : undefined,
                backgroundSize: styles.backgroundSize !== "auto"
                    ? styles.backgroundSize
                    : undefined,
                backgroundPosition: styles.backgroundPosition !== "0% 0%"
                    ? styles.backgroundPosition
                    : undefined,
                backgroundRepeat: styles.backgroundRepeat !== "repeat"
                    ? styles.backgroundRepeat
                    : undefined,
                backgroundClip: styles.backgroundClip !== "border-box"
                    ? styles.backgroundClip
                    : undefined,
                backgroundOrigin: styles.backgroundOrigin !== "padding-box"
                    ? styles.backgroundOrigin
                    : undefined,
                // Layout
                display: styles.display,
                position: styles.position !== "static" ? styles.position : undefined,
                top: styles.top !== "auto" ? styles.top : undefined,
                right: styles.right !== "auto" ? styles.right : undefined,
                bottom: styles.bottom !== "auto" ? styles.bottom : undefined,
                left: styles.left !== "auto" ? styles.left : undefined,
                zIndex: styles.zIndex !== "auto" ? styles.zIndex : undefined,
                // Flexbox
                flexDirection: styles.flexDirection !== "row" ? styles.flexDirection : undefined,
                justifyContent: styles.justifyContent !== "normal"
                    ? styles.justifyContent
                    : undefined,
                alignItems: styles.alignItems !== "normal" ? styles.alignItems : undefined,
                alignContent: styles.alignContent !== "normal" ? styles.alignContent : undefined,
                flexWrap: styles.flexWrap !== "nowrap" ? styles.flexWrap : undefined,
                flexGrow: styles.flexGrow !== "0" ? styles.flexGrow : undefined,
                flexShrink: styles.flexShrink !== "1" ? styles.flexShrink : undefined,
                gap: styles.gap !== "normal" ? styles.gap : undefined,
                rowGap: styles.rowGap !== "normal" ? styles.rowGap : undefined,
                columnGap: styles.columnGap !== "normal" ? styles.columnGap : undefined,
                // Grid
                gridTemplateColumns: styles.gridTemplateColumns !== "none"
                    ? styles.gridTemplateColumns
                    : undefined,
                gridTemplateRows: styles.gridTemplateRows !== "none"
                    ? styles.gridTemplateRows
                    : undefined,
                gridAutoFlow: styles.gridAutoFlow !== "row" ? styles.gridAutoFlow : undefined,
                // Box model
                width: styles.width !== "auto" ? styles.width : undefined,
                height: styles.height !== "auto" ? styles.height : undefined,
                minWidth: styles.minWidth !== "0px" ? styles.minWidth : undefined,
                minHeight: styles.minHeight !== "0px" ? styles.minHeight : undefined,
                maxWidth: styles.maxWidth !== "none" ? styles.maxWidth : undefined,
                maxHeight: styles.maxHeight !== "none" ? styles.maxHeight : undefined,
                padding: styles.padding !== "0px" ? styles.padding : undefined,
                paddingTop: styles.paddingTop !== "0px" ? styles.paddingTop : undefined,
                paddingRight: styles.paddingRight !== "0px" ? styles.paddingRight : undefined,
                paddingBottom: styles.paddingBottom !== "0px" ? styles.paddingBottom : undefined,
                paddingLeft: styles.paddingLeft !== "0px" ? styles.paddingLeft : undefined,
                margin: styles.margin !== "0px" ? styles.margin : undefined,
                marginTop: styles.marginTop !== "0px" ? styles.marginTop : undefined,
                marginRight: styles.marginRight !== "0px" ? styles.marginRight : undefined,
                marginBottom: styles.marginBottom !== "0px" ? styles.marginBottom : undefined,
                marginLeft: styles.marginLeft !== "0px" ? styles.marginLeft : undefined,
                // Border
                border: styles.border !== "" ? styles.border : undefined,
                borderTop: styles.borderTop !== styles.border ? styles.borderTop : undefined,
                borderRight: styles.borderRight !== styles.border
                    ? styles.borderRight
                    : undefined,
                borderBottom: styles.borderBottom !== styles.border
                    ? styles.borderBottom
                    : undefined,
                borderLeft: styles.borderLeft !== styles.border ? styles.borderLeft : undefined,
                borderRadius: styles.borderRadius !== "0px" ? styles.borderRadius : undefined,
                borderTopLeftRadius: styles.borderTopLeftRadius !== "0px"
                    ? styles.borderTopLeftRadius
                    : undefined,
                borderTopRightRadius: styles.borderTopRightRadius !== "0px"
                    ? styles.borderTopRightRadius
                    : undefined,
                borderBottomRightRadius: styles.borderBottomRightRadius !== "0px"
                    ? styles.borderBottomRightRadius
                    : undefined,
                borderBottomLeftRadius: styles.borderBottomLeftRadius !== "0px"
                    ? styles.borderBottomLeftRadius
                    : undefined,
                borderColor: styles.borderColor,
                borderWidth: styles.borderWidth,
                borderStyle: styles.borderStyle,
                // Effects (Phase 5)
                boxShadow: styles.boxShadow !== "none" ? styles.boxShadow : undefined,
                opacity: styles.opacity !== "1" ? styles.opacity : undefined,
                filter: styles.filter !== "none" ? styles.filter : undefined,
                backdropFilter: styles.backdropFilter !== "none"
                    ? styles.backdropFilter
                    : undefined,
                transform: styles.transform !== "none" ? styles.transform : undefined,
                transformOrigin: styles.transformOrigin !== "50% 50%"
                    ? styles.transformOrigin
                    : undefined,
                // Clipping & Masking
                clipPath: styles.clipPath !== "none" ? styles.clipPath : undefined,
                maskImage: styles.maskImage !== "none" ? styles.maskImage : undefined,
                overflow: styles.overflow !== "visible" ? styles.overflow : undefined,
                overflowX: styles.overflowX !== "visible" ? styles.overflowX : undefined,
                overflowY: styles.overflowY !== "visible" ? styles.overflowY : undefined,
                // Visual
                visibility: styles.visibility !== "visible" ? styles.visibility : undefined,
                cursor: styles.cursor !== "auto" ? styles.cursor : undefined,
                pointerEvents: styles.pointerEvents !== "auto" ? styles.pointerEvents : undefined,
                mixBlendMode: styles.mixBlendMode !== "normal" ? styles.mixBlendMode : undefined,
                isolation: styles.isolation !== "auto" ? styles.isolation : undefined,
                // Transitions & Animations
                transition: styles.transition !== "all 0s ease 0s"
                    ? styles.transition
                    : undefined,
                animation: styles.animation !== "none" ? styles.animation : undefined,
            };
        };
        /**
         * PHASE 6: Extract pseudo-elements
         */
        const extractPseudoElements = (el) => {
            const pseudos = [];
            try {
                const before = window.getComputedStyle(el, ":before");
                const after = window.getComputedStyle(el, ":after");
                if (before.content &&
                    before.content !== "none" &&
                    before.content !== '""') {
                    pseudos.push({
                        type: "before",
                        content: before.content.replace(/^["']|["']$/g, ""),
                        styles: extractAllStyles(before),
                    });
                }
                if (after.content &&
                    after.content !== "none" &&
                    after.content !== '""') {
                    pseudos.push({
                        type: "after",
                        content: after.content.replace(/^["']|["']$/g, ""),
                        styles: extractAllStyles(after),
                    });
                }
            }
            catch (e) {
                // Pseudo-element access failed
            }
            return pseudos;
        };
        const getCSSVariables = () => {
            const vars = {};
            const root = getComputedStyle(document.documentElement);
            for (let i = 0; i < root.length; i++) {
                const prop = root[i];
                if (prop.startsWith("--")) {
                    vars[prop] = root.getPropertyValue(prop);
                }
            }
            return vars;
        };
        const detectComponentPattern = (el, styles) => {
            const tag = el.tagName.toLowerCase();
            const role = el.getAttribute("role");
            const classList = Array.from(el.classList).join(" ");
            if (tag === "button" || role === "button" || classList.includes("btn"))
                return "button";
            if (classList.includes("card") ||
                (styles.boxShadow !== "none" && styles.borderRadius !== "0px"))
                return "card";
            if (tag === "input" || tag === "textarea" || tag === "select")
                return "input";
            if (tag === "nav" || role === "navigation")
                return "navigation";
            if (tag === "header" || role === "banner")
                return "header";
            if (tag === "footer" || role === "contentinfo")
                return "footer";
            if (tag === "aside" || role === "complementary")
                return "sidebar";
            if (tag === "article" || role === "article")
                return "article";
            if (tag === "section")
                return "section";
            return null;
        };
        /**
         * PHASE 3: Check if element needs screenshot
         */
        const needsScreenshot = (styles, el) => {
            return !!((styles.backgroundImage &&
                styles.backgroundImage.includes("gradient")) ||
                styles.filter !== "none" ||
                styles.backdropFilter !== "none" ||
                (styles.transform &&
                    (styles.transform.includes("rotate") ||
                        styles.transform.includes("skew"))) ||
                styles.clipPath !== "none" ||
                styles.maskImage !== "none" ||
                (styles.boxShadow !== "none" &&
                    styles.boxShadow.split(",").length > 2) || // Multi-layer shadows
                el.tagName === "CANVAS" ||
                el.tagName === "VIDEO");
        };
        /**
         * Generate unique CSS selector for element
         */
        const generateSelector = (element) => {
            if (element.id)
                return `#${element.id}`;
            const classes = Array.from(element.classList).filter((c) => c && !c.includes(" "));
            if (classes.length > 0) {
                const selector = `.${classes[0]}`;
                // Check if unique
                if (document.querySelectorAll(selector).length === 1) {
                    return selector;
                }
            }
            // Build path
            const path = [];
            let current = element;
            while (current && current !== document.body) {
                const tag = current.tagName.toLowerCase();
                const parent = current.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
                    const index = siblings.indexOf(current) + 1;
                    path.unshift(`${tag}:nth-of-type(${index})`);
                }
                else {
                    path.unshift(tag);
                }
                current = parent;
            }
            return path.join(" > ");
        };
        const nodes = [];
        const valueFrequency = new Map();
        const cssVars = getCSSVariables();
        const elements = document.querySelectorAll("*");
        const nodeMap = new Map();
        // First pass: Create nodes
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const rect = el.getBoundingClientRect();
            // Skip zero-size and invisible elements
            if (rect.width === 0 || rect.height === 0)
                continue;
            const styles = getComputedStyle(el);
            if (styles.display === "none" || styles.visibility === "hidden")
                continue;
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
            if (el.tagName === "IMG") {
                const img = el;
                imageData = {
                    url: img.src,
                    alt: img.alt,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight,
                    needsProxy: !img.src.startsWith("data:"),
                };
            }
            // PHASE 4: SVG handling
            let svgData = null;
            if (el.tagName === "SVG") {
                svgData = {
                    content: el.outerHTML,
                    viewBox: el.getAttribute("viewBox"),
                    width: el.getAttribute("width"),
                    height: el.getAttribute("height"),
                };
            }
            // PHASE 6: Pseudo-elements
            const pseudoElements = opts.capturePseudoElements
                ? extractPseudoElements(el)
                : [];
            // Extract data attributes
            const dataAttributes = {};
            for (let j = 0; j < el.attributes.length; j++) {
                const attr = el.attributes[j];
                if (attr.name.startsWith("data-")) {
                    dataAttributes[attr.name] = attr.value;
                }
            }
            // Calculate parent-relative coordinates
            const parentEl = el.parentElement;
            const parentRect = parentEl ? parentEl.getBoundingClientRect() : null;
            const node = {
                id: nodeId,
                type: el.tagName === "IMG"
                    ? "IMAGE"
                    : el.tagName === "SVG"
                        ? "SVG"
                        : el.tagName === "CANVAS"
                            ? "CANVAS"
                            : el.tagName === "VIDEO"
                                ? "VIDEO"
                                : el.children.length > 0
                                    ? "FRAME"
                                    : "TEXT",
                tag: el.tagName.toLowerCase(),
                rect: {
                    // ✅ Absolute (viewport-relative) coordinates
                    // Figma handles parent-relative positioning automatically via appendChild
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
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
                needsScreenshot: opts.screenshotComplexOnly
                    ? needsScreenshot(styles, el)
                    : true,
                // Naming engine context data
                domId: el.id || undefined,
                classList: el.classList.length > 0 ? Array.from(el.classList) : undefined,
                role: el.getAttribute("role") || undefined,
                ariaLabel: el.getAttribute("aria-label") || undefined,
                dataAttributes: Object.keys(dataAttributes).length > 0 ? dataAttributes : undefined,
            };
            nodes.push(node);
        }
        // Second pass: Build parent-child relationships
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const nodeId = nodeMap.get(el);
            if (!nodeId)
                continue;
            const node = nodes.find((n) => n.id === nodeId);
            if (!node)
                continue;
            const childNodes = Array.from(el.children)
                .map((child) => nodeMap.get(child))
                .filter((id) => id);
            node.children = childNodes;
        }
        // Generate tokens
        const generateImplicitTokens = (frequency) => {
            const tokens = {};
            let colorIndex = 0;
            let spaceIndex = 0;
            frequency.forEach((count, value) => {
                if (count >= 3) {
                    if (value.includes("rgb") || value.startsWith("#")) {
                        tokens[value] = `color-${++colorIndex}`;
                    }
                    else if (value.includes("px")) {
                        tokens[value] = `space-${++spaceIndex}`;
                    }
                }
            });
            return tokens;
        };
        const inferDesignSystem = (nodes) => {
            const spacings = new Set();
            const radii = new Set();
            const colors = new Set();
            const fontSizes = new Set();
            const fontWeights = new Set();
            nodes.forEach((node) => {
                if (node.styles.padding) {
                    const values = node.styles.padding.match(/\d+/g);
                    if (values)
                        values.forEach((v) => spacings.add(parseInt(v)));
                }
                if (node.styles.gap) {
                    const value = node.styles.gap.match(/\d+/);
                    if (value)
                        spacings.add(parseInt(value[0]));
                }
                if (node.styles.borderRadius) {
                    const values = node.styles.borderRadius.match(/\d+/g);
                    if (values)
                        values.forEach((v) => radii.add(parseInt(v)));
                }
                if (node.styles.backgroundColor)
                    colors.add(node.styles.backgroundColor);
                if (node.styles.color)
                    colors.add(node.styles.color);
                if (node.styles.fontSize) {
                    const size = parseFloat(node.styles.fontSize);
                    if (!isNaN(size))
                        fontSizes.add(size);
                }
                if (node.styles.fontWeight)
                    fontWeights.add(node.styles.fontWeight);
            });
            return {
                spacing: Array.from(spacings).sort((a, b) => a - b),
                radii: Array.from(radii).sort((a, b) => a - b),
                colors: Array.from(colors),
                fontSizes: Array.from(fontSizes).sort((a, b) => a - b),
                fontWeights: Array.from(fontWeights).sort(),
            };
        };
        return {
            nodes,
            tokens: {
                explicit: cssVars,
                implicit: generateImplicitTokens(valueFrequency),
                inferred: inferDesignSystem(nodes),
            },
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
            },
        };
    }, { capturePseudoElements, screenshotComplexOnly });
    // ✅✅✅ CORRECT PLACEMENT: Export AFTER page.evaluate() completes ✅✅✅
    try {
        const outputPath = path.join(process.cwd(), "extraction-sample.json");
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log("✅ ✅ ✅ EXTRACTION SAMPLE SAVED ✅ ✅ ✅");
        console.log("📁 File location:", outputPath);
        console.log("\n=== EXTRACTION DIAGNOSTIC ===");
        console.log("Structure type:", typeof data);
        console.log("Has nodes:", !!data.nodes);
        console.log("Node count:", data.nodes?.length || 0);
        console.log("Has viewport:", !!data.viewport);
        console.log("Has tokens:", !!data.tokens);
        if (data.nodes && data.nodes.length > 0) {
            const firstNode = data.nodes[0];
            console.log("\nFirst node structure:");
            console.log("- Type:", firstNode.type);
            console.log("- Tag:", firstNode.tag);
            console.log("- Has children:", !!firstNode.children);
            console.log("- Children count:", firstNode.children?.length || 0);
            console.log("- Rect:", firstNode.rect);
            console.log("- Has styles:", !!firstNode.styles);
            console.log("- Node keys:", Object.keys(firstNode).join(", "));
            console.log("\nSample node (first 500 chars):");
            console.log(JSON.stringify(firstNode, null, 2).slice(0, 500) + "...");
        }
        console.log("=== END DIAGNOSTIC ===\n");
    }
    catch (error) {
        console.error("❌ Failed to save extraction sample:", error);
    }
    // PHASE 3: Capture element screenshots
    let screenshots = {};
    if (captureScreenshots) {
        console.log("Capturing element screenshots...");
        const nodesToScreenshot = screenshotComplexOnly
            ? data.nodes.filter((n) => n.needsScreenshot)
            : data.nodes;
        screenshots = await captureElementScreenshots(page, nodesToScreenshot);
        console.log(`Captured ${Object.keys(screenshots).length} screenshots`);
    }
    // PHASE 6: Capture states (hover, focus, active)
    let states = {};
    if (captureStates) {
        console.log("Capturing interaction states...");
        states = await captureInteractionStates(page, data.nodes.filter((n) => n.componentHint === "button" || n.componentHint === "input"));
        console.log(`Captured states for ${Object.keys(states).length} elements`);
    }
    // SEMANTIC NAMING PASS: Add meaningful names to extracted nodes
    console.log("Applying semantic naming pass...");
    const nodesWithNames = applySemanticNaming(data.nodes);
    await browser.close();
    return {
        ...data,
        nodes: nodesWithNames,
        fonts,
        screenshots,
        states,
        assets: [],
        loadInfo,
    };
}
async function waitForFullyLoaded(page) {
    return page.evaluate(async () => {
        const loadStart = Date.now();
        const overallTimeout = 60000;
        const loadInfo = {
            timestamps: {},
            stats: {
                totalWaitMs: 0,
                fontsLoaded: 0,
                fontsFailed: 0,
                failedFonts: [],
                imagesLoaded: 0,
                imagesBlocked: 0,
                imagesFailed: 0,
                lazyElementsActivated: 0,
                domStable: false,
                timedOut: false,
            },
            errors: [],
        };
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const recordError = (phase, error) => {
            const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
            loadInfo.errors.push({ phase, message });
        };
        const processedImages = new WeakSet();
        const remainingTime = () => Math.max(0, overallTimeout - (Date.now() - loadStart));
        const runWithTimeout = async (phase, timeoutMs, fn) => {
            const remaining = remainingTime();
            if (remaining <= 0) {
                loadInfo.stats.timedOut = true;
                recordError("overall", "Load wait exceeded 60000ms");
                return;
            }
            const effectiveTimeout = Math.min(timeoutMs, remaining);
            let timeoutId = null;
            let timedOut = false;
            const timeoutPromise = new Promise((resolve) => {
                timeoutId = window.setTimeout(() => {
                    timedOut = true;
                    resolve();
                }, effectiveTimeout);
            });
            const wrappedFn = (async () => {
                try {
                    await fn();
                }
                catch (error) {
                    recordError(phase, error);
                }
            })();
            await Promise.race([wrappedFn, timeoutPromise]);
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
            if (timedOut) {
                loadInfo.stats.timedOut = true;
                recordError(phase, `${phase} phase timed out after ${effectiveTimeout}ms`);
            }
        };
        const classifyImageError = (img) => {
            const src = img.currentSrc || img.src || "unknown";
            let blocked = false;
            try {
                const url = new URL(src, window.location.href);
                blocked = url.origin !== window.location.origin && !src.startsWith("data:");
            }
            catch {
                blocked = false;
            }
            if (blocked) {
                loadInfo.stats.imagesBlocked += 1;
                recordError("images", `CORS blocked: ${src}`);
            }
            else {
                loadInfo.stats.imagesFailed += 1;
                recordError("images", `Image failed to load: ${src}`);
            }
        };
        const waitOnImages = async (images) => {
            const freshImages = images.filter((img) => !processedImages.has(img));
            freshImages.forEach((img) => processedImages.add(img));
            const alreadyLoaded = freshImages.filter((img) => img.complete && img.naturalWidth > 0);
            loadInfo.stats.imagesLoaded += alreadyLoaded.length;
            const alreadyErrored = freshImages.filter((img) => img.complete && img.naturalWidth === 0);
            alreadyErrored.forEach((img) => classifyImageError(img));
            const pending = freshImages.filter((img) => !img.complete || img.naturalWidth === 0);
            await Promise.all(pending.map((img) => new Promise((resolve) => {
                const cleanup = () => {
                    img.removeEventListener("load", onLoad);
                    img.removeEventListener("error", onError);
                };
                const onLoad = () => {
                    cleanup();
                    loadInfo.stats.imagesLoaded += 1;
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    classifyImageError(img);
                    resolve();
                };
                img.addEventListener("load", onLoad, { once: true });
                img.addEventListener("error", onError, { once: true });
            })));
        };
        await runWithTimeout("documentReady", 30000, async () => {
            if (document.readyState !== "complete") {
                await new Promise((resolve) => {
                    const onReady = () => {
                        if (document.readyState === "complete") {
                            document.removeEventListener("readystatechange", onReady);
                            resolve();
                        }
                    };
                    document.addEventListener("readystatechange", onReady);
                    onReady();
                });
            }
            await delay(500);
            loadInfo.timestamps.documentReady = Date.now();
        });
        await runWithTimeout("fonts", 10000, async () => {
            if (!document.fonts) {
                loadInfo.timestamps.fontsReady = Date.now();
                return;
            }
            try {
                await document.fonts.ready;
            }
            catch (error) {
                recordError("fonts", error);
            }
            const fontFamilies = new Set();
            for (const sheet of Array.from(document.styleSheets)) {
                try {
                    const rules = sheet.cssRules || sheet.rules;
                    for (const rule of Array.from(rules)) {
                        if (rule instanceof CSSFontFaceRule) {
                            let family = rule.style.getPropertyValue("font-family");
                            family = family.replace(/['"]/g, "").trim();
                            if (family) {
                                fontFamilies.add(family);
                            }
                        }
                    }
                }
                catch (error) {
                    recordError("fonts", error);
                }
            }
            await Promise.all(Array.from(fontFamilies).map(async (family) => {
                try {
                    await document.fonts.load(`16px ${family}`);
                    loadInfo.stats.fontsLoaded += 1;
                }
                catch (error) {
                    loadInfo.stats.failedFonts.push(family);
                    recordError("fonts", `Font '${family}' failed to load: ${String(error)}`);
                }
            }));
            loadInfo.timestamps.fontsReady = Date.now();
        });
        await runWithTimeout("images", 15000, async () => {
            const images = Array.from(document.querySelectorAll("img"));
            await waitOnImages(images);
            loadInfo.timestamps.imagesReady = Date.now();
        });
        await runWithTimeout("lazyContent", 10000, async () => {
            const lazyElements = Array.from(document.querySelectorAll('[loading="lazy"], [data-src], [data-lazy], .lazyload'));
            for (const element of lazyElements) {
                try {
                    element.scrollIntoView({ behavior: "instant", block: "center" });
                }
                catch (error) {
                    recordError("lazyContent", error);
                }
                loadInfo.stats.lazyElementsActivated += 1;
                await delay(200);
                const images = Array.from(element.querySelectorAll("img"));
                if (images.length) {
                    await waitOnImages(images);
                }
            }
            const newImages = Array.from(document.querySelectorAll("img"));
            await waitOnImages(newImages);
            loadInfo.timestamps.lazyContentReady = Date.now();
        });
        await runWithTimeout("domStabilization", 3000, async () => {
            const body = document.body;
            if (!body) {
                loadInfo.stats.domStable = true;
                loadInfo.timestamps.domStabilized = Date.now();
                return;
            }
            let previousLength = body.innerHTML.length;
            let stable = false;
            for (let i = 0; i < 3; i += 1) {
                await delay(1000);
                const currentLength = body.innerHTML.length;
                if (previousLength === 0) {
                    if (currentLength === 0) {
                        stable = true;
                        break;
                    }
                    previousLength = currentLength;
                    continue;
                }
                const change = Math.abs(currentLength - previousLength) / previousLength;
                if (change <= 0.05) {
                    stable = true;
                    break;
                }
                previousLength = currentLength;
            }
            loadInfo.stats.domStable = stable;
            loadInfo.timestamps.domStabilized = Date.now();
        });
        await runWithTimeout("layout", 1000, async () => {
            await new Promise((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => resolve());
                    });
                });
            });
        });
        loadInfo.timestamps.extractionStart = Date.now();
        loadInfo.stats.fontsFailed = loadInfo.stats.failedFonts.length;
        loadInfo.stats.totalWaitMs = loadInfo.timestamps.extractionStart - loadStart;
        return loadInfo;
    });
}
/**
 * PHASE 2: Extract fonts from page
 */
async function extractFonts(page, baseUrl) {
    const fonts = await page.evaluate(() => {
        const fontFaces = [];
        try {
            for (const sheet of Array.from(document.styleSheets)) {
                try {
                    const rules = sheet.cssRules || sheet.rules;
                    for (const rule of Array.from(rules)) {
                        if (rule instanceof CSSFontFaceRule) {
                            const style = rule.style;
                            let family = style.getPropertyValue("font-family");
                            family = family.replace(/['"]/g, "").trim();
                            const src = style.getPropertyValue("src");
                            const urlMatches = src.match(/url\(['"]?([^'"()]+)['"]?\)/g);
                            if (urlMatches) {
                                urlMatches.forEach((match) => {
                                    const urlMatch = match.match(/url\(['"]?([^'"()]+)['"]?\)/);
                                    const formatMatch = match.match(/format\(['"]?([^'"()]+)['"]?\)/);
                                    if (urlMatch) {
                                        fontFaces.push({
                                            family,
                                            style: style.getPropertyValue("font-style") || "normal",
                                            weight: style.getPropertyValue("font-weight") || "400",
                                            src: urlMatch[1],
                                            format: formatMatch ? formatMatch[1] : undefined,
                                        });
                                    }
                                });
                            }
                        }
                    }
                }
                catch (e) {
                    // CORS blocked
                }
            }
        }
        catch (e) {
            console.error("Font extraction error:", e);
        }
        return fontFaces;
    });
    // Download fonts
    const fontsWithData = await Promise.all(fonts.map(async (font) => {
        try {
            const fontUrl = new URL(font.src, baseUrl).href;
            const response = await fetch(fontUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                },
            });
            if (response.ok) {
                const buffer = await response.buffer();
                const base64 = buffer.toString("base64");
                const mimeType = response.headers.get("content-type") || "font/woff2";
                return {
                    ...font,
                    src: fontUrl,
                    data: `data:${mimeType};base64,${base64}`,
                };
            }
        }
        catch (e) {
            console.warn(`Failed to download font: ${font.src}`);
        }
        return font;
    }));
    return fontsWithData.filter((f) => f.data);
}
/**
 * PHASE 3: Capture screenshots of specific elements
 */
async function captureElementScreenshots(page, nodes) {
    const screenshots = {};
    const batchSize = 10;
    for (let i = 0; i < nodes.length; i += batchSize) {
        const batch = nodes.slice(i, i + batchSize);
        await Promise.all(batch.map(async (node) => {
            try {
                const element = await page.$(node.selector);
                if (element) {
                    const screenshot = await element.screenshot({
                        type: "png",
                        omitBackground: true,
                    });
                    screenshots[node.id] = screenshot.toString("base64");
                }
            }
            catch (e) {
                // Screenshot failed, skip
            }
        }));
        if (i + batchSize < nodes.length) {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    return screenshots;
}
/**
 * PHASE 6: Capture interaction states
 */
async function captureInteractionStates(page, nodes) {
    const states = {};
    for (const node of nodes) {
        try {
            const element = await page.$(node.selector);
            if (!element)
                continue;
            const nodeStates = {};
            // Hover state
            try {
                await element.hover();
                await page.waitForTimeout(100);
                const hoverScreenshot = await element.screenshot({
                    type: "png",
                    omitBackground: true,
                });
                nodeStates.hover = hoverScreenshot.toString("base64");
            }
            catch (e) { }
            // Focus state (for inputs/buttons)
            if (node.componentHint === "button" || node.componentHint === "input") {
                try {
                    await element.focus();
                    await page.waitForTimeout(100);
                    const focusScreenshot = await element.screenshot({
                        type: "png",
                        omitBackground: true,
                    });
                    nodeStates.focus = focusScreenshot.toString("base64");
                }
                catch (e) { }
            }
            // Active state (for buttons)
            if (node.componentHint === "button") {
                try {
                    await element.click({ delay: 50 });
                    const activeScreenshot = await element.screenshot({
                        type: "png",
                        omitBackground: true,
                    });
                    nodeStates.active = activeScreenshot.toString("base64");
                }
                catch (e) { }
            }
            if (Object.keys(nodeStates).length > 0) {
                states[node.id] = nodeStates;
            }
        }
        catch (e) {
            // Failed to capture states
        }
    }
    return states;
}
/**
 * Auto-scroll to load lazy content
 */
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
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
/**
 * SEMANTIC NAMING PASS: Generate meaningful names for extracted nodes
 */
function applySemanticNaming(nodes) {
    // Build hierarchy map for context
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    // Helper to convert string to camelCase
    const toCamelCase = (str) => {
        return str
            .toLowerCase()
            .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
            return index === 0 ? word.toLowerCase() : word.toUpperCase();
        })
            .replace(/[\s\-_\.]+/g, "");
    };
    // Helper to clean and validate name
    const sanitizeName = (name) => {
        return name
            .replace(/[^a-zA-Z0-9]/g, "")
            .replace(/^\d+/, "") // Remove leading numbers
            .slice(0, 50); // Limit length
    };
    // Component type patterns
    const componentPatterns = {
        button: /btn|button|click|submit|action/i,
        input: /input|field|text|search|email|password/i,
        card: /card|item|tile|block|panel/i,
        modal: /modal|dialog|popup|overlay/i,
        nav: /nav|menu|breadcrumb|tab/i,
        header: /head|banner|top|title/i,
        footer: /foot|bottom|copyright/i,
        sidebar: /side|aside|secondary/i,
        content: /content|main|body|article/i,
        list: /list|grid|items|collection/i,
        form: /form|signup|login|register/i,
        media: /img|image|photo|video|media/i,
    };
    // Generate semantic name based on node properties
    const generateSemanticName = (node) => {
        const parts = [];
        // 1. Use explicit naming attributes first
        if (node.ariaLabel) {
            return toCamelCase(sanitizeName(node.ariaLabel));
        }
        if (node.domId && !node.domId.match(/^[a-f0-9\-]{8,}$/)) {
            // Skip generic IDs
            return toCamelCase(sanitizeName(node.domId));
        }
        // 2. Extract meaningful class names
        if (node.classList) {
            const meaningfulClasses = node.classList.filter((cls) => cls.length > 2 &&
                !cls.match(/^(mt|mb|ml|mr|p|px|py|m|mx|my|w|h|bg|text|flex|grid|col|row|sm|md|lg|xl|btn|card|form)-?\d*$/) &&
                !cls.match(/^(active|hover|focus|disabled|selected|open|closed|visible|hidden)$/));
            if (meaningfulClasses.length > 0) {
                parts.push(meaningfulClasses[0]);
            }
        }
        // 3. Use data attributes for semantic hints
        if (node.dataAttributes) {
            for (const [attr, value] of Object.entries(node.dataAttributes)) {
                if (attr === "data-testid" ||
                    attr === "data-component" ||
                    attr === "data-name") {
                    return toCamelCase(sanitizeName(value));
                }
            }
        }
        // 4. Detect component patterns from text content
        if (node.text && node.text.length < 30) {
            const text = node.text.toLowerCase();
            for (const [type, pattern] of Object.entries(componentPatterns)) {
                if (pattern.test(text)) {
                    parts.push(type);
                    break;
                }
            }
        }
        // 5. Use component hints from detection
        if (node.componentHint) {
            parts.push(node.componentHint);
        }
        // 6. Use role attributes
        if (node.role) {
            parts.push(node.role);
        }
        // 7. Fallback to tag-based naming
        if (parts.length === 0) {
            const tag = node.tag.toLowerCase();
            switch (tag) {
                case "div":
                case "section":
                    parts.push(getContainerType(node));
                    break;
                case "span":
                case "p":
                    parts.push("text");
                    break;
                case "img":
                    parts.push("image");
                    break;
                case "a":
                    parts.push("link");
                    break;
                case "ul":
                case "ol":
                    parts.push("list");
                    break;
                case "li":
                    parts.push("listItem");
                    break;
                default:
                    parts.push(tag);
            }
        }
        // 8. Add context from hierarchy
        const context = getHierarchyContext(node, nodeMap);
        if (context) {
            parts.unshift(context);
        }
        // 9. Add type suffix for clarity
        if (node.type === "IMAGE") {
            parts.push("Image");
        }
        else if (node.type === "SVG") {
            parts.push("Icon");
        }
        let baseName = parts.filter(Boolean).join(" ");
        if (!baseName || baseName.length < 2) {
            baseName = node.tag + " element";
        }
        return toCamelCase(sanitizeName(baseName));
    };
    // Determine container type based on styles and content
    const getContainerType = (node) => {
        const styles = node.styles || {};
        if (styles.display === "flex" || styles.display === "grid") {
            return "container";
        }
        if (styles.position === "fixed" || styles.position === "sticky") {
            return "overlay";
        }
        if (styles.overflowY === "scroll" || styles.overflowY === "auto") {
            return "scrollArea";
        }
        if (styles.borderRadius && parseInt(styles.borderRadius) > 8) {
            return "card";
        }
        if (styles.boxShadow && styles.boxShadow !== "none") {
            return "panel";
        }
        return "container";
    };
    // Get naming context from parent hierarchy
    const getHierarchyContext = (node, nodeMap) => {
        if (!node.parent)
            return null;
        const parent = nodeMap.get(node.parent);
        if (!parent)
            return null;
        // Check if parent has a meaningful component hint
        if (parent.componentHint) {
            switch (parent.componentHint) {
                case "navigation":
                    return "nav";
                case "header":
                    return "header";
                case "footer":
                    return "footer";
                case "sidebar":
                    return "side";
                case "card":
                    return "card";
                default:
                    return null;
            }
        }
        // Check parent's meaningful classes
        if (parent.classList) {
            const meaningfulParentClass = parent.classList.find((cls) => /^(header|nav|footer|sidebar|card|modal|form|content|main)/.test(cls.toLowerCase()));
            if (meaningfulParentClass) {
                return meaningfulParentClass.split(/[-_]/)[0].toLowerCase();
            }
        }
        return null;
    };
    // Apply naming with collision detection
    const nameRegistry = new Map();
    return nodes.map((node) => {
        let baseName = generateSemanticName(node);
        // Handle name collisions
        if (nameRegistry.has(baseName)) {
            const count = nameRegistry.get(baseName) + 1;
            nameRegistry.set(baseName, count);
            baseName = `${baseName}${count}`;
        }
        else {
            nameRegistry.set(baseName, 1);
        }
        // Ensure minimum name quality
        if (baseName.length < 3) {
            baseName = `${node.tag}Element${nameRegistry.get("element") || 1}`;
            nameRegistry.set("element", (nameRegistry.get("element") || 0) + 1);
        }
        return {
            ...node,
            name: baseName,
        };
    });
}
// Preset extraction modes
export async function extractBasic(url) {
    return extractComplete(url, {
        captureFonts: false,
        captureScreenshots: false,
        captureStates: false,
        capturePseudoElements: false,
    });
}
export async function extractHybrid(url) {
    return extractComplete(url, {
        captureFonts: true,
        captureScreenshots: true,
        screenshotComplexOnly: true,
        captureStates: false,
        capturePseudoElements: true,
    });
}
export async function extractMaximum(url) {
    return extractComplete(url, {
        captureFonts: true,
        captureScreenshots: true,
        screenshotComplexOnly: false,
        captureStates: true,
        capturePseudoElements: true,
    });
}
// Backward compatibility
export async function extractWithTokens(url) {
    return extractBasic(url);
}
export async function extractWithFontsAndScreenshots(url, options = {}) {
    return extractComplete(url, options);
}
//# sourceMappingURL=scraper.js.map