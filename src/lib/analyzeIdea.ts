import type { FounderProfile } from "./profile";
import type { Language } from "./i18n";

export const STRESS_TEST_PHASES = [
  "Problem",
  "Customer",
  "Market",
  "Competition",
  "Business Model",
  "Execution Risk",
] as const;

export type StressTestPhase = (typeof STRESS_TEST_PHASES)[number];

export interface ForgeCompetitor {
  name: string;
  what_they_do: string;
  source_url: string;
}

export interface ForgeSource {
  title: string;
  url: string;
}

export interface ForgeReportData {
  /** Short name for the idea. Missing on reports saved before workspaces existed. */
  idea_title?: string;
  idea_summary: string;
  idea_score: {
    overall: number;
    breakdown: {
      problem_clarity: number;
      market_signal: number;
      founder_fit: number;
      feasibility: number;
      differentiation: number;
    };
    confidence: "low" | "medium" | "high";
    rationale: string;
  };
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  competitors: ForgeCompetitor[];
  blueprint: {
    problem: string;
    target_user: string;
    solution: string;
    business_model: string;
    key_risks: string[];
    validate_next: string[];
  };
  business_plan: {
    tam_estimate: string;
    assumptions: string[];
    go_to_market: string;
    pricing_hypothesis: string;
  };
  /** FORGE's call on the idea. Missing on reports made before decisions existed. */
  decision?: ForgeDecision;
  grounding_flags: string[];
  sources: ForgeSource[];
}

export type DecisionCall = "go" | "pivot" | "kill";

export interface ForgeDecision {
  call: DecisionCall;
  reason: string;
  /** Sharper alternative ideas; empty for "go". */
  pivots: string[];
}

export interface SprintTask {
  title: string;
  why: string;
  steps: string[];
  material_title: string;
  material: string;
}

export interface SprintDay {
  day: number;
  theme: string;
  tasks: SprintTask[];
}

export interface SprintPlan {
  goal: string;
  success_metric: string;
  days: SprintDay[];
}

/** The current 7-day plan for an idea and which of its tasks are done. */
export interface Sprint {
  plan: SprintPlan;
  /** Keys of finished tasks, "day-task" with zero-based task index, e.g. "1-0". */
  done: string[];
  createdAt: string;
}

export function sprintTaskKey(day: number, taskIndex: number): string {
  return `${day}-${taskIndex}`;
}

export function sprintTotals(sprint: Sprint): { done: number; total: number } {
  const keys = new Set(
    sprint.plan.days.flatMap((d) =>
      d.tasks.map((_, i) => sprintTaskKey(d.day, i)),
    ),
  );
  return {
    done: sprint.done.filter((k) => keys.has(k)).length,
    total: keys.size,
  };
}

export interface StoredForgeReport {
  id: string;
  createdAt: string;
  rawIdea: string;
  clarification?: string;
  data: ForgeReportData;
}

/** One analysis run of an idea. */
export type IdeaVersion = StoredForgeReport;

export type ExperimentStatus = "todo" | "running" | "done";
export type ExperimentOutcome = "supported" | "refuted" | "inconclusive";

/** One thing the founder is doing to test the idea in the real world. */
export interface Experiment {
  id: string;
  title: string;
  status: ExperimentStatus;
  /** Only meaningful once status is "done". */
  outcome: ExperimentOutcome | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** A finished experiment, sent with a re-run so the new report can weigh it. */
export interface EvidenceItem {
  title: string;
  outcome: ExperimentOutcome;
  notes: string;
}

export function completedEvidence(experiments: Experiment[]): EvidenceItem[] {
  return experiments.flatMap((e) =>
    e.status === "done" && e.outcome
      ? [{ title: e.title, outcome: e.outcome, notes: e.notes }]
      : [],
  );
}

/** A workspace: one idea, every report run against it, and its validation plan. */
export interface Idea {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Newest first. */
  versions: IdeaVersion[];
  /** Oldest first. */
  experiments: Experiment[];
  /** The idea's 7-day launch sprint, once one has been built. */
  sprint: Sprint | null;
}

export type AnalyzeIdeaResult =
  | { status: "clarification_needed"; question: string }
  | { status: "complete"; report: ForgeReportData };

export interface AnalyzeIdeaOptions {
  clarification?: string;
  onPhase?: (phaseIndex: number) => void;
  /** Finished experiments for the model to weigh when re-running an idea. */
  evidence?: EvidenceItem[];
  /** Supabase access token; required by the server when sign-in is enabled. */
  accessToken?: string;
  timeoutMs?: number;
  profile?: FounderProfile | null;
  language?: Language;
}

// The hosted build points this at the Supabase Edge Function; self-hosted
// builds use the Node server on the same origin.
const ANALYZE_URL = import.meta.env.VITE_API_URL?.trim() || "/api/analyze";

type StreamEvent = { name: string; payload: Record<string, unknown> };

/**
 * The connection closed before FORGE sent a result. The hosted API stops a
 * worker 150 s after it starts, which can cut off a request it is still
 * serving; a second try normally lands on a fresh worker.
 */
class StreamCutError extends Error {}

const MAX_STREAM_ATTEMPTS = 2;

async function withStreamRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof StreamCutError) || attempt >= MAX_STREAM_ATTEMPTS)
        throw err;
    }
  }
}

