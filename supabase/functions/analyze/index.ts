// Hosted version of POST /api/analyze, for deployments with no Node server
// (GitHub Pages). Same request body and server-sent events as server.ts.
// Deployed with verify_jwt off: the function checks the caller's session itself
// so that CORS preflight requests, which carry no token, get through.
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_MODEL,
  DEFAULT_RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  formatApiError,
  parseAnalysisInput,
  runAnalysis,
} from "./core.ts";

const MODEL_NAME = Deno.env.get("GEMINI_MODEL")?.trim() || DEFAULT_MODEL;
const RATE_LIMIT_MAX =
  Number(Deno.env.get("RATE_LIMIT_MAX")) || DEFAULT_RATE_LIMIT_MAX;
const HEARTBEAT_MS = 15_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, accept, x-client-info",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Use POST." });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = parseAnalysisInput(body);
  if ("error" in parsed) return json(400, { error: parsed.error });

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const apiKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
  // Acts as the signed-in user, so row level security applies to every query.
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = token
    ? await supabase.auth.getUser(token)
    : { data: { user: null }, error: null };
  if (userError || !userData.user) {
    return json(401, {
      error: "Your session has expired. Sign in again to run an analysis.",
    });
  }

  // Sliding window per user, kept in Postgres because function instances
  // do not share memory.
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error: countError } = await supabase
    .from("analysis_runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", windowStart);
  if (countError) {
    return json(500, { error: "Could not check your usage. Try again." });
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return json(429, {
      error: "Too many analyses in a short time. Wait a few minutes and try again.",
    });
  }
  const { error: logError } = await supabase.from("analysis_runs").insert({});
  if (logError) {
    return json(500, { error: "Could not record this analysis. Try again." });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed || cancelled) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cancelled = true;
        }
      };
      const emit = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Comment lines keep the connection from being dropped as idle while
      // the model is thinking; the client ignores them.
      heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);

      runAnalysis({
        apiKey: Deno.env.get("GEMINI_API_KEY")?.trim() ?? "",
        model: MODEL_NAME,
        ...parsed.input,
        emit,
        isCancelled: () => cancelled,
      })
        .catch((err) => emit("error", { error: formatApiError(err, MODEL_NAME) }))
        .finally(() => {
          clearInterval(heartbeat);
          closed = true;
          if (!cancelled) controller.close();
        });
    },
    cancel() {
      cancelled = true;
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
});
