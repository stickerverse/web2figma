import { BuildPlan, DiagEvent, DiagLevel } from "./diagnostics-protocol";

type PostTarget = { postMessage: (pluginMessage: any) => void };

function nowTs(): number {
  return Date.now();
}

function safeSerializeData(data: any): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try {
    // Ensure no huge circular objects
    return JSON.parse(JSON.stringify(data));
  } catch {
    return { note: "Data not serializable (circular or large)" };
  }
}

export class Diagnostics {
  private runId: string | null = null;
  private target: PostTarget | null = null;
  private buffer: DiagEvent[] = [];
  private bufferMax = 2000;

  attach(target: PostTarget) {
    this.target = target;
    // flush any buffered events
    this.flush();
  }

  startRun(meta?: Record<string, unknown>): string {
    this.runId = `run_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    this.emit({
      type: "RUN_START",
      runId: this.runId,
      ts: nowTs(),
      meta: safeSerializeData(meta),
    });
    return this.runId;
  }

  endRun(status: "ok" | "warn" | "error", summary?: Record<string, unknown>) {
    if (!this.runId) return;
    this.emit({
      type: "RUN_END",
      runId: this.runId,
      ts: nowTs(),
      status,
      summary: safeSerializeData(summary),
    });
    this.runId = null;
  }

  publishPlan(plan: BuildPlan) {
    if (!this.runId) return;
    this.emit({
      type: "PLAN",
      runId: this.runId,
      ts: nowTs(),
      plan,
    });
  }

  stepStart(stepId: string, label: string, meta?: Record<string, unknown>, parentStepId?: string) {
    if (!this.runId) return;
    this.emit({
      type: "STEP_START",
      runId: this.runId,
      ts: nowTs(),
      stepId,
      label,
      parentStepId,
      meta: safeSerializeData(meta),
    });
  }

  stepEnd(stepId: string, status: "ok" | "warn" | "error" | "skipped", meta?: Record<string, unknown>) {
    if (!this.runId) return;
    this.emit({
      type: "STEP_END",
      runId: this.runId,
      ts: nowTs(),
      stepId,
      status,
      meta: safeSerializeData(meta),
    });
  }

  log(level: DiagLevel, message: string, data?: Record<string, unknown>, stepId?: string) {
    if (!this.runId) return;
    this.emit({
      type: "LOG",
      runId: this.runId,
      ts: nowTs(),
      level,
      stepId,
      message,
      data: safeSerializeData(data),
    });
  }

  info(message: string, data?: Record<string, unknown>, stepId?: string) {
    this.log("INFO", message, data, stepId);
  }
  warn(message: string, data?: Record<string, unknown>, stepId?: string) {
    this.log("WARN", message, data, stepId);
  }
  error(message: string, data?: Record<string, unknown>, stepId?: string) {
    this.log("ERROR", message, data, stepId);
  }
  debug(message: string, data?: Record<string, unknown>, stepId?: string) {
    this.log("DEBUG", message, data, stepId);
  }

  private emit(ev: DiagEvent) {
    if (this.target) {
      this.target.postMessage({ type: "DIAG_EVENT", event: ev });
    } else {
      this.buffer.push(ev);
      if (this.buffer.length > this.bufferMax) this.buffer.shift();
    }
  }

  private flush() {
    if (!this.target) return;
    for (const ev of this.buffer) {
      this.target.postMessage({ type: "DIAG_EVENT", event: ev });
    }
    this.buffer = [];
  }
}
