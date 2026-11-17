// Picks the job a request asks for. Both jobs stream server-sent events and
// share the same sign-in check and rate limit.
import type { Llm } from "./llm.ts";
import type { WebSearch } from "./search.ts";
import { parseAnalyzeInput, runAnalysis, type Emit } from "./analysis.ts";
import { parseSprintInput, runSprint } from "./sprint.ts";

export interface JobDeps {
  llm: Llm;
  search: WebSearch | null;
  isCancelled: () => boolean;
}

export type Job = (deps: JobDeps, emit: Emit) => Promise<void>;

export function prepareJob(
  body: unknown
): { ok: true; run: Job } | { ok: false; error: string } {
  const mode =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).mode
      : undefined;
  if (mode === "sprint") {
    const parsed = parseSprintInput(body);
    if (!parsed.ok) return parsed;
    return { ok: true, run: (deps, emit) => runSprint(parsed.input, deps, emit) };
  }
  const parsed = parseAnalyzeInput(body);
  if (!parsed.ok) return parsed;
  return { ok: true, run: (deps, emit) => runAnalysis(parsed.input, deps, emit) };
}
