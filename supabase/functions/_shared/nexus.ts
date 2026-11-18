// Nexus: FORGE's background engine. Work is stored as rows in the `jobs`
// table and run one short step at a time, so a job survives closed browsers,
// the hosted 150 s request limit and model quota errors (it waits and tries
// again). Runtime-neutral: plain fetch against Supabase's REST API.
import type { Llm } from "./llm.ts";
import { isQuotaOrOverload } from "./llm.ts";
import type { WebSearch } from "./search.ts";
import {
  formatApiError,
  parseAnalyzeInput,
  stepAnalyst,
  stepClarity,
  stepScout,
  stepSkepticSafe,
  type ForgeReport,
  type ScoutResult,
} from "./analysis.ts";
import { buildSprint, parseSprintInput } from "./sprint.ts";

export type JobKind = "analyze" | "sprint";
export type JobStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "done"
  | "failed";

export interface JobRow {
  id: string;
  user_id: string;
  kind: JobKind;
  status: JobStatus;
  step: string;
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  attempts: number;
}

/** Thin client for Supabase's REST API using the service role key. */
export class Db {
  constructor(
    private url: string,
    private serviceKey: string,
  ) {}

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const res = await fetch(`${this.url.replace(/\/+$/, "")}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`Database error ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  select<T>(table: string, query: string): Promise<T[]> {
    return this.request(`${table}?${query}`) as Promise<T[]>;
  }

  insert<T>(table: string, rows: unknown, onConflict?: string): Promise<T[]> {
    return this.request(
      `${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(rows),
        headers: onConflict
          ? { Prefer: "return=representation,resolution=merge-duplicates" }
          : {},
      },
    ) as Promise<T[]>;
  }

  update(table: string, query: string, patch: unknown): Promise<unknown> {
    return this.request(`${table}?${query}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  rpc<T>(fn: string, args: unknown = {}): Promise<T> {
    return this.request(`rpc/${fn}`, {
      method: "POST",
      body: JSON.stringify(args),
    }) as Promise<T>;
  }
}

/** Saves a new job and returns its id. */
export async function enqueueJob(
  db: Db,
  userId: string,
  kind: JobKind,
  input: Record<string, unknown>,
): Promise<string> {
  const [row] = await db.insert<{ id: string }>("jobs", {
    user_id: userId,
    kind,
    input,
    status: "queued",
    step: "start",
  });
  return row.id;
}

/** Closes a job that was waiting for the founder's answer, once they have answered it. */
export async function closeAnsweredJob(
  db: Db,
  userId: string,
  jobId: string,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return;
  await db.update(
    "jobs",
    `id=eq.${jobId}&user_id=eq.${userId}&status=eq.needs_input`,
    {
      status: "done",
      updated_at: new Date().toISOString(),
    },
  );
}

/** Checks a job's input before it is queued. Returns an error message or null. */
export function validateJobInput(kind: unknown, input: unknown): string | null {
  if (kind === "analyze") {
    const parsed = parseAnalyzeInput(input);
    return parsed.ok ? null : parsed.error;
  }
  if (kind === "sprint") {
    const parsed = parseSprintInput(input);
    if (!parsed.ok) return parsed.error;
    const ideaId = (input as Record<string, unknown>).ideaId;
    return typeof ideaId === "string" && ideaId
      ? null
      : "Save the idea before building a sprint.";
  }
  return "Unknown job type.";
}

const MAX_QUOTA_WAITS = 6;
const QUOTA_WAIT_MS = 10 * 60 * 1000;
const MAX_FAILURES = 3;
const FAILURE_WAIT_MS = 60 * 1000;

function deriveTitle(report: ForgeReport, rawIdea: string): string {
  const candidate = report.idea_title || report.idea_summary || rawIdea.trim();
  const firstLine = candidate.split("\n")[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

/** Stores a finished report: a new idea, or the next version of an existing one. */
async function saveReport(
  db: Db,
  job: JobRow,
  report: ForgeReport,
): Promise<string> {
  const input = job.input;
  const rawIdea = String(input.rawIdea ?? "").trim();
  const clarification =
    typeof input.clarification === "string" ? input.clarification.trim() : "";
  const title = deriveTitle(report, rawIdea);
  let ideaId = typeof input.ideaId === "string" ? input.ideaId : "";

  if (ideaId) {
    const owned = await db.select<{ id: string }>(
      "ideas",
      `id=eq.${ideaId}&user_id=eq.${job.user_id}&select=id`,
    );
    if (owned.length === 0) ideaId = "";
  }
  const isNew = !ideaId;
  if (isNew) {
    const [idea] = await db.insert<{ id: string }>("ideas", {
      user_id: job.user_id,
      title,
    });
    ideaId = idea.id;
  } else {
    await db.update("ideas", `id=eq.${ideaId}`, {
      title,
      updated_at: new Date().toISOString(),
    });
  }
  await db.insert("reports", {
    idea_id: ideaId,
    user_id: job.user_id,
    raw_idea: rawIdea,
    clarification: clarification || null,
    data: report,
  });
  // A brand-new idea starts with the report's suggested tests as its plan.
  const tests = report.blueprint.validate_next
    .map((t) => t.trim().slice(0, 500))
    .filter(Boolean);
  if (isNew && tests.length > 0) {
    await db.insert(
      "experiments",
      tests.map((title) => ({ idea_id: ideaId, user_id: job.user_id, title })),
    );
  }
  return ideaId;
}

type StepOutcome =
  | { next: string; state: Record<string, unknown> }
  | { status: "needs_input" | "done"; result: Record<string, unknown> };

async function runStep(
  job: JobRow,
  deps: { llm: Llm; search: WebSearch | null },
  db: Db,
): Promise<StepOutcome> {
  if (job.kind === "sprint") {
    const parsed = parseSprintInput(job.input);
    if (!parsed.ok) throw new Error(parsed.error);
    const ideaId = String(job.input.ideaId ?? "");
    const owned = await db.select<{ id: string }>(
      "ideas",
      `id=eq.${ideaId}&user_id=eq.${job.user_id}&select=id`,
    );
    if (owned.length === 0) throw new Error("That idea no longer exists.");
    const plan = await buildSprint(parsed.input, deps.llm);
    await db.insert(
      "sprints",
      {
        idea_id: ideaId,
        user_id: job.user_id,
        data: { plan, done: [] },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      "idea_id",
    );
    return { status: "done", result: { ideaId } };
  }

  const parsed = parseAnalyzeInput(job.input);
  if (!parsed.ok) throw new Error(parsed.error);
  const input = parsed.input;
  const state = job.state;

  switch (job.step) {
    case "start": {
      const question = await stepClarity(input, deps.llm);
      if (question) return { status: "needs_input", result: { question } };
      return { next: "scout", state };
    }
    case "scout": {
      const scout = await stepScout(input, deps);
      return { next: "analyst", state: { ...state, scout } };
    }
    case "analyst": {
      const report = await stepAnalyst(
        input,
        state.scout as ScoutResult,
        deps.llm,
      );
      return { next: "skeptic", state: { ...state, report } };
    }
    case "skeptic": {
      const checked = await stepSkepticSafe(
        input,
        state.scout as ScoutResult,
        state.report as ForgeReport,
        deps.llm,
        isQuotaOrOverload,
      );
      const ideaId = await saveReport(db, job, checked);
      return { status: "done", result: { ideaId } };
    }
    default:
      throw new Error(`Unknown step "${job.step}".`);
  }
}

/**
 * Claims one due job and runs its next step. Returns false when there was
 * nothing to do. Never throws for a job's own failure; it is recorded on the job.
 */
export async function processNextJob(
  db: Db,
  deps: { llm: Llm; search: WebSearch | null },
): Promise<boolean> {
  const claimed = await db.rpc<JobRow[]>("nexus_claim_job");
  const job = Array.isArray(claimed) ? claimed[0] : undefined;
  if (!job) return false;

  const now = () => new Date().toISOString();
  try {
    const outcome = await runStep(job, deps, db);
    if ("next" in outcome) {
      await db.update("jobs", `id=eq.${job.id}`, {
        status: "queued",
        step: outcome.next,
        state: outcome.state,
        attempts: 0,
        error: null,
        run_after: now(),
        updated_at: now(),
      });
    } else {
      await db.update("jobs", `id=eq.${job.id}`, {
        status: outcome.status,
        result: outcome.result,
        state: {},
        error: null,
        updated_at: now(),
      });
    }
  } catch (err) {
    const quota = isQuotaOrOverload(err);
    const attempts = job.attempts + 1;
    const giveUp = quota
      ? attempts >= MAX_QUOTA_WAITS
      : attempts >= MAX_FAILURES;
    await db.update("jobs", `id=eq.${job.id}`, {
      status: giveUp ? "failed" : "queued",
      attempts,
      error: quota ? "quota" : formatApiError(err, deps.llm).slice(0, 500),
      run_after: new Date(
        Date.now() + (quota ? QUOTA_WAIT_MS : FAILURE_WAIT_MS),
      ).toISOString(),
      updated_at: now(),
    });
  }
  return true;
}
