import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_NAME = "gemini-4-hydrogen";

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
  source_url: string;
}

interface RawReport {
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

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
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
  return /UNAVAILABLE|503|502|504|high demand|overloaded|ETIMEDOUT|ECONNRESET/i.test(
    message
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientError(err)) {
        const delayMs = 800 * attempt;
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
    return "Gemini API key is missing or invalid. Check GEMINI_API_KEY in Settings > Secrets.";
  }
  if (/RESOURCE_EXHAUSTED|429/i.test(message)) {
    return "Gemini API rate limit or quota exceeded. Wait a moment and try again.";
  }
  if (/NOT_FOUND|404/i.test(message)) {
    return `Requested Gemini model (${MODEL_NAME}) was not found or is unavailable.`;
  }
  if (/UNAVAILABLE|503|high demand/i.test(message)) {
    return "Gemini is temporarily overloaded right now. Please click Retry in a few seconds.";
  }
  return message || "Unexpected error during analysis.";
}

function clamp(num: number, min: number, max: number): number {
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const CLARITY_SCHEMA = {
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

const REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
          source_url: {
            type: Type.STRING,
            description:
              "Must be an exact URL from the provided verified search sources, or empty string if unverified.",
          },
        },
        required: ["name", "what_they_do", "source_url"],
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
  app.use(express.json({ limit: "1mb" }));

  app.post("/api/analyze", async (req: Request, res: Response) => {
    const rawIdea =
      typeof req.body?.rawIdea === "string" ? req.body.rawIdea.trim() : "";
    const clarification =
      typeof req.body?.clarification === "string"
        ? req.body.clarification.trim()
        : "";

    if (!rawIdea) {
      res.status(400).json({
        error: "Enter your startup idea first so there is something to test.",
      });
      return;
    }

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const ai = getGenAIClient();

      // Phase 1: Problem — check if a single clarifying question is needed (only on initial submission)
      sendSseEvent(res, "phase", { phaseIndex: 0, phaseName: "Problem" });

      if (!clarification) {
        const clarityResponse = await withRetry(() =>
          ai.models.generateContent({
            model: MODEL_NAME,
            contents: `Evaluate whether this startup idea has enough substance to judge, or if it is too vague (missing a clear user, concrete problem, AND plausible way to make money).\n\nFounder input:\n"""\n${rawIdea}\n"""`,
            config: {
              systemInstruction:
                "You triage startup ideas for FORGE. Only mark is_clear as false if the input is genuinely too vague to evaluate because it lacks a clear user, problem, or way to make money (e.g., a generic slogan or a few vague words). If it has enough to evaluate, mark is_clear true with an empty clarifying_question. If false, ask exactly ONE short, direct clarifying question.",
              responseMimeType: "application/json",
              responseSchema: CLARITY_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              seed: 42,
            },
          })
        );

        const clarityText = (clarityResponse.text ?? "").trim();
        if (clarityText) {
          const clarity = JSON.parse(clarityText) as ClarityCheckResult;
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
      const seenUrls = new Set<string>();
      const preGroundingFlags: string[] = [];

      try {
        sendSseEvent(res, "phase", {
          phaseIndex: 3,
          phaseName: "Competition",
        });

        const researchResponse = await withRetry(() =>
          ai.models.generateContent({
            model: MODEL_NAME,
            contents: `Research the market reality, existing competitors, pricing benchmarks, and demand signals for this startup idea. Only report facts observed in web search results. Identify real competing products/companies with what they actually do.\n\nStartup idea:\n"""\n${combinedIdeaContext}\n"""`,
            config: {
              systemInstruction:
                "You are a factual market researcher for FORGE. Use Google Search to verify competitors, pricing, and market demand. Never invent competitors, user numbers, or revenue figures. Explicitly note gaps where search returns no hard data.",
              tools: [{ googleSearch: {} }],
              seed: 42,
            },
          })
        );

        researchNotes = (researchResponse.text ?? "").trim();
        const chunks =
          researchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks ??
          [];

        for (const chunk of chunks) {
          const uri = chunk.web?.uri?.trim();
          if (uri && !seenUrls.has(uri)) {
            seenUrls.add(uri);
            verifiedSources.push({
              title: chunk.web?.title?.trim() || uri,
              url: uri,
            });
          }
        }

        if (verifiedSources.length === 0) {
          preGroundingFlags.push(
            "Could not verify competitors: live web search returned no source URLs."
          );
        }
      } catch (researchErr) {
        if (isFatalApiError(researchErr)) {
          throw researchErr;
        }
        const reason = formatApiError(researchErr);
        preGroundingFlags.push(
          `Could not verify competitors (${reason}).`
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

VERIFIED SOURCE URLS FROM GOOGLE SEARCH:
${sourcesBlock}

PRE-EXISTING GROUNDING FLAGS:
${preGroundingFlags.length > 0 ? preGroundingFlags.join("\n") : "None"}

RULES:
- Score honestly: overall 0-100, each breakdown 0-10. Weak ideas should get weak scores.
- Notice founder_fit: if the founder gave no background/credentials in their input, score founder_fit conservatively (e.g. 3-5) and note in grounding_flags that founder background was not provided.
- Competitors: ONLY include competitors backed by the grounded research notes and verified source URLs above (or explicitly named by the founder). Every competitor's source_url MUST be copied verbatim from VERIFIED SOURCE URLS above, or set to "" if unverified. If no verified sources exist, leave competitors as [] and include "Could not verify competitors" in grounding_flags.
- Business plan: tam_estimate and pricing_hypothesis MUST explicitly state they are estimates and list all underlying assumptions in assumptions[].
- grounding_flags: list every important claim, competitor figure, market size, or assumption that could not be verified from the retrieved sources.`;

      const analysisResponse = await withRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: analysisPrompt,
          config: {
            systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: REPORT_SCHEMA,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            seed: 42,
          },
        })
      );

      if (clientDisconnected) return;

      sendSseEvent(res, "phase", {
        phaseIndex: 5,
        phaseName: "Execution Risk",
      });

      const rawJson = (analysisResponse.text ?? "").trim();
      if (!rawJson) {
        throw new Error("Model returned an empty analysis response.");
      }

      const parsed = JSON.parse(rawJson) as RawReport;

      // Enforce strict grounding integrity on server output
      const verifiedUrlSet = new Set(verifiedSources.map((s) => s.url));
      const finalFlags = new Set<string>(
        [...preGroundingFlags, ...(parsed.grounding_flags ?? [])]
          .map((f) => f.trim())
          .filter(Boolean)
      );

      const sanitizedCompetitors: RawCompetitor[] = [];
      for (const comp of parsed.competitors ?? []) {
        const cleanUrl = (comp.source_url ?? "").trim();
        if (cleanUrl && verifiedUrlSet.has(cleanUrl)) {
          sanitizedCompetitors.push({
            name: comp.name.trim(),
            what_they_do: comp.what_they_do.trim(),
            source_url: cleanUrl,
          });
        } else if (verifiedSources.length === 0) {
          // Grounding failed or returned zero sources; do not emit unverified competitor claims
          finalFlags.add("Could not verify competitors");
        } else {
          finalFlags.add(
            `Could not verify source URL for competitor "${comp.name.trim()}".`
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
        idea_summary: (parsed.idea_summary ?? "").trim(),
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
          confidence: parsed.idea_score?.confidence ?? "low",
          rationale: (parsed.idea_score?.rationale ?? "").trim(),
        },
        swot: {
          strengths: (parsed.swot?.strengths ?? []).filter(Boolean),
          weaknesses: (parsed.swot?.weaknesses ?? []).filter(Boolean),
          opportunities: (parsed.swot?.opportunities ?? []).filter(Boolean),
          threats: (parsed.swot?.threats ?? []).filter(Boolean),
        },
        competitors: sanitizedCompetitors,
        blueprint: {
          problem: (parsed.blueprint?.problem ?? "").trim(),
          target_user: (parsed.blueprint?.target_user ?? "").trim(),
          solution: (parsed.blueprint?.solution ?? "").trim(),
          business_model: (parsed.blueprint?.business_model ?? "").trim(),
          key_risks: (parsed.blueprint?.key_risks ?? []).filter(Boolean),
          validate_next: (parsed.blueprint?.validate_next ?? []).filter(Boolean),
        },
        business_plan: {
          tam_estimate: (parsed.business_plan?.tam_estimate ?? "").trim(),
          assumptions: (parsed.business_plan?.assumptions ?? []).filter(Boolean),
          go_to_market: (parsed.business_plan?.go_to_market ?? "").trim(),
          pricing_hypothesis: (
            parsed.business_plan?.pricing_hypothesis ?? ""
          ).trim(),
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
