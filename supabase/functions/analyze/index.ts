// Hosted FORGE API.
//   GET                      health
//   POST ?action=enqueue     queue an analysis or sprint as a Nexus job (sign-in)
//   POST ?action=tick        run the next step of a queued job (scheduler)
//   POST ?action=chat        Ask FORGE: answer one founder message (sign-in)
//   POST ?action=telegram_link   one-time link to connect Telegram (sign-in)
//   POST ?action=telegram    Telegram webhook (checked by secret header)
//   POST ?action=brief       send today's Telegram morning briefs (scheduler)
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
import { formatApiError } from "../_shared/analysis.ts";
import {
  closeAnsweredJob,
  Db,
  enqueueJob,
  processNextJob,
  validateJobInput,
} from "../_shared/nexus.ts";
import { askForge, chatRateLimited, MAX_CHAT_MESSAGE } from "../_shared/forge_chat.ts";
import {
  createTelegramLink,
  handleTelegramUpdate,
  sendBriefs,
  webhookSecret,
} from "../_shared/telegram.ts";
import {
  feedbackRateLimited,
  notificationChannels,
  notifyTeam,
  parseFeedback,
  saveFeedback,
} from "../_shared/feedback.ts";

// Supabase's runtime keeps a request's background work alive with this.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const env = Deno.env.toObject();

// The free plan stops a worker 150 s after it starts, whatever it is doing,
// and a worker may serve several requests. Steps are budgeted against that.
const WORKER_STARTED = Date.now();
const WORKER_LIMIT_MS = 150_000;
/** Time kept back for recording the outcome before the worker is stopped. */
const SAFETY_MS = 12_000;
/** Longest a single step may run even in a fresh worker. */
const STEP_MAX_MS = 125_000;

function stepDeadline(): number {
  return Math.min(
    Date.now() + STEP_MAX_MS,
    WORKER_STARTED + WORKER_LIMIT_MS - SAFETY_MS,
  );
}

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
const FUNCTION_URL = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/analyze`;
const TICK_URL = `${FUNCTION_URL}?action=tick`;
const TELEGRAM_TOKEN = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
const APP_URL = env.APP_URL?.trim() || "https://nivenvasolela-creator.github.io/forgeog/";

/** Keeps background work alive after the response is sent (awaits it locally). */
async function inBackground(work: Promise<unknown>): Promise<void> {
  const safe = work.catch((err) => console.error("background work failed:", err));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(safe);
  else await safe;
}

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
      telegram: Boolean(TELEGRAM_TOKEN),
      feedbackNotifications: notificationChannels(env),
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const action = new URL(req.url).searchParams.get("action");

  // Nexus tick: run the next step of one due job. Needs no sign-in: it takes
  // no input and only advances work signed-in users already queued.
  if (action === "tick") {
    // Callers hang up after a few seconds, so answer at once and do the
    // work in the background (it may run up to the hosted time limit).
    const work = processNextJob(db, { llm, search }, stepDeadline())
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

  // Telegram webhook: Telegram proves itself with the secret set in setWebhook.
  if (action === "telegram") {
    if (!TELEGRAM_TOKEN) return json({ ok: false }, 404);
    const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (given !== (await webhookSecret(TELEGRAM_TOKEN))) return json({ ok: false }, 401);
    const update = await req.json().catch(() => null);
    // Answer Telegram at once (or it re-sends the update) and reply in the background.
    await inBackground(
      handleTelegramUpdate(update, { db, token: TELEGRAM_TOKEN, appUrl: APP_URL, llm, search })
    );
    return json({ ok: true });
  }

  // Morning brief: sends each linked founder at most one brief a day, so it
  // needs no sign-in; extra calls send nothing.
  if (action === "brief") {
    if (!TELEGRAM_TOKEN) return json({ sent: 0, telegram: false });
    await inBackground(
      sendBriefs(db, TELEGRAM_TOKEN, APP_URL).then((n) => console.log(`briefs sent: ${n}`))
    );
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

  const record = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;

  // Ask FORGE: one message in, one answer out (both saved to the chat history).
  if (action === "chat") {
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (!message) return json({ error: "Type a question first." }, 400);
    if (message.length > MAX_CHAT_MESSAGE) {
      return json({ error: `Keep your message under ${MAX_CHAT_MESSAGE} characters.` }, 400);
    }
    if (await chatRateLimited(db, user.userId)) {
      return json({ error: MESSAGES.rateLimited }, 429);
    }
    const ideaId =
      typeof record.ideaId === "string" && /^[0-9a-f-]{36}$/i.test(record.ideaId)
        ? record.ideaId
        : null;
    try {
      const answer = await askForge({
        db,
        llm,
        search,
        userId: user.userId,
        message,
        ideaId,
        language: record.language === "sw" ? "sw" : record.language === "en" ? "en" : undefined,
        channel: "web",
      });
      return json(answer);
    } catch (err) {
      console.error("ask forge failed:", err);
      return json({ error: formatApiError(err, llm) }, 502);
    }
  }

  // Feedback: saved for the admin inbox, and a copy sent to the team.
  if (action === "feedback") {
    const input = parseFeedback(record);
    if (typeof input === "string") return json({ error: input }, 400);
    if (await feedbackRateLimited(db, user.userId)) {
      return json({ error: "Thanks! You've sent a lot already; try again in a while." }, 429);
    }
    await saveFeedback(db, user.userId, input);
    await inBackground(notifyTeam(env, input, user.email));
    return json({ ok: true });
  }

  // Connect Telegram: a one-time t.me link that ties the chat to this account.
  if (action === "telegram_link") {
    if (!TELEGRAM_TOKEN) {
      return json({ error: "Telegram is not set up on this server yet." }, 503);
    }
    try {
      return json(
        await createTelegramLink(db, TELEGRAM_TOKEN, `${FUNCTION_URL}?action=telegram`, user.userId)
      );
    } catch (err) {
      console.error("telegram link failed:", err);
      return json({ error: "Could not reach Telegram. Try again in a moment." }, 502);
    }
  }

  // Nexus enqueue: save the work as a job and return at once; the browser
  // watches the job row and may close without stopping it.
  if (action === "enqueue") {
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
