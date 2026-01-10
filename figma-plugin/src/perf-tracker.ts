/**
 * Performance Tracker for Figma Import
 *
 * Lightweight instrumentation utility for profiling import operations.
 * Guarded by PERF_DEBUG_ENABLED flag.
 */

// Enable/disable performance tracking (set to true to see timing logs)
export const PERF_DEBUG_ENABLED = true;

// Phase names for consistent tracking
export enum PerfPhase {
  TOTAL_IMPORT = "TOTAL_IMPORT",
  SCHEMA_ANALYSIS = "SCHEMA_ANALYSIS",
  SCHEMA_PREPROCESSING = "SCHEMA_PREPROCESSING",
  FONT_PRELOAD = "FONT_PRELOAD",
  IMAGE_PRELOAD = "IMAGE_PRELOAD",
  HIERARCHY_INFERENCE = "HIERARCHY_INFERENCE",
  NODE_CREATION = "NODE_CREATION",
  NODE_PARENTING = "NODE_PARENTING",
  STYLE_APPLICATION = "STYLE_APPLICATION",
  TREE_OPTIMIZATION = "TREE_OPTIMIZATION",
  POSITION_VERIFICATION = "POSITION_VERIFICATION",
}

interface PerfMark {
  label: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

interface PerfStats {
  totalNodes: number;
  nodesCreated: number;
  nodesFailed: number;
  fontsLoaded: number;
  imagesLoaded: number;
  batchCount: number;
  batchSize: number;
  yieldCount: number;
}

interface PhaseSummary {
  phase: string;
  durationMs: number;
  percentOfTotal: number;
}

class PerfTracker {
  private marks: Map<string, PerfMark> = new Map();
  private stats: PerfStats = {
    totalNodes: 0,
    nodesCreated: 0,
    nodesFailed: 0,
    fontsLoaded: 0,
    imagesLoaded: 0,
    batchCount: 0,
    batchSize: 100,
    yieldCount: 0,
  };
  private importStartTime: number = 0;
  private enabled: boolean = PERF_DEBUG_ENABLED;

  /**
   * Start timing a phase
   */
  startPhase(phase: PerfPhase | string, metadata?: Record<string, any>): void {
    if (!this.enabled) return;

    const mark: PerfMark = {
      label: phase,
      startTime: Date.now(),
      metadata,
    };
    this.marks.set(phase, mark);

    if (phase === PerfPhase.TOTAL_IMPORT) {
      this.importStartTime = mark.startTime;
      console.log(`\n${"=".repeat(60)}`);
      console.log(`⏱️ [PERF] Starting import performance tracking`);
      console.log(`${"=".repeat(60)}`);
    }
  }

  /**
   * End timing a phase
   */
  endPhase(phase: PerfPhase | string): number {
    if (!this.enabled) return 0;

    const mark = this.marks.get(phase);
    if (!mark) {
      console.warn(`⚠️ [PERF] No start mark for phase: ${phase}`);
      return 0;
    }

    mark.endTime = Date.now();
    mark.duration = mark.endTime - mark.startTime;

    console.log(`⏱️ [PERF] ${phase}: ${mark.duration}ms`);

    return mark.duration;
  }

  /**
   * Quick timing helper for synchronous operations
   */
  time<T>(phase: PerfPhase | string, fn: () => T): T {
    this.startPhase(phase);
    const result = fn();
    this.endPhase(phase);
    return result;
  }

  /**
   * Quick timing helper for async operations
   */
  async timeAsync<T>(
    phase: PerfPhase | string,
    fn: () => Promise<T>
  ): Promise<T> {
    this.startPhase(phase);
    const result = await fn();
    this.endPhase(phase);
    return result;
  }

  /**
   * Update stats counters
   */
  updateStats(updates: Partial<PerfStats>): void {
    Object.assign(this.stats, updates);
  }

  /**
   * Increment a specific stat
   */
  incrementStat(key: keyof PerfStats, amount: number = 1): void {
    if (typeof this.stats[key] === "number") {
      (this.stats[key] as number) += amount;
    }
  }

  /**
   * Record a yield event (for batching)
   */
  recordYield(): void {
    this.stats.yieldCount++;
  }

  /**
   * Get phase duration
   */
  getPhaseDuration(phase: PerfPhase | string): number {
    return this.marks.get(phase)?.duration ?? 0;
  }

