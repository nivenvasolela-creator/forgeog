import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@google/genai";
import { createLlm, type SchemaNode } from "./llm.ts";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const llm = createLlm();
// Same two values the browser uses. When both are set, sign-in is required.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const supabaseAuth =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const MAX_IDEA_CHARS = 6000;
const MAX_CLARIFICATION_CHARS = 2000;
const MAX_EVIDENCE_ITEMS = 25;
const EVIDENCE_OUTCOMES: Record<string, string> = {
  supported: "SUPPORTED the idea",
  refuted: "WENT AGAINST the idea",
  inconclusive: "INCONCLUSIVE",
};

/** Finished experiments sent by the client, cleaned and capped. */
function parseEvidence(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const lines: string[] = [];
  for (const item of input.slice(0, MAX_EVIDENCE_ITEMS)) {
    if (typeof item !== "object" || item === null) continue;
    const { title, outcome, notes } = item as Record<string, unknown>;
    const label = typeof outcome === "string" ? EVIDENCE_OUTCOMES[outcome] : undefined;
    if (typeof title !== "string" || !title.trim() || !label) continue;
    const cleanNotes =
      typeof notes === "string" ? notes.trim().slice(0, 1000) : "";
    lines.push(
      `- Experiment: ${title.trim().slice(0, 300)}\n  Result: ${label}\n  Founder's notes: ${cleanNotes || "(none given)"}`
    );
  }
  return lines;
}
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 10;

const ANALYSIS_SYSTEM_INSTRUCTION =
  "You are the analysis engine for FORGE, an AI idea validator. Ground the founder's idea in reality. Do not flatter and do not inflate scores. If the idea is weak, say so plainly and say why. Never state a market size, competitor revenue, or user count as fact unless it comes from a cited source or the founder. Any estimate must be labeled 'estimate' with its assumptions listed. Be direct, short sentences, no filler.";

interface VerifiedSource {
  title: string;
  url: string;
}

interface ClarityCheckResult {
  is_clear: boolean;
  clarifying_question: string;
}

interface RawCompetitor {
  name: string;
  what_they_do: string;
  source_index: number;
}

interface ReportCompetitor {
  name: string;
  what_they_do: string;
  source_url: string;
}

interface RawReport {
  idea_title: string;
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
  competitors: RawCompetitor[];
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
  sources: VerifiedSource[];
}

function isFatalApiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;

  if (status && [400, 401, 403, 404, 429].includes(status)) {
    return true;
  }
  return /API_KEY_INVALID|PERMISSION_DENIED|RESOURCE_EXHAUSTED|NOT_FOUND|UNAUTHENTICATED|401|403|429/i.test(
    message
  );
}

function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;

  if (status && [500, 502, 503, 504].includes(status)) {
    return true;
  }
  return /UNAVAILABLE|503|502|504|high demand|overloaded|ETIMEDOUT|ECONNRESET|valid JSON|empty response/i.test(
    message
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientError(err)) {
        const delayMs = 1000 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function formatApiError(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);

  if (message.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(message) as {
        error?: { message?: string; status?: string };
        message?: string;
      };
      message = parsed.error?.message || parsed.message || message;
    } catch {
      // Keep original message if not valid JSON
    }
  }

  if (/API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|403|401/i.test(message)) {
    return `${llm.label} rejected the API key. Check ${llm.keyVariable} on the server.`;
  }
  if (/RESOURCE_EXHAUSTED|429/i.test(message)) {
    return `${llm.label} rate limit or quota reached. Wait a moment and try again.`;
  }
  if (/NOT_FOUND|404/i.test(message)) {
    return `The model "${llm.model}" was not found or is unavailable on ${llm.label}.`;
  }
  if (/UNAVAILABLE|503|high demand/i.test(message)) {
    return `${llm.label} is overloaded right now. Click Retry in a few seconds.`;
  }
  return message || "Unexpected error during analysis.";
}

