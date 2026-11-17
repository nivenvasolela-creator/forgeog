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
  grounding_flags: string[];
  sources: ForgeSource[];
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
      : []
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
}

export async function analyzeIdea(
  rawIdea: string,
  options: AnalyzeIdeaOptions = {}
): Promise<AnalyzeIdeaResult> {
  const trimmedIdea = rawIdea.trim();
  if (!trimmedIdea) {
    throw new Error(
      "Enter your startup idea first so there is something to test."
    );
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 180_000;
  let didTimeout = false;

  const timer = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(options.accessToken
          ? { Authorization: `Bearer ${options.accessToken}` }
          : {}),
      },
      body: JSON.stringify({
        rawIdea: trimmedIdea,
        clarification: options.clarification?.trim() || undefined,
        evidence: options.evidence?.length ? options.evidence : undefined,
      }),
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
    let result: AnalyzeIdeaResult | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) continue;
        const payloadText = dataLines.join("\n");
        const payload = JSON.parse(payloadText) as Record<string, unknown>;

        if (eventName === "phase") {
          const idx = Number(payload.phaseIndex);
          if (Number.isFinite(idx)) {
            options.onPhase?.(idx);
          }
        } else if (eventName === "clarification") {
          const question =
            typeof payload.question === "string" ? payload.question.trim() : "";
          if (!question) {
            throw new Error("Received an invalid clarifying question.");
          }
          result = { status: "clarification_needed", question };
        } else if (eventName === "report") {
          const report = payload.report as ForgeReportData | undefined;
          if (!report || !report.idea_score) {
            throw new Error("Received an incomplete report from the server.");
          }
          result = { status: "complete", report };
        } else if (eventName === "error") {
          const errMsg =
            typeof payload.error === "string"
              ? payload.error
              : "Analysis failed unexpectedly.";
          throw new Error(errMsg);
        }
      }
    }

    if (!result) {
      throw new Error("The analysis stream ended before returning a report.");
    }

    return result;
  } catch (err) {
    if (didTimeout) {
      throw new Error(
        "The request timed out before analysis completed. Please try again."
      );
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Analysis was cancelled.");
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error("Unable to reach the analysis service. Please try again.");
  } finally {
    window.clearTimeout(timer);
  }
}
