// Self-hosted FORGE server: serves the built site and the analysis API.
// The hosted version runs the same pipeline from supabase/functions/analyze.
import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import {
  createMemoryRateLimiter,
  DEFAULT_RATE_LIMIT_MAX,
  MESSAGES,
  verifyUser,
} from "./supabase/functions/_shared/access.ts";
import { createLlmChain, describeChain } from "./supabase/functions/_shared/llm.ts";
import { createSearch } from "./supabase/functions/_shared/search.ts";
import { prepareJob } from "./supabase/functions/_shared/router.ts";

const PORT = Number(process.env.PORT) || 3000;
// Gemini first when GEMINI_API_KEY is set, then the OpenAI-compatible provider.
const llm = createLlmChain(process.env);
const search = createSearch(process.env);

// Same two values the browser uses. When both are set, sign-in is required.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const signInRequired = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Per signed-in user, or per IP when sign-in is off. Resets on restart.
const allowRun = createMemoryRateLimiter(
  Number(process.env.RATE_LIMIT_MAX) || DEFAULT_RATE_LIMIT_MAX
);

async function startServer(): Promise<void> {
  const app = express();
  // Behind a single reverse proxy (Cloud Run etc.) so req.ip is the real client.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      provider: llm.label,
      model: llm.model,
      providers: describeChain(process.env),
      apiKeyConfigured: llm.keyConfigured,
      webSearch: Boolean(search ?? llm.research),
      signInRequired,
    });
  });

  app.post("/api/analyze", async (req: Request, res: Response) => {
    const job = prepareJob(req.body);
    if (!job.ok) {
      res.status(400).json({ error: job.error });
      return;
    }

    let userId: string | null = null;
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const user = await verifyUser(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        req.headers.authorization
      );
      if (user.status === "unreachable") {
        res.status(503).json({ error: MESSAGES.authUnreachable });
        return;
      }
      if (user.status === "invalid") {
        res.status(401).json({ error: MESSAGES.sessionExpired });
        return;
      }
      userId = user.userId;
    }

    if (!allowRun(userId ?? req.ip ?? "unknown")) {
      res.status(429).json({ error: MESSAGES.rateLimited });
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

    await job.run(
      { llm, search, isCancelled: () => clientDisconnected },
      (event, data) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    );
    res.end();
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, "dist");
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