// Open models do not always honour the schema, so never trust a field's type.
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean);
}

function clamp(value: unknown, min: number, max: number): number {
  const num = typeof value === "string" ? Number(value) : (value as number);
  if (typeof num !== "number" || !Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

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

const CLARITY_SCHEMA: SchemaNode = {
  type: Type.OBJECT,
  properties: {
    is_clear: {
      type: Type.BOOLEAN,
      description:
        "True if the idea has enough detail about user, problem, or monetization to stress-test. False only if it is genuinely too vague to judge.",
    },
    clarifying_question: {
      type: Type.STRING,
      description:
        "Empty string when is_clear is true. Otherwise, exactly one short direct question asking about the missing user, problem, or way to make money.",
    },
  },
  required: ["is_clear", "clarifying_question"],
};

const REPORT_SCHEMA: SchemaNode = {
  type: Type.OBJECT,
  properties: {
    idea_title: {
      type: Type.STRING,
      description:
        "Plain 3-7 word name for the idea, like a project title. No hype, no trailing punctuation.",
    },
    idea_summary: {
      type: Type.STRING,
      description: "Plain 1-2 sentence summary of the startup idea.",
    },
    idea_score: {
      type: Type.OBJECT,
      properties: {
        overall: {
          type: Type.INTEGER,
          description: "Overall viability score from 0 to 100. Do not inflate.",
        },
        breakdown: {
          type: Type.OBJECT,
          properties: {
            problem_clarity: { type: Type.NUMBER, description: "0 to 10" },
            market_signal: { type: Type.NUMBER, description: "0 to 10" },
            founder_fit: { type: Type.NUMBER, description: "0 to 10" },
            feasibility: { type: Type.NUMBER, description: "0 to 10" },
            differentiation: { type: Type.NUMBER, description: "0 to 10" },
          },
          required: [
            "problem_clarity",
            "market_signal",
            "founder_fit",
            "feasibility",
            "differentiation",
          ],
        },
        confidence: {
          type: Type.STRING,
          enum: ["low", "medium", "high"],
          description: "Confidence in this evaluation based on available facts.",
        },
        rationale: {
          type: Type.STRING,
          description: "Direct plain-language verdict explaining the overall score.",
        },
      },
      required: ["overall", "breakdown", "confidence", "rationale"],
    },
    swot: {
      type: Type.OBJECT,
      properties: {
        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
        weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
        opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
        threats: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["strengths", "weaknesses", "opportunities", "threats"],
    },
    competitors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          what_they_do: { type: Type.STRING },
          source_index: {
            type: Type.INTEGER,
            description:
              "The number of the entry in the VERIFIED SOURCES list that backs this competitor, or 0 if no listed source backs it.",
          },
        },
        required: ["name", "what_they_do", "source_index"],
      },
    },
    blueprint: {
      type: Type.OBJECT,
      properties: {
        problem: { type: Type.STRING },
        target_user: { type: Type.STRING },
        solution: { type: Type.STRING },
        business_model: { type: Type.STRING },
        key_risks: { type: Type.ARRAY, items: { type: Type.STRING } },
        validate_next: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        "problem",
        "target_user",
        "solution",
        "business_model",
        "key_risks",
        "validate_next",
      ],
    },
    business_plan: {
      type: Type.OBJECT,
      properties: {
        tam_estimate: {
          type: Type.STRING,
          description: "Explicitly labeled estimate of addressable market with reasoning.",
        },
        assumptions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Key assumptions underlying any estimates.",
        },
        go_to_market: { type: Type.STRING },
        pricing_hypothesis: {
          type: Type.STRING,
          description: "Explicitly labeled estimate/hypothesis for pricing.",
        },
      },
      required: [
        "tam_estimate",
        "assumptions",
        "go_to_market",
        "pricing_hypothesis",
      ],
    },
    grounding_flags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "List of claims, competitor details, or market numbers that could not be verified from search sources.",
    },
    sources: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          url: { type: Type.STRING },
        },
        required: ["title", "url"],
      },
    },
  },
  required: [
    "idea_title",
    "idea_summary",
    "idea_score",
    "swot",
    "competitors",
    "blueprint",
    "business_plan",
    "grounding_flags",
    "sources",
  ],
};

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
      apiKeyConfigured: llm.keyConfigured,
      webSearch: Boolean(llm.research),
      signInRequired: Boolean(supabaseAuth),
    });
  });

  app.post("/api/analyze", async (req: Request, res: Response) => {
    const rawIdea =
      typeof req.body?.rawIdea === "string" ? req.body.rawIdea.trim() : "";
    const clarification =
      typeof req.body?.clarification === "string"
        ? req.body.clarification.trim()
        : "";

    const evidenceLines = parseEvidence(req.body?.evidence);

    if (!rawIdea) {
      res.status(400).json({
        error: "Enter your startup idea first so there is something to test.",
      });
      return;
    }

    if (
      rawIdea.length > MAX_IDEA_CHARS ||
      clarification.length > MAX_CLARIFICATION_CHARS
    ) {
      res.status(400).json({
        error: `That is too long to analyze. Keep the idea under ${MAX_IDEA_CHARS} characters.`,
      });
      return;
    }

    let userId: string | null = null;
    if (supabaseAuth) {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const { data, error } = token
        ? await supabaseAuth.auth.getUser(token)
        : { data: { user: null }, error: null };
      // No HTTP status means Supabase could not be reached, not a bad session.
      if (error && !error.status) {
        res.status(503).json({
          error: "Could not reach the sign-in service to check your session. Try again in a moment.",
        });
        return;
      }
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
      // Phase 1: Problem — check if a single clarifying question is needed (only on initial submission)
      sendSseEvent(res, "phase", { phaseIndex: 0, phaseName: "Problem" });

      if (!clarification) {
        const clarity = (await withRetry(() =>
          llm.generateJson({
            system:
              "You triage startup ideas for FORGE. Only mark is_clear as false if the input is genuinely too vague to evaluate because it lacks a clear user, problem, or way to make money (e.g., a generic slogan or a few vague words). If it has enough to evaluate, mark is_clear true with an empty clarifying_question. If false, ask exactly ONE short, direct clarifying question.",
            prompt: `Evaluate whether this startup idea has enough substance to judge, or if it is too vague (missing a clear user, concrete problem, AND plausible way to make money).\n\nFounder input:\n"""\n${rawIdea}\n"""`,
            schema: CLARITY_SCHEMA,
            schemaName: "clarity_check",
            effort: "low",
          })
        )) as Partial<ClarityCheckResult> | null;

        if (clarity && typeof clarity === "object") {
          if (!clarity.is_clear && clarity.clarifying_question?.trim()) {
            sendSseEvent(res, "clarification", {
              question: clarity.clarifying_question.trim(),
            });
            res.end();
            return;
          }
        }
      }

      if (clientDisconnected) return;

      // Phases 2-4: Customer, Market, Competition — Google Search grounded research
      sendSseEvent(res, "phase", { phaseIndex: 1, phaseName: "Customer" });
      sendSseEvent(res, "phase", { phaseIndex: 2, phaseName: "Market" });

      const combinedIdeaContext = clarification
        ? `Original idea:\n${rawIdea}\n\nFounder clarification:\n${clarification}`
        : rawIdea;

      let researchNotes = "";
      const verifiedSources: VerifiedSource[] = [];
      const preGroundingFlags: string[] = [];

      sendSseEvent(res, "phase", { phaseIndex: 3, phaseName: "Competition" });

      const research = llm.research;
      try {
        if (!research) {
          preGroundingFlags.push(
            "Could not verify competitors: live web search is not set up for this model. Nothing in this report was checked against the web."
          );
        } else {
          const result = await withRetry(() =>
            research(
              "You are a factual market researcher for FORGE. Use Google Search to verify competitors, pricing, and market demand. Never invent competitors, user numbers, or revenue figures. Explicitly note gaps where search returns no hard data.",
              `Research the market reality, existing competitors, pricing benchmarks, and demand signals for this startup idea. Only report facts observed in web search results. Identify real competing products/companies with what they actually do.\n\nStartup idea:\n"""\n${combinedIdeaContext}\n"""`
            )
          );
          researchNotes = result.notes;
          verifiedSources.push(...result.sources);

          if (verifiedSources.length === 0) {
            preGroundingFlags.push(
              "Could not verify competitors: live web search returned no source URLs."
            );
          }
        }
      } catch (researchErr) {
        // A quota error here usually means the key's plan does not include
        // Google Search grounding. Carry on ungrounded and say so in the report;
        // if the whole key is out of quota the analysis call below fails anyway.
        const quotaError = /RESOURCE_EXHAUSTED|429|quota/i.test(
          researchErr instanceof Error ? researchErr.message : String(researchErr)
        );
        if (isFatalApiError(researchErr) && !quotaError) {
          throw researchErr;
        }
        preGroundingFlags.push(
          quotaError
            ? "Could not verify competitors: live web search is not available on this API key's plan. Nothing in this report was checked against the web."
            : `Could not verify competitors (${formatApiError(researchErr)}).`
        );
      }

      if (clientDisconnected) return;

      // Phases 5-6: Business Model, Execution Risk — Structured JSON analysis
      sendSseEvent(res, "phase", {
        phaseIndex: 4,
        phaseName: "Business Model",
      });

      const sourcesBlock =
        verifiedSources.length > 0
          ? verifiedSources
              .map((s, idx) => `${idx + 1}. ${s.title} — ${s.url}`)
              .join("\n")
          : "NONE (no verified search sources were retrieved)";

      const analysisPrompt = `Analyze this startup idea and return the structured FORGE report.

FOUNDER INPUT:
"""
${combinedIdeaContext}
"""

GROUNDED RESEARCH NOTES:
"""
${researchNotes || "No grounded research notes were retrieved."}
"""

VERIFIED SOURCES FROM GOOGLE SEARCH (numbered):
${sourcesBlock}

EXPERIMENTS THE FOUNDER REPORTS HAVING RUN (self-reported, not independently verified):
${evidenceLines.length > 0 ? evidenceLines.join("\n") : "None reported."}

PRE-EXISTING GROUNDING FLAGS:
${preGroundingFlags.length > 0 ? preGroundingFlags.join("\n") : "None"}

RULES:
- Score honestly: overall 0-100, each breakdown 0-10. Weak ideas should get weak scores.
- Notice founder_fit: if the founder gave no background/credentials in their input, score founder_fit conservatively (e.g. 3-5) and note in grounding_flags that founder background was not provided.
- Competitors: ONLY include competitors backed by the grounded research notes and verified sources above. Every competitor's source_index MUST be the number of the VERIFIED SOURCES entry that backs it, or 0 if none does. If no verified sources exist, leave competitors as [] and include "Could not verify competitors" in grounding_flags.
- Founder experiments: treat reported results as real but self-reported evidence. A result that went against the idea must lower the relevant scores and appear in weaknesses or key_risks. A supporting result only raises scores as far as its notes give specifics (who, how many, what they did or paid); vague or missing notes earn little. Say in the rationale which results moved the score. Add one grounding_flags entry stating that experiment results are self-reported. Do not repeat a finished experiment in validate_next; suggest what to test next instead.
- Business plan: tam_estimate and pricing_hypothesis MUST explicitly state they are estimates and list all underlying assumptions in assumptions[].
- grounding_flags: list every important claim, competitor figure, market size, or assumption that could not be verified from the retrieved sources.`;

      const parsed = (await withRetry(() =>
        llm.generateJson({
          system: ANALYSIS_SYSTEM_INSTRUCTION,
          prompt: analysisPrompt,
          schema: REPORT_SCHEMA,
          schemaName: "forge_report",
          effort: "medium",
        })
      )) as Partial<RawReport> | null;

      if (!parsed || typeof parsed !== "object" || !parsed.idea_score) {
        throw new Error(
          "The model returned a report that could not be read. Click Retry."
        );
      }

      if (clientDisconnected) return;

      sendSseEvent(res, "phase", {
        phaseIndex: 5,
        phaseName: "Execution Risk",
      });

      // Enforce strict grounding integrity on server output
      const finalFlags = new Set<string>(
        [...preGroundingFlags, ...strList(parsed.grounding_flags)]
          .map((f) => f.trim())
          .filter(Boolean)
      );

      const sanitizedCompetitors: ReportCompetitor[] = [];
      for (const comp of Array.isArray(parsed.competitors) ? parsed.competitors : []) {
        const name = str(comp?.name);
        if (!name) continue;
        const source = Number.isInteger(comp.source_index)
          ? verifiedSources[comp.source_index - 1]
          : undefined;
        if (source) {
          sanitizedCompetitors.push({
            name,
            what_they_do: str(comp.what_they_do),
            source_url: source.url,
          });
        } else if (verifiedSources.length > 0) {
          finalFlags.add(
            `Could not verify a source for competitor "${name}"; it was left out.`
          );
        }
      }

      if (
        verifiedSources.length === 0 &&
        !Array.from(finalFlags).some((f) =>
          f.toLowerCase().includes("could not verify competitors")
        )
      ) {
        finalFlags.add("Could not verify competitors");
      }

      const report = {
        idea_title: str(parsed.idea_title).slice(0, 80),
        idea_summary: str(parsed.idea_summary),
        idea_score: {
          overall: Math.round(clamp(parsed.idea_score?.overall ?? 0, 0, 100)),
          breakdown: {
            problem_clarity: Number(
              clamp(parsed.idea_score?.breakdown?.problem_clarity ?? 0, 0, 10).toFixed(1)
            ),
            market_signal: Number(
              clamp(parsed.idea_score?.breakdown?.market_signal ?? 0, 0, 10).toFixed(1)
            ),
            founder_fit: Number(
              clamp(parsed.idea_score?.breakdown?.founder_fit ?? 0, 0, 10).toFixed(1)
            ),
            feasibility: Number(
              clamp(parsed.idea_score?.breakdown?.feasibility ?? 0, 0, 10).toFixed(1)
            ),
            differentiation: Number(
              clamp(parsed.idea_score?.breakdown?.differentiation ?? 0, 0, 10).toFixed(1)
            ),
          },
          confidence: (["low", "medium", "high"] as const).find(
            (c) => c === parsed.idea_score?.confidence
          ) ?? "low",
          rationale: str(parsed.idea_score?.rationale),
        },
        swot: {
          strengths: strList(parsed.swot?.strengths),
          weaknesses: strList(parsed.swot?.weaknesses),
          opportunities: strList(parsed.swot?.opportunities),
          threats: strList(parsed.swot?.threats),
        },
        competitors: sanitizedCompetitors,
        blueprint: {
          problem: str(parsed.blueprint?.problem),
          target_user: str(parsed.blueprint?.target_user),
          solution: str(parsed.blueprint?.solution),
          business_model: str(parsed.blueprint?.business_model),
          key_risks: strList(parsed.blueprint?.key_risks),
          validate_next: strList(parsed.blueprint?.validate_next),
        },
        business_plan: {
          tam_estimate: str(parsed.business_plan?.tam_estimate),
          assumptions: strList(parsed.business_plan?.assumptions),
          go_to_market: str(parsed.business_plan?.go_to_market),
          pricing_hypothesis: str(parsed.business_plan?.pricing_hypothesis),
        },
        grounding_flags: Array.from(finalFlags),
        sources: verifiedSources,
      };

      sendSseEvent(res, "report", { report });
      res.end();
    } catch (err) {
      const errorMessage = formatApiError(err);
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
