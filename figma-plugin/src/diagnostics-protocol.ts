export type DiagLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export type DiagEvent =
  | {
      type: "RUN_START";
      runId: string;
      ts: number;
      meta?: Record<string, unknown>;
    }
  | {
      type: "RUN_END";
      runId: string;
      ts: number;
      status: "ok" | "warn" | "error";
      summary?: Record<string, unknown>;
    }
  | {
      type: "STEP_START";
      runId: string;
      ts: number;
      stepId: string;
      label: string;
      parentStepId?: string;
      meta?: Record<string, unknown>;
    }
  | {
      type: "STEP_END";
      runId: string;
      ts: number;
      stepId: string;
      status: "ok" | "warn" | "error" | "skipped";
      meta?: Record<string, unknown>;
    }
  | {
      type: "LOG";
      runId: string;
      ts: number;
      level: DiagLevel;
      stepId?: string;
      message: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "PLAN";
      runId: string;
      ts: number;
      plan: BuildPlan;
    };

export type BuildPlanStep = {
  stepId: string;
  label: string;
  description?: string;
  expected?: Record<string, unknown>;
  notes?: string[];
};

export type BuildPlan = {
  schemaMeta?: Record<string, unknown>;
  steps: BuildPlanStep[];
  risks?: { severity: "low" | "medium" | "high"; message: string }[];
};
