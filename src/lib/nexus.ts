// Client side of Nexus, FORGE's background engine. Analyses and sprints are
// queued as jobs on the hosted API; the browser watches the job row and can be
// closed without stopping the work.
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobKind = "analyze" | "sprint";
export type JobStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "done"
  | "failed";

export interface NexusJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  step: string;
  result: { ideaId?: string; question?: string } | null;
  /** "quota" while waiting for model quota; otherwise a message for the founder. */
  error: string | null;
  input: {
    rawIdea?: string;
    clarification?: string;
    ideaId?: string;
    ideaTitle?: string;
  } | null;
  created_at: string;
}

const API_URL = import.meta.env.VITE_API_URL?.trim() ?? "";

/** Nexus runs on the hosted API only; self-hosted builds stream instead. */
export function nexusAvailable(sb: SupabaseClient | null): boolean {
  return Boolean(sb && API_URL);
}

const JOB_COLUMNS = "id, kind, status, step, result, error, input, created_at";
const POLL_MS = 2500;

export function isFinished(job: NexusJob): boolean {
  return (
    job.status === "done" ||
    job.status === "failed" ||
    job.status === "needs_input"
  );
}

/** Analysis steps in order, mapped to the working screen's six phases. */
export function phaseForStep(step: string): number {
  if (step === "scout") return 3;
  if (step === "analyst") return 4;
  if (step === "skeptic") return 5;
  return 0;
}

export async function enqueueJob(
  sb: SupabaseClient,
  kind: JobKind,
  input: Record<string, unknown>,
  /** A job whose clarifying question this one answers; it is closed. */
  replacesJobId?: string,
): Promise<string> {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again.");
  const response = await fetch(`${API_URL}?action=enqueue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ kind, input, replacesJobId }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    jobId?: string;
    error?: string;
  };
  if (!response.ok || !body.jobId) {
    throw new Error(
      body.error || `Request failed with status ${response.status}.`,
    );
  }
  return body.jobId;
}

export async function getJob(
  sb: SupabaseClient,
  jobId: string,
): Promise<NexusJob> {
  const { data, error } = await sb
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .single();
  if (error) throw new Error(error.message);
  return data as NexusJob;
}

/** Jobs still working or waiting for the founder's answer, oldest first. */
export async function listActiveJobs(sb: SupabaseClient): Promise<NexusJob[]> {
  const { data, error } = await sb
    .from("jobs")
    .select(JOB_COLUMNS)
    .in("status", ["queued", "running", "needs_input"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as NexusJob[];
}

/**
 * Polls a job until it finishes, reporting each update. Resolves with the
 * finished job, or null when `stopped()` turns true first.
 */
export async function watchJob(
  sb: SupabaseClient,
  jobId: string,
  onUpdate: (job: NexusJob) => void,
  stopped: () => boolean,
): Promise<NexusJob | null> {
  let failures = 0;
  while (!stopped()) {
    try {
      const job = await getJob(sb, jobId);
      failures = 0;
      onUpdate(job);
      if (isFinished(job)) return job;
    } catch (err) {
      // A brief network drop should not end the wait; a persistent one should.
      if (++failures >= 8) throw err;
    }
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
  }
  return null;
}