/**
 * POSTs a job to the FORGE API and reads its server-sent events until the
 * stream ends. onEvent may return a value to finish with; "error" events throw.
 */
async function streamJob<T>(
  body: Record<string, unknown>,
  accessToken: string | undefined,
  timeoutMs: number,
  onEvent: (event: StreamEvent) => T | undefined,
): Promise<T> {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}.`;
      try {
        const errBody = (await response.json()) as { error?: string };
        if (errBody?.error) message = errBody.error;
      } catch {
        // Ignore JSON parse errors on non-JSON error responses
      }
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("Server returned an empty response stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: T | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        let name = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:"))
            dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const payload = JSON.parse(dataLines.join("\n")) as Record<
          string,
          unknown
        >;
        if (name === "error") {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "The request failed unexpectedly.",
          );
        }
        const outcome = onEvent({ name, payload });
        if (outcome !== undefined) result = outcome;
      }
    }

    if (result === undefined) {
      throw new StreamCutError(
        "The connection ended before FORGE finished. Please try again.",
      );
    }
    return result;
  } catch (err) {
    if (err instanceof StreamCutError) throw err;
    if (didTimeout) {
      throw new Error(
        "The request timed out before FORGE finished. Please try again.",
      );
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("The request was cancelled.");
    }
    // A dropped connection mid-stream surfaces as a TypeError from fetch.
    if (err instanceof TypeError) {
      throw new StreamCutError(
        "The connection to FORGE dropped. Please try again.",
      );
    }
    if (err instanceof Error) throw err;
    throw new Error("Unable to reach FORGE. Please try again.");
  } finally {
    window.clearTimeout(timer);
  }
}

export async function analyzeIdea(
  rawIdea: string,
  options: AnalyzeIdeaOptions = {},
): Promise<AnalyzeIdeaResult> {
  const trimmedIdea = rawIdea.trim();
  if (!trimmedIdea) {
    throw new Error(
      "Enter your startup idea first so there is something to test.",
    );
  }
  return withStreamRetry(() =>
    streamJob<AnalyzeIdeaResult>(
      {
        rawIdea: trimmedIdea,
        clarification: options.clarification?.trim() || undefined,
        evidence: options.evidence?.length ? options.evidence : undefined,
        profile: options.profile ?? undefined,
        language: options.language ?? "en",
      },
      options.accessToken,
      options.timeoutMs ?? 180_000,
      ({ name, payload }) => {
        if (name === "phase") {
          const idx = Number(payload.phaseIndex);
          if (Number.isFinite(idx)) options.onPhase?.(idx);
        } else if (name === "clarification") {
          const question =
            typeof payload.question === "string" ? payload.question.trim() : "";
          if (!question)
            throw new Error("Received an invalid clarifying question.");
          return { status: "clarification_needed", question };
        } else if (name === "report") {
          const report = payload.report as ForgeReportData | undefined;
          if (!report || !report.idea_score) {
            throw new Error("Received an incomplete report from the server.");
          }
          return { status: "complete", report };
        }
        return undefined;
      },
    ),
  );
}

export interface BuildSprintOptions {
  accessToken?: string;
  profile?: FounderProfile | null;
  language?: Language;
}

/** Asks FORGE for a 7-day launch sprint based on the idea's latest report. */
export async function buildSprintPlan(
  idea: Idea,
  options: BuildSprintOptions = {},
): Promise<SprintPlan> {
  const latest = idea.versions[0];
  const { data } = latest;
  const decision = data.decision
    ? `${data.decision.call.toUpperCase()}: ${data.decision.reason}`
    : "";
  const blueprint = [
    `Problem: ${data.blueprint.problem}`,
    `Target user: ${data.blueprint.target_user}`,
    `Solution: ${data.blueprint.solution}`,
    `Business model: ${data.blueprint.business_model}`,
    `Go-to-market: ${data.business_plan.go_to_market}`,
    `Pricing hypothesis: ${data.business_plan.pricing_hypothesis}`,
  ].join("\n");
  const doneTasks = [
    ...idea.experiments.filter((e) => e.status === "done").map((e) => e.title),
  ];
  return withStreamRetry(() =>
    streamJob<SprintPlan>(
      {
        mode: "sprint",
        ideaTitle: idea.title,
        ideaSummary: data.idea_summary || latest.rawIdea,
        decision,
        blueprint,
        validateNext: data.blueprint.validate_next,
        doneTasks,
        profile: options.profile ?? undefined,
        language: options.language ?? "en",
      },
      options.accessToken,
      180_000,
      ({ name, payload }) => {
        if (name !== "sprint") return undefined;
        const plan = payload.plan as SprintPlan | undefined;
        if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) {
          throw new Error("Received an incomplete plan from the server.");
        }
        return plan;
      },
    ),
  );
}
