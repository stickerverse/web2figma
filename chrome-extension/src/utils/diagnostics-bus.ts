/**
 * Diagnostics Bus - Machine-Readable Telemetry for Automated Testing
 *
 * Provides a centralized event stream for:
 * - Automated test harness consumption
 * - Agent-driven debugging
 * - Production monitoring
 *
 * All events follow a strict schema with:
 * - stage: Where in the pipeline (content_script, extractor, serializer, etc.)
 * - code: Stable enum identifier (CAPTURE_EMPTY_TREE, IMAGE_FETCH_FAILED, etc.)
 * - severity: info | warn | error | fatal
 * - context: Relevant data (nodeId, url, viewport, etc.)
 * - suggestedFix: Actionable advice on how to resolve the issue
 */

export type DiagnosticStage =
  | 'content_script'
  | 'extractor'
  | 'serializer'
  | 'handoff'
  | 'plugin_import'
  | 'ai_analysis'
  | 'asset_fetch'
  | 'injected_script';

export type DiagnosticSeverity = 'info' | 'warn' | 'error' | 'fatal';

export type DiagnosticCode =
  // Tree extraction
  | 'CAPTURE_EMPTY_TREE'
  | 'ROOT_NODE_MISSING'
  | 'TREE_DEPTH_EXCEEDED'
  | 'PHANTOM_CONTAINER_PRUNED'
  | 'VISIBILITY_HIDDEN_RECURSION'

  // Geometry validation
  | 'NAN_GUARD_TRIPPED'
  | 'INFINITY_DETECTED'
  | 'NEGATIVE_DIMENSION'
  | 'ZERO_SIZE_ELEMENT'

  // Asset fetching
  | 'IMAGE_FETCH_FAILED'
  | 'IMAGE_FETCH_CORS'
  | 'IMAGE_FETCH_TIMEOUT'
  | 'FONT_UNAVAILABLE'
  | 'FONT_LOAD_FAILED'

  // Serialization
  | 'CIRCULAR_REFERENCE'
  | 'SERIALIZATION_FAILED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'DOM_NODE_LEAKED'
  | 'POST_MESSAGE_FAILED'

  // AI Analysis
  | 'AI_ANALYSIS_TIMEOUT'
  | 'AI_ANALYSIS_FAILED'
  | 'AI_MODEL_UNAVAILABLE'

  // Capture flow
  | 'CAPTURE_STARTED'
  | 'CAPTURE_COMPLETED'
  | 'CAPTURE_FAILED'
  | 'CAPTURE_TIMEOUT'
  | 'SCREENSHOT_FAILED'

  // Layout
  | 'LAYOUT_INVALID'
  | 'TRANSFORM_PARSE_FAILED'

  // General
  | 'UNKNOWN_ERROR';