  /**
   * Generate timing summary
   */
  generateSummary(): string {
    if (!this.enabled) return "";

    const totalDuration =
      this.getPhaseDuration(PerfPhase.TOTAL_IMPORT) ||
      Date.now() - this.importStartTime;

    const phases: PhaseSummary[] = [];

    for (const [phase, mark] of this.marks) {
      if (phase !== PerfPhase.TOTAL_IMPORT && mark.duration) {
        phases.push({
          phase,
          durationMs: mark.duration,
          percentOfTotal:
            totalDuration > 0
              ? Math.round((mark.duration / totalDuration) * 100)
              : 0,
        });
      }
    }

    // Sort by duration descending
    phases.sort((a, b) => b.durationMs - a.durationMs);

    const lines: string[] = [
      "",
      "=".repeat(60),
      "📊 [PERF] IMPORT PERFORMANCE SUMMARY",
      "=".repeat(60),
      "",
      `Total Import Time: ${totalDuration}ms (${(totalDuration / 1000).toFixed(
        2
      )}s)`,
      "",
      "--- Phase Breakdown (sorted by time) ---",
    ];

    for (const p of phases) {
      const bar = "█".repeat(Math.ceil(p.percentOfTotal / 5));
      lines.push(
        `  ${p.phase.padEnd(25)} ${String(p.durationMs).padStart(
          6
        )}ms (${String(p.percentOfTotal).padStart(2)}%) ${bar}`
      );
    }

    lines.push("");
    lines.push("--- Node Statistics ---");
    lines.push(`  Total Nodes in Schema:   ${this.stats.totalNodes}`);
    lines.push(`  Nodes Successfully Created: ${this.stats.nodesCreated}`);
    lines.push(`  Nodes Failed:            ${this.stats.nodesFailed}`);
    lines.push(`  Fonts Loaded:            ${this.stats.fontsLoaded}`);
    lines.push(`  Images Loaded:           ${this.stats.imagesLoaded}`);
    lines.push("");
    lines.push("--- Batching Statistics ---");
    lines.push(`  Batch Size:              ${this.stats.batchSize}`);
    lines.push(`  Number of Batches:       ${this.stats.batchCount}`);
    lines.push(`  Yield Events:            ${this.stats.yieldCount}`);

    if (this.stats.nodesCreated > 0) {
      const msPerNode = totalDuration / this.stats.nodesCreated;
      const nodesPerSecond = Math.round(1000 / msPerNode);
      lines.push("");
      lines.push("--- Performance Metrics ---");
      lines.push(`  Avg Time per Node:       ${msPerNode.toFixed(2)}ms`);
      lines.push(`  Nodes per Second:        ${nodesPerSecond}`);
    }

    lines.push("");
    lines.push("=".repeat(60));

    return lines.join("\n");
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    if (!this.enabled) return;
    console.log(this.generateSummary());
  }

  /**
   * Get raw data for external analysis
   */
  getRawData(): { marks: Map<string, PerfMark>; stats: PerfStats } {
    return {
      marks: new Map(this.marks),
      stats: { ...this.stats },
    };
  }

  /**
   * Reset tracker for new import
   */
  reset(): void {
    this.marks.clear();
    this.stats = {
      totalNodes: 0,
      nodesCreated: 0,
      nodesFailed: 0,
      fontsLoaded: 0,
      imagesLoaded: 0,
      batchCount: 0,
      batchSize: 100,
      yieldCount: 0,
    };
    this.importStartTime = 0;
  }

  /**
   * Enable/disable tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// Singleton instance
export const perfTracker = new PerfTracker();

/**
 * Deterministic yielding helper for batch processing.
 * Uses setTimeout(0) to yield to Figma's UI thread.
 */
export async function yieldToMain(): Promise<void> {
  perfTracker.recordYield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Batch processor with deterministic yielding.
 * Processes items in batches, yielding between each batch to prevent UI freeze.
 */
export async function processBatched<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  batchSize: number = 100
): Promise<R[]> {
  const results: R[] = [];
  perfTracker.updateStats({ batchSize });

  for (let i = 0; i < items.length; i++) {
    results.push(await processor(items[i], i));

    // Yield after each batch
    if ((i + 1) % batchSize === 0) {
      perfTracker.incrementStat("batchCount");
      await yieldToMain();
    }
  }

  // Count final partial batch
  if (items.length % batchSize !== 0) {
    perfTracker.incrementStat("batchCount");
  }

  return results;
}
