// The FORGE analysis pipeline, shared by the local Express server (server.ts)
// and the Supabase Edge Function (index.ts). Keep it free of Node- and
// Deno-specific APIs so both runtimes can import it.
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

export const DEFAULT_MODEL = "gemini-4-hydrogen";
export const MAX_IDEA_CHARS = 6000;
export const MAX_CLARIFICATION_CHARS = 2000;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_RATE_LIMIT_MAX = 10;

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

function createClient(apiKey: string): GoogleGenAI {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
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

export function formatApiError(err: unknown, model: string): string {
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
    return `Requested Gemini model (${model}) was not found or is unavailable.`;
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

export interface AnalysisInput {
  rawIdea: string;
  clarification: string;
}

/** Trims the request body and returns either the input or a user-facing error. */
export function parseAnalysisInput(
  body: unknown
): { input: AnalysisInput } | { error: string } {
  const record = (body ?? {}) as Record<string, unknown>;
  const rawIdea = typeof record.rawIdea === "string" ? record.rawIdea.trim() : "";
  const clarification =
    typeof record.clarification === "string" ? record.clarification.trim() : "";
  if (!rawIdea) {
    return { error: "Enter your startup idea first so there is something to test." };
  }
  if (
    rawIdea.length > MAX_IDEA_CHARS ||
    clarification.length > MAX_CLARIFICATION_CHARS
  ) {
    return {
      error: `That is too long to analyze. Keep the idea under ${MAX_IDEA_CHARS} characters.`,
    };
  }
  return { input: { rawIdea, clarification } };
}

export interface RunAnalysisOptions extends AnalysisInput {
  apiKey: string;
  model: string;
  /** Sends one server-sent event to the client. */
  emit: (event: string, data: unknown) => void;
  /** True once the client has gone away, so remaining model calls are skipped. */
  isCancelled: () => boolean;
}

/** Runs the full pipeline, reporting progress and the result through emit. Throws on failure. */
export async function runAnalysis({
  apiKey,
  model,
  rawIdea,
  clarification,
  emit,
  isCancelled,
}: RunAnalysisOptions): Promise<void> {
  const ai = createClient(apiKey);

  // Phase 1: Problem — check if a single clarifying question is needed (only on initial submission)
  emit("phase", { phaseIndex: 0, phaseName: "Problem" });

  if (!clarification) {
    const clarityResponse = await withRetry(() =>
      ai.models.generateContent({
        model: model,
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
        emit("clarification", {
          question: clarity.clarifying_question.trim(),
        });
        return;
      }
    }
  }

  if (isCancelled()) return;

  // Phases 2-4: Customer, Market, Competition — Google Search grounded research
  emit("phase", { phaseIndex: 1, phaseName: "Customer" });
  emit("phase", { phaseIndex: 2, phaseName: "Market" });

  const combinedIdeaContext = clarification
    ? `Original idea:\n${rawIdea}\n\nFounder clarification:\n${clarification}`
    : rawIdea;

  let researchNotes = "";
  const verifiedSources: VerifiedSource[] = [];
  const seenUrls = new Set<string>();
  const preGroundingFlags: string[] = [];

  try {
    emit("phase", {
      phaseIndex: 3,
      phaseName: "Competition",
    });

    const researchResponse = await withRetry(() =>
      ai.models.generateContent({
        model: model,
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
        ? "Could not verify competitors: live web search is not available on this Gemini API key's plan. Nothing in this report was checked against the web."
        : `Could not verify competitors (${formatApiError(researchErr, model)}).`
    );
  }

  if (isCancelled()) return;

  // Phases 5-6: Business Model, Execution Risk — Structured JSON analysis
  emit("phase", {
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

PRE-EXISTING GROUNDING FLAGS:
${preGroundingFlags.length > 0 ? preGroundingFlags.join("\n") : "None"}

RULES:
- Score honestly: overall 0-100, each breakdown 0-10. Weak ideas should get weak scores.
- Notice founder_fit: if the founder gave no background/credentials in their input, score founder_fit conservatively (e.g. 3-5) and note in grounding_flags that founder background was not provided.
- Competitors: ONLY include competitors backed by the grounded research notes and verified sources above. Every competitor's source_index MUST be the number of the VERIFIED SOURCES entry that backs it, or 0 if none does. If no verified sources exist, leave competitors as [] and include "Could not verify competitors" in grounding_flags.
- Business plan: tam_estimate and pricing_hypothesis MUST explicitly state they are estimates and list all underlying assumptions in assumptions[].
- grounding_flags: list every important claim, competitor figure, market size, or assumption that could not be verified from the retrieved sources.`;

  const analysisResponse = await withRetry(() =>
    ai.models.generateContent({
      model: model,
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

  if (isCancelled()) return;

  emit("phase", {
    phaseIndex: 5,
    phaseName: "Execution Risk",
  });

  const rawJson = (analysisResponse.text ?? "").trim();
  if (!rawJson) {
    throw new Error("Model returned an empty analysis response.");
  }

  const parsed = JSON.parse(rawJson) as RawReport;

  // Enforce strict grounding integrity on server output
  const finalFlags = new Set<string>(
    [...preGroundingFlags, ...(parsed.grounding_flags ?? [])]
      .map((f) => f.trim())
      .filter(Boolean)
  );

  const sanitizedCompetitors: ReportCompetitor[] = [];
  for (const comp of parsed.competitors ?? []) {
    const name = (comp.name ?? "").trim();
    if (!name) continue;
    const source = Number.isInteger(comp.source_index)
      ? verifiedSources[comp.source_index - 1]
      : undefined;
    if (source) {
      sanitizedCompetitors.push({
        name,
        what_they_do: (comp.what_they_do ?? "").trim(),
        source_url: source.url,
      });
    } else if (verifiedSources.length === 0) {
      // Grounding failed or returned zero sources; do not emit unverified competitor claims
      finalFlags.add("Could not verify competitors");
    } else {
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
    idea_title: (parsed.idea_title ?? "").trim().slice(0, 80),
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

  emit("report", { report });
}
