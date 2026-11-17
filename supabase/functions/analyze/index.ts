// Hosted FORGE API: GET returns health, POST runs an analysis and streams
// progress as server-sent events. Sign-in is always required here.
import {
  DEFAULT_RATE_LIMIT_MAX,
  MESSAGES,
  recordRunInDatabase,
  verifyUser,
} from "../_shared/access.ts";
import { parseAnalyzeInput, runAnalysis } from "../_shared/analysis.ts";
import { createLlm } from "../_shared/llm.ts";
import { createSearch } from "../_shared/search.ts";

const env = Deno.env.toObject();

// With no provider configured, default to a free open model on OpenRouter.
const llm = createLlm(
  env.LLM_BASE_URL || env.GEMINI_API_KEY
    ? env
    : {
        ...env,
        LLM_BASE_URL: "https://openrouter.ai/api/v1",
        LLM_MODEL: env.LLM_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
      }
);
const search = createSearch(env);

const SUPABASE_URL = env.SUPABASE_URL ?? "";
const PUBLIC_KEY = env.SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const RATE_LIMIT_MAX = Number(env.RATE_LIMIT_MAX) || DEFAULT_RATE_LIMIT_MAX;

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
      apiKeyConfigured: llm.keyConfigured,
      webSearch: Boolean(search ?? llm.research),
      signInRequired: true,
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

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
  const parsed = parseAnalyzeInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

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

      runAnalysis(
        parsed.input,
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
