// Hosted FORGE API.
//   GET                      health
//   POST ?action=enqueue     queue an analysis or sprint as a Nexus job (sign-in)
//   POST ?action=tick        run the next step of a queued job (scheduler)
//   POST                     run an analysis or sprint (body.mode = "sprint")
//                            and stream progress as server-sent events (sign-in)
import {
  DEFAULT_RATE_LIMIT_MAX,
  MESSAGES,
  recordRunInDatabase,
  verifyUser,
} from "../_shared/access.ts";
import { createLlmChain, describeChain } from "../_shared/llm.ts";
import { createSearch } from "../_shared/search.ts";
import { prepareJob } from "../_shared/router.ts";
import {
  closeAnsweredJob,
  Db,
  enqueueJob,
  processNextJob,
  validateJobInput,
} from "../_shared/nexus.ts";

// Supabase's runtime keeps a request's background work alive with this.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const env = Deno.env.toObject();

// Gemini first when GEMINI_API_KEY is set, then a free open model on
// OpenRouter; when one runs out of quota the next one takes over.
const llm = createLlmChain(env, {
  LLM_BASE_URL: "https://openrouter.ai/api/v1",
  LLM_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free",
});
const search = createSearch(env);

const SUPABASE_URL = env.SUPABASE_URL ?? "";
const PUBLIC_KEY = env.SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const RATE_LIMIT_MAX = Number(env.RATE_LIMIT_MAX) || DEFAULT_RATE_LIMIT_MAX;
const db = new Db(SUPABASE_URL, SERVICE_KEY);
const TICK_URL = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/analyze?action=tick`;

/** Starts another tick without waiting for it, so a job's steps run back to back. */
function kickNexus(): void {
  const call = fetch(TICK_URL, { method: "POST", signal: AbortSignal.timeout(5_000) }).catch(
    () => {
      // The per-minute schedule picks the work up anyway.
    }
  );
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(call);
}

// Requests carry a bearer token, never cookies, so any origin may call.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, accept, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    return json({
      ok: true,
      provider: llm.label,
      model: llm.model,
      providers: describeChain(env),
      apiKeyConfigured: llm.keyConfigured,
      webSearch: Boolean(search ?? llm.research),
      signInRequired: true,
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const action = new URL(req.url).searchParams.get("action");

  // Nexus tick: run the next step of one due job. Needs no sign-in: it takes
  // no input and only advances work signed-in users already queued.
  if (action === "tick") {
    // Callers hang up after a few seconds, so answer at once and do the
    // work in the background (it may run up to the hosted time limit).
    const work = processNextJob(db, { llm, search })
      .then((processed) => {
        if (processed) kickNexus();
      })
      .catch((err) => console.error("nexus tick failed:", err));
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(work);
      return json({ accepted: true });
    }
    await work;
    return json({ accepted: true });
  }

  const user = await verifyUser(
    SUPABASE_URL,
    PUBLIC_KEY,
    req.headers.get("authorization")
  );
  if (user.status === "unreachable") {
    return json({ error: MESSAGES.authUnreachable }, 503);
  }
  if (user.status === "invalid") {
    return json({ error: MESSAGES.sessionExpired }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "The request was not valid JSON." }, 400);
  }

  // Nexus enqueue: save the work as a job and return at once; the browser
  // watches the job row and may close without stopping it.
  if (action === "enqueue") {
    const record = (typeof body === "object" && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    const problem = validateJobInput(record.kind, record.input);
    if (problem) return json({ error: problem }, 400);
    const allowed = await recordRunInDatabase(SUPABASE_URL, SERVICE_KEY, user.userId, RATE_LIMIT_MAX);
    if (!allowed) return json({ error: MESSAGES.rateLimited }, 429);
    const jobId = await enqueueJob(
      db,
      user.userId,
      record.kind as "analyze" | "sprint",
      record.input as Record<string, unknown>
    );
    // Answering a job's clarifying question replaces that job.
    if (typeof record.replacesJobId === "string") {
      await closeAnsweredJob(db, user.userId, record.replacesJobId).catch(() => {});
    }
    kickNexus();
    return json({ jobId });
  }

  const job = prepareJob(body);
  if (!job.ok) return json({ error: job.error }, 400);

  const allowed = await recordRunInDatabase(
    SUPABASE_URL,
    SERVICE_KEY,
    user.userId,
    RATE_LIMIT_MAX
  );
  if (!allowed) return json({ error: MESSAGES.rateLimited }, 429);

  const encoder = new TextEncoder();
  let cancelled = false;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cancelled = true;
        }
      };
      // Comment lines keep proxies from closing a quiet connection.
      keepAlive = setInterval(() => write(": keep-alive\n\n"), 15_000);

      job.run(
        { llm, search, isCancelled: () => cancelled },
        (event, data) =>
          write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      ).finally(() => {
        clearInterval(keepAlive);
        if (!cancelled) {
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      });
    },
    cancel() {
      cancelled = true;
      clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
});
