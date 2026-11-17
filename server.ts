import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MODEL,
  DEFAULT_RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  formatApiError,
  parseAnalysisInput,
  runAnalysis,
} from "./supabase/functions/analyze/core.ts";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_NAME = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
// Same two values the browser uses. When both are set, sign-in is required.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const supabaseAuth =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const RATE_LIMIT_MAX_REQUESTS =
  Number(process.env.RATE_LIMIT_MAX) || DEFAULT_RATE_LIMIT_MAX;
// Sliding window per signed-in user, or per IP when sign-in is off. In-memory, so it resets on restart and is per-instance.
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (requestLog.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(ip, recent);
    return true;
  }
  recent.push(now);
  requestLog.set(ip, recent);
  if (requestLog.size > 5000) {
    for (const [key, times] of requestLog) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) {
        requestLog.delete(key);
      }
    }
  }
  return false;
}

function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
async function startServer(): Promise<void> {
  const app = express();
  // Behind a single reverse proxy (Cloud Run etc.) so req.ip is the real client.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      model: MODEL_NAME,
      apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      signInRequired: Boolean(supabaseAuth),
    });
  });

  app.post("/api/analyze", async (req: Request, res: Response) => {
    const parsed = parseAnalysisInput(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { rawIdea, clarification } = parsed.input;

    let userId: string | null = null;
    if (supabaseAuth) {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const { data, error } = token
        ? await supabaseAuth.auth.getUser(token)
        : { data: { user: null }, error: null };
      if (error || !data.user) {
        res.status(401).json({
          error: "Your session has expired. Sign in again to run an analysis.",
        });
        return;
      }
      userId = data.user.id;
    }

    if (isRateLimited(userId ?? req.ip ?? "unknown")) {
      res.status(429).json({
        error: "Too many analyses in a short time. Wait a few minutes and try again.",
      });
      return;
    }

    // res "close" fires when the connection drops; req "close" fires as soon as
    // the request body has been read, so it cannot be used to detect disconnects.
    let clientDisconnected = false;
    res.on("close", () => {
      if (!res.writableEnded) clientDisconnected = true;
    });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    try {
      await runAnalysis({
        apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
        model: MODEL_NAME,
        rawIdea,
        clarification,
        emit: (event, data) => sendSseEvent(res, event, data),
        isCancelled: () => clientDisconnected,
      });
      res.end();
    } catch (err) {
      const errorMessage = formatApiError(err, MODEL_NAME);
      sendSseEvent(res, "error", { error: errorMessage });
      res.end();
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*path}", (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`FORGE server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