// Suggested fixes for each error code
const SUGGESTED_FIXES: Record<DiagnosticCode, string> = {
  CAPTURE_EMPTY_TREE: 'The captured DOM tree is empty. Check if the page has loaded fully, or if content is dynamically loaded after initial render. Try increasing the wait time before capture.',
  ROOT_NODE_MISSING: 'Could not find a root element to extract. Ensure document.body exists and is not hidden.',
  TREE_DEPTH_EXCEEDED: 'DOM tree exceeds maximum depth. This may indicate circular references or extremely nested structures. Check for iframes or shadow DOM issues.',
  PHANTOM_CONTAINER_PRUNED: 'Empty container elements were removed. This is usually expected behavior for optimization.',
  VISIBILITY_HIDDEN_RECURSION: 'Element and children skipped due to visibility:hidden. If content should be visible, check CSS.',
  
  NAN_GUARD_TRIPPED: 'A numeric value became NaN. Check computed styles for invalid values. Look for division by zero or invalid parseFloat inputs.',
  INFINITY_DETECTED: 'An infinite value was detected. Check for division by zero in layout calculations.',
  NEGATIVE_DIMENSION: 'Negative width/height detected. Element may be off-screen or have invalid box-sizing.',
  ZERO_SIZE_ELEMENT: 'Element has zero dimensions. May be collapsed, hidden, or not yet rendered.',
  
  IMAGE_FETCH_FAILED: 'Could not download image. Check if URL is valid, server is reachable, and no authentication is required.',
  IMAGE_FETCH_CORS: 'Image blocked by CORS policy. The server does not allow cross-origin requests. Use a proxy or capture as screenshot.',
  IMAGE_FETCH_TIMEOUT: 'Image download timed out. Server may be slow or image too large. Increase timeout or reduce image quality.',
  FONT_UNAVAILABLE: 'Font is not available in Figma. Use strictCloneMode to rasterize text, or install the font locally.',
  FONT_LOAD_FAILED: 'Could not load font data. Font file may be corrupted or inaccessible.',
  
  CIRCULAR_REFERENCE: 'Circular reference in object graph. Check for parent/child back-references. Remove bidirectional links before serialization.',
  SERIALIZATION_FAILED: 'Failed to serialize schema to JSON. Check for non-serializable values like functions, DOM nodes, or circular references.',
  SCHEMA_VALIDATION_FAILED: 'Schema does not match expected format. Required fields may be missing or have wrong types.',
  DOM_NODE_LEAKED: 'A live DOM node was found in the schema. Check __elementRef cleanup, and ensure all element references are removed before postMessage.',
  POST_MESSAGE_FAILED: 'window.postMessage failed. The schema likely contains non-cloneable objects. Check sanitizeSchemaForMessaging is being called.',
  
  AI_ANALYSIS_TIMEOUT: 'AI analysis took too long. Reduce image size or skip AI analysis for faster captures.',
  AI_ANALYSIS_FAILED: 'AI analysis returned an error. Check handoff server logs for details.',
  AI_MODEL_UNAVAILABLE: 'AI model not loaded or configured. Start the handoff server with AI models enabled.',
  
  CAPTURE_STARTED: 'Capture has begun. This is informational.',
  CAPTURE_COMPLETED: 'Capture completed successfully.',
  CAPTURE_FAILED: 'Capture failed. Check previous errors in the log for the root cause.',
  CAPTURE_TIMEOUT: 'Capture exceeded time limit. The page may be too complex or have infinite animations. Try a simpler page or increase timeout.',
  SCREENSHOT_FAILED: 'Could not capture screenshot. Ensure tab is visible, not a chrome:// page, and extension has proper permissions.',
  
  LAYOUT_INVALID: 'Layout values are invalid. Check for NaN, negative, or extremely large values in position/size.',
  TRANSFORM_PARSE_FAILED: 'Could not parse CSS transform. The transform string may have unsupported functions.',
  
  UNKNOWN_ERROR: 'An unexpected error occurred. Check the stack trace for more details.',
};

export interface DiagnosticEvent {
  timestamp: number;
  stage: DiagnosticStage;
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  suggestedFix?: string;
  file?: string;
  line?: number;
  functionName?: string;
  context?: {
    nodeId?: string;
    url?: string;
    viewport?: { width: number; height: number };
    scrollOffset?: { x: number; y: number };
    value?: any;
    stack?: string;
    error?: Error | string;
    [key: string]: any;
  };
}

class DiagnosticsBus {
  private events: DiagnosticEvent[] = [];
  private listeners: ((event: DiagnosticEvent) => void)[] = [];
  private consoleEnabled = true;
  private storageEnabled = true;
  private captureUrl: string = '';
  private captureStartTime: number = 0;

  /**
   * Start a new capture session (clears previous events)
   */
  startCapture(url: string): void {
    this.events = [];
    this.captureUrl = url;
    this.captureStartTime = Date.now();
    this.emit({
      stage: 'content_script',
      code: 'CAPTURE_STARTED',
      severity: 'info',
      message: `Starting capture for: ${url}`,
    });
  }

  /**
   * Parse stack trace to extract file and line info
   */
  private parseStackTrace(stack?: string): { file?: string; line?: number; functionName?: string } {
    if (!stack) return {};
    
    const lines = stack.split('\n');
    for (const line of lines.slice(1)) {
      // Chrome/V8 format: at functionName (file.ts:123:45)
      const chromeMatch = line.match(/at\s+(?:async\s+)?(?:(\S+)\s+)?\(?([^:]+):(\d+):(\d+)\)?/);
      if (chromeMatch) {
        const [, funcName, filePath, lineNum] = chromeMatch;
        const fileName = filePath.split('/').pop() || filePath;
        return {
          file: fileName,
          line: parseInt(lineNum, 10),
          functionName: funcName || undefined
        };
      }
    }
    return {};
  }

  /**
   * Emit a diagnostic event
   */
  emit(event: Omit<DiagnosticEvent, 'timestamp'>): void {
    // Auto-populate suggested fix from lookup table
    const suggestedFix = event.suggestedFix || SUGGESTED_FIXES[event.code] || SUGGESTED_FIXES.UNKNOWN_ERROR;
    
    // Parse stack trace if error provided
    let fileInfo: { file?: string; line?: number; functionName?: string } = {};
    if (event.context?.stack) {
      fileInfo = this.parseStackTrace(event.context.stack);
    } else if (event.context?.error instanceof Error) {
      fileInfo = this.parseStackTrace(event.context.error.stack);
    }

    const fullEvent: DiagnosticEvent = {
      timestamp: Date.now(),
      suggestedFix,
      ...fileInfo,
      ...event,
    };

    this.events.push(fullEvent);

    // Console output (human-readable + machine-parseable)
    if (this.consoleEnabled) {
      const prefix = this.getSeverityPrefix(fullEvent.severity);
      const shortCode = fullEvent.code.substring(0, 25);
      const location = fullEvent.file ? ` @ ${fullEvent.file}:${fullEvent.line || '?'}` : '';
      
      console.group(`${prefix} [${fullEvent.stage}] ${shortCode}${location}`);
      console.log(`Message: ${fullEvent.message}`);
      if (fullEvent.severity !== 'info') {
        console.log(`🔧 Fix: ${suggestedFix}`);
      }
      if (fullEvent.context && Object.keys(fullEvent.context).length > 0) {
        console.log('Context:', fullEvent.context);
      }
      console.groupEnd();

      // Also log as JSON for easy parsing by automated tools
      console.log(`[TELEMETRY] ${JSON.stringify(fullEvent)}`);
    }

    // Notify listeners
    this.listeners.forEach((listener) => {
      try {
        listener(fullEvent);
      } catch (e) {
        console.error('[DiagnosticsBus] Listener error:', e);
      }
    });

    // Persist to chrome.storage for test harness
    if (this.storageEnabled && typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({
        diagnosticEvents: this.events.slice(-100), // Keep last 100 events
      }).catch(() => {
        // Storage might not be available in all contexts
      });
    }

    // Fail-fast on fatal events
    if (fullEvent.severity === 'fatal') {
      console.error(
        `💀 FATAL: ${fullEvent.code} - ${fullEvent.message}`,
        fullEvent.context
      );
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: (event: DiagnosticEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get all events
   */
  getEvents(): DiagnosticEvent[] {
    return [...this.events];
  }

  /**
   * Get events by stage
   */
  getEventsByStage(stage: DiagnosticStage): DiagnosticEvent[] {
    return this.events.filter((e) => e.stage === stage);
  }

  /**
   * Get events by severity
   */
  getEventsBySeverity(severity: DiagnosticSeverity): DiagnosticEvent[] {
    return this.events.filter((e) => e.severity === severity);
  }

  /**
   * Get events by code
   */
  getEventsByCode(code: DiagnosticCode): DiagnosticEvent[] {
    return this.events.filter((e) => e.code === code);
  }

  /**
   * Check if any fatal errors occurred
   */
  hasFatalErrors(): boolean {
    return this.events.some((e) => e.severity === 'fatal');
  }

  /**
   * Generate a completion report for test harness
   */
  generateReport(): {
    totalEvents: number;
    byStage: Record<DiagnosticStage, number>;
    bySeverity: Record<DiagnosticSeverity, number>;
    fatalEvents: DiagnosticEvent[];
    errorEvents: DiagnosticEvent[];
  } {
    const report = {
      totalEvents: this.events.length,
      byStage: {} as Record<DiagnosticStage, number>,
      bySeverity: {} as Record<DiagnosticSeverity, number>,
      fatalEvents: this.getEventsBySeverity('fatal'),
      errorEvents: this.getEventsBySeverity('error'),
    };

    this.events.forEach((event) => {
      report.byStage[event.stage] = (report.byStage[event.stage] || 0) + 1;
      report.bySeverity[event.severity] =
        (report.bySeverity[event.severity] || 0) + 1;
    });

    return report;
  }

  /**
   * Generate a human-readable diagnostic report
   */
  generateReadableReport(): string {
    const duration = ((Date.now() - this.captureStartTime) / 1000).toFixed(2);
    const report = this.generateReport();
    
    const lines: string[] = [];
    lines.push('');
    lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
    lines.push('║                        CAPTURE DIAGNOSTIC REPORT                             ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
    lines.push(`║ URL: ${this.captureUrl.substring(0, 70).padEnd(70)} ║`);
    lines.push(`║ Duration: ${duration}s`.padEnd(79) + '║');
    lines.push(`║ Total Events: ${this.events.length}`.padEnd(79) + '║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
    lines.push('║ SEVERITY BREAKDOWN                                                           ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
    lines.push(`║   💀 Fatal:   ${report.bySeverity.fatal || 0}`.padEnd(79) + '║');
    lines.push(`║   ❌ Errors:  ${report.bySeverity.error || 0}`.padEnd(79) + '║');
    lines.push(`║   ⚠️  Warnings: ${report.bySeverity.warn || 0}`.padEnd(79) + '║');
    lines.push(`║   ℹ️  Info:    ${report.bySeverity.info || 0}`.padEnd(79) + '║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
    
    // Group errors by code for actionable summary
    const errorsByCode: Record<string, DiagnosticEvent[]> = {};
    for (const event of this.events.filter(e => e.severity !== 'info')) {
      if (!errorsByCode[event.code]) {
        errorsByCode[event.code] = [];
      }
      errorsByCode[event.code].push(event);
    }
    
    if (Object.keys(errorsByCode).length > 0) {
      lines.push('║ ISSUES TO FIX (by priority)                                                  ║');
      lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
      
      // Sort by severity (fatal first, then error, then warn)
      const sortedCodes = Object.entries(errorsByCode).sort(([, a], [, b]) => {
        const sevOrder = { fatal: 0, error: 1, warn: 2, info: 3 };
        return (sevOrder[a[0].severity] || 3) - (sevOrder[b[0].severity] || 3);
      });
      
      let issueNum = 1;
      for (const [code, events] of sortedCodes.slice(0, 10)) { // Top 10 issues
        const first = events[0];
        const prefix = this.getSeverityPrefix(first.severity);
        
        lines.push('║                                                                              ║');
        lines.push(`║ ${prefix} Issue #${issueNum}: ${code}`.padEnd(78) + '║');
        lines.push(`║    Occurrences: ${events.length}`.padEnd(78) + '║');
        
        if (first.file) {
          lines.push(`║    📍 Location: ${first.file}:${first.line || '?'}`.padEnd(78) + '║');
        }
        
        // Word-wrap the message
        const msg = first.message.substring(0, 150);
        lines.push(`║    💬 ${msg}`.padEnd(78) + '║');
        
        // Word-wrap the fix
        const fix = first.suggestedFix || 'No suggested fix available.';
        const fixLines = this.wordWrap(fix, 68);
        lines.push(`║    🔧 Fix:`.padEnd(78) + '║');
        for (const fixLine of fixLines) {
          lines.push(`║       ${fixLine}`.padEnd(78) + '║');
        }
        
        issueNum++;
      }
    } else {
      lines.push('║ ✅ NO ERRORS OR WARNINGS                                                     ║');
    }
    
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
    lines.push('║ NEXT STEPS                                                                   ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════════════╣');
    
    if (report.fatalEvents.length > 0) {
      lines.push('║ 🚨 CRITICAL: Fix fatal errors first - capture cannot proceed without this.   ║');
    } else if (report.errorEvents.length > 0) {
      lines.push('║ ⚡ Fix the errors above to improve capture fidelity.                         ║');
      lines.push('║    Errors prevent certain elements from being captured correctly.            ║');
    } else if ((report.bySeverity.warn || 0) > 0) {
      lines.push('║ ✨ Capture succeeded with warnings. Review warnings to improve quality.      ║');
    } else {
      lines.push('║ ✅ Capture completed successfully with no issues!                            ║');
    }
    
    lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');
    lines.push('');
    
    return lines.join('\n');
  }

  /**
   * Word wrap helper
   */
  private wordWrap(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length > maxWidth) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine = (currentLine + ' ' + word).trim();
      }
    }
    if (currentLine) lines.push(currentLine.trim());
    
    return lines.length > 0 ? lines : [''];
  }

  /**
   * Print the diagnostic report to console
   */
  printReport(): void {
    console.log(this.generateReadableReport());
    
    // Also output as downloadable JSON
    console.log('\n📋 Full diagnostic data available via: diagnostics.getReportJSON()');
    console.log('   Copy/paste to share with developers.\n');
  }

  /**
   * Get report as JSON for download/sharing
   */
  getReportJSON(): string {
    return JSON.stringify({
      captureUrl: this.captureUrl,
      duration: Date.now() - this.captureStartTime,
      generatedAt: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      ...this.generateReport(),
      events: this.events,
    }, null, 2);
  }

  /**
   * Clear all events (useful for testing)
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Configure bus behavior
   */
  configure(options: {
    consoleEnabled?: boolean;
    storageEnabled?: boolean;
  }): void {
    if (options.consoleEnabled !== undefined) {
      this.consoleEnabled = options.consoleEnabled;
    }
    if (options.storageEnabled !== undefined) {
      this.storageEnabled = options.storageEnabled;
    }
  }

  private getSeverityPrefix(severity: DiagnosticSeverity): string {
    switch (severity) {
      case 'info':
        return 'ℹ️';
      case 'warn':
        return '⚠️';
      case 'error':
        return '❌';
      case 'fatal':
        return '💀';
    }
  }
}

// Singleton instance
export const diagnostics = new DiagnosticsBus();

// Convenience methods for common patterns
export const emitInfo = (
  stage: DiagnosticStage,
  code: DiagnosticCode,
  message: string,
  context?: DiagnosticEvent['context']
) => {
  diagnostics.emit({ stage, code, severity: 'info', message, context });
};

export const emitWarn = (
  stage: DiagnosticStage,
  code: DiagnosticCode,
  message: string,
  context?: DiagnosticEvent['context']
) => {
  diagnostics.emit({ stage, code, severity: 'warn', message, context });
};

export const emitError = (
  stage: DiagnosticStage,
  code: DiagnosticCode,
  message: string,
  context?: DiagnosticEvent['context']
) => {
  diagnostics.emit({ stage, code, severity: 'error', message, context });
};

export const emitFatal = (
  stage: DiagnosticStage,
  code: DiagnosticCode,
  message: string,
  context?: DiagnosticEvent['context']
) => {
  diagnostics.emit({ stage, code, severity: 'fatal', message, context });
};
