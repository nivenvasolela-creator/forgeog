// The FORGE analysis pipeline. Runtime-neutral: it only uses fetch and timers,
// so the same file runs in the Node server and in the Supabase Edge Function.
import type { Llm, SchemaNode } from "./llm.ts";
import type { SearchHit, WebSearch } from "./search.ts";
import {
  languageRule,
  parseLanguage,
  parseProfile,
  profileBlock,
  type Language,
} from "./founder.ts";

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
  decision: {
    call: "go" | "pivot" | "kill";
    reason: string;
    pivots: string[];
  };
}

export function isFatalApiError(err: unknown): boolean {
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

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
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

export function formatApiError(err: unknown, llm: Llm): string {
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
export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean);
}

function clamp(value: unknown, min: number, max: number): number {
  const num = typeof value === "string" ? Number(value) : (value as number);
  if (typeof num !== "number" || !Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}


const CLARITY_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    is_clear: {
      type: "BOOLEAN",
      description:
        "True if the idea has enough detail about user, problem, or monetization to stress-test. False only if it is genuinely too vague to judge.",
    },
    clarifying_question: {
      type: "STRING",
      description:
        "Empty string when is_clear is true. Otherwise, exactly one short direct question asking about the missing user, problem, or way to make money.",
    },
  },
  required: ["is_clear", "clarifying_question"],
};

const REPORT_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    idea_title: {
      type: "STRING",
      description:
        "Plain 3-7 word name for the idea, like a project title. No hype, no trailing punctuation.",
    },
    idea_summary: {
      type: "STRING",
      description: "Plain 1-2 sentence summary of the startup idea.",
    },
    idea_score: {
      type: "OBJECT",
      properties: {
        overall: {
          type: "INTEGER",
          description: "Overall viability score from 0 to 100. Do not inflate.",
        },
        breakdown: {
          type: "OBJECT",
          properties: {
            problem_clarity: { type: "NUMBER", description: "0 to 10" },
            market_signal: { type: "NUMBER", description: "0 to 10" },
            founder_fit: { type: "NUMBER", description: "0 to 10" },
            feasibility: { type: "NUMBER", description: "0 to 10" },
            differentiation: { type: "NUMBER", description: "0 to 10" },
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
          type: "STRING",
          enum: ["low", "medium", "high"],
          description: "Confidence in this evaluation based on available facts.",
        },
        rationale: {
          type: "STRING",
          description: "Direct plain-language verdict explaining the overall score.",
        },
      },
      required: ["overall", "breakdown", "confidence", "rationale"],
    },
    swot: {
      type: "OBJECT",
      properties: {
        strengths: { type: "ARRAY", items: { type: "STRING" } },
        weaknesses: { type: "ARRAY", items: { type: "STRING" } },
        opportunities: { type: "ARRAY", items: { type: "STRING" } },
        threats: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["strengths", "weaknesses", "opportunities", "threats"],
    },
    competitors: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          what_they_do: { type: "STRING" },
          source_index: {
            type: "INTEGER",
            description:
              "The number of the entry in the VERIFIED SOURCES list that backs this competitor, or 0 if no listed source backs it.",
          },
        },
        required: ["name", "what_they_do", "source_index"],
      },
    },
    blueprint: {
      type: "OBJECT",
      properties: {
        problem: { type: "STRING" },
        target_user: { type: "STRING" },
        solution: { type: "STRING" },
        business_model: { type: "STRING" },
        key_risks: { type: "ARRAY", items: { type: "STRING" } },
        validate_next: { type: "ARRAY", items: { type: "STRING" } },
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
      type: "OBJECT",
      properties: {
        tam_estimate: {
          type: "STRING",
          description: "Explicitly labeled estimate of addressable market with reasoning.",
        },
        assumptions: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Key assumptions underlying any estimates.",
        },
        go_to_market: { type: "STRING" },
        pricing_hypothesis: {
          type: "STRING",
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
    decision: {
      type: "OBJECT",
      properties: {
        call: {
          type: "STRING",
          enum: ["go", "pivot", "kill"],
          description:
            "go: worth starting to execute now. pivot: the core insight is useful but this version should change. kill: stop and move on to another idea.",
        },
        reason: {
          type: "STRING",
          description:
            "Two or three plain sentences explaining the call, written to the founder.",
        },
        pivots: {
          type: "ARRAY",
          items: { type: "STRING" },
          description:
            "For pivot or kill: 2-3 sharper alternative ideas, each one self-contained sentence naming the customer, the problem and how it makes money. For go: an empty array.",
        },
      },
      required: ["call", "reason", "pivots"],
    },
    grounding_flags: {
      type: "ARRAY",
      items: { type: "STRING" },
      description:
        "List of claims, competitor details, or market numbers that could not be verified from search sources.",
    },
    sources: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          url: { type: "STRING" },
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
    "decision",
    "grounding_flags",
    "sources",
  ],
};

const SEARCH_QUERIES_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    queries: {
      type: "ARRAY",
      items: { type: "STRING" },
      description:
        "Exactly 3 short web search queries, as a person would type them into a search engine.",
    },
  },
  required: ["queries"],
};

const MAX_SOURCES = 12;

/** Asks the model what to look up, runs the searches, and returns unique pages. */
async function searchTheWeb(
  search: WebSearch,
  llm: Llm,
  ideaContext: string
): Promise<SearchHit[]> {
  let queries: string[] = [];
  try {
    const result = (await withRetry(() =>
      llm.generateJson({
        system:
          "You plan web research for FORGE, a startup idea validator. Write search queries that will surface real, existing products and hard numbers. Use plain keywords, no quotes or operators, under 12 words each.",
        prompt: `Write exactly 3 web search queries for this startup idea:\n1. One to find existing competing products or tools.\n2. One to find what those alternatives charge.\n3. One to find market size or demand data for the target customers.\n\nStartup idea:\n"""\n${ideaContext}\n"""`,
        schema: SEARCH_QUERIES_SCHEMA,
        schemaName: "search_queries",
        effort: "low",
      })
    )) as { queries?: unknown } | null;
    queries = strList(result?.queries).slice(0, 3);
  } catch (err) {
    // Auth, quota and missing-model errors will fail the main analysis too.
    if (isFatalApiError(err)) throw err;
  }
  if (queries.length === 0) {
    queries = [`${ideaContext.replace(/\s+/g, " ").slice(0, 150)} competitors`];
  }

  const settled = await Promise.allSettled(
    queries.map((q) => search.search(q, 5))
  );
  const failures = settled.filter((r) => r.status === "rejected");
  if (failures.length === settled.length) {
    throw (failures[0] as PromiseRejectedResult).reason;
  }

  // Take results round-robin so every query is represented within the cap.
  const lists = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (let rank = 0; rank < 5 && hits.length < MAX_SOURCES; rank++) {
    for (const list of lists) {
      const hit = list[rank];
      if (hit && !seen.has(hit.url) && hits.length < MAX_SOURCES) {
        seen.add(hit.url);
        hits.push(hit);
      }
    }
  }
  return hits;
}

export interface AnalyzeInput {
  rawIdea: string;
  clarification: string;
  evidenceLines: string[];
  profileLines: string[];
  language: Language;
}

/** Validates a request body. Returns the cleaned input or a message for the user. */
export function parseAnalyzeInput(
  body: unknown
): { ok: true; input: AnalyzeInput } | { ok: false; error: string } {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const rawIdea = str(record.rawIdea);
  const clarification = str(record.clarification);
  if (!rawIdea) {
    return { ok: false, error: "Enter your startup idea first so there is something to test." };
  }
  if (rawIdea.length > MAX_IDEA_CHARS || clarification.length > MAX_CLARIFICATION_CHARS) {
    return {
      ok: false,
      error: `That is too long to analyze. Keep the idea under ${MAX_IDEA_CHARS} characters.`,
    };
  }
  return {
    ok: true,
    input: {
      rawIdea,
      clarification,
      evidenceLines: parseEvidence(record.evidence),
      profileLines: parseProfile(record.profile),
      language: parseLanguage(record.language),
    },
  };
}

export type Emit = (event: string, data: unknown) => void;

export interface AnalysisDeps {
  llm: Llm;
  /** Web search used to ground competitors; null when none is configured. */
  search: WebSearch | null;
  /** True once the client has gone away, so remaining model calls can be skipped. */
  isCancelled: () => boolean;
}

// ---------------------------------------------------------------------------
// The agents. Each is one short step so a job queue can run them one at a
// time (hosted functions stop after 150 s), and runAnalysis chains them for
// the streaming API.
// ---------------------------------------------------------------------------

export interface ScoutResult {
  researchNotes: string;
  sources: VerifiedSource[];
  flags: string[];
}

export interface SkepticSummary {
  /** Claims and competitors the Skeptic checked against the sources. */
  checked: number;
  supported: number;
  /** Competitors removed because their source did not back them. */
  removed: string[];
  /** Claims the sources did not support (also added to grounding_flags). */
  unsupported: string[];
  /** The strongest argument against the idea. */
  counterargument: string;
}

export type ForgeReport = ReturnType<typeof buildReport>;

function combinedContext(input: AnalyzeInput): string {
  return input.clarification
    ? `Original idea:\n${input.rawIdea}\n\nFounder clarification:\n${input.clarification}`
    : input.rawIdea;
}

/** Clarity agent: returns one clarifying question when the idea is too vague, else null. */
export async function stepClarity(input: AnalyzeInput, llm: Llm): Promise<string | null> {
  if (input.clarification) return null;
  const clarity = (await withRetry(() =>
    llm.generateJson({
      system:
        "You triage startup ideas for FORGE. Only mark is_clear as false if the input is genuinely too vague to evaluate because it lacks a clear user, problem, or way to make money (e.g., a generic slogan or a few vague words). If it has enough to evaluate, mark is_clear true with an empty clarifying_question. If false, ask exactly ONE short, direct clarifying question." +
        languageRule(input.language),
      prompt: `Evaluate whether this startup idea has enough substance to judge, or if it is too vague (missing a clear user, concrete problem, AND plausible way to make money).\n\nFounder input:\n"""\n${input.rawIdea}\n"""`,
      schema: CLARITY_SCHEMA,
      schemaName: "clarity_check",
      effort: "low",
    })
  )) as Partial<ClarityCheckResult> | null;
  if (clarity && typeof clarity === "object" && !clarity.is_clear) {
    const question = clarity.clarifying_question?.trim();
    if (question) return question;
  }
  return null;
}

/** Scout agent: finds real pages about competitors, pricing and demand. */
export async function stepScout(
  input: AnalyzeInput,
  deps: { llm: Llm; search: WebSearch | null }
): Promise<ScoutResult> {
  const { llm } = deps;
  const context = combinedContext(input);
  const sources: VerifiedSource[] = [];
  const flags: string[] = [];
  let researchNotes = "";
  const research = llm.research;
  try {
    if (deps.search) {
      // Location steers the queries towards the founder's own market.
      const location = input.profileLines.filter((l) => /^- (Country|City):/.test(l));
      const hits = await searchTheWeb(
        deps.search,
        llm,
        location.length > 0
          ? `${context}\n\nFounder is based in:\n${location.join("\n")}`
          : context
      );
      for (const hit of hits) sources.push({ title: hit.title, url: hit.url });
      researchNotes = hits
        .map((hit, idx) => `${idx + 1}. ${hit.title}\n   ${hit.snippet || "(no extract)"}`)
        .join("\n");
      if (hits.length === 0) {
        flags.push("Could not verify competitors: live web search returned no results.");
      }
    } else if (!research) {
      flags.push(
        "Could not verify competitors: live web search is not set up for this model. Nothing in this report was checked against the web."
      );
    } else {
      const result = await withRetry(() =>
        research(
          "You are a factual market researcher for FORGE. Use Google Search to verify competitors, pricing, and market demand. Never invent competitors, user numbers, or revenue figures. Explicitly note gaps where search returns no hard data.",
          `Research the market reality, existing competitors, pricing benchmarks, and demand signals for this startup idea. Only report facts observed in web search results. Identify real competing products/companies with what they actually do.\n\nStartup idea:\n"""\n${context}\n"""`
        )
      );
      researchNotes = result.notes;
      sources.push(...result.sources);
      if (sources.length === 0) {
        flags.push("Could not verify competitors: live web search returned no source URLs.");
      }
    }
  } catch (researchErr) {
    // Research is best-effort: carry on ungrounded and say so in the report.
    // A quota error from Gemini here usually means the key's plan does not
    // include Google Search grounding; if the whole key is out of quota the
    // analysis call below fails anyway.
    const quotaError = /RESOURCE_EXHAUSTED|429|quota/i.test(
      researchErr instanceof Error ? researchErr.message : String(researchErr)
    );
    const fromSearch = /^Web search failed/.test(
      researchErr instanceof Error ? researchErr.message : ""
    );
    if (isFatalApiError(researchErr) && !quotaError && !fromSearch) {
      throw researchErr;
    }
    flags.push(
      fromSearch
        ? "Could not verify competitors: the web search service failed. Nothing in this report was checked against the web."
        : quotaError
        ? "Could not verify competitors: live web search is not available on this API key's plan. Nothing in this report was checked against the web."
        : `Could not verify competitors (${formatApiError(researchErr, llm)}).`
    );
  }
  return { researchNotes, sources, flags };
}

function buildReport(parsed: Partial<RawReport>, scout: ScoutResult) {
  const verifiedSources = scout.sources;
  // Enforce strict grounding integrity on server output
  const finalFlags = new Set<string>(
    [...scout.flags, ...strList(parsed.grounding_flags)].map((f) => f.trim()).filter(Boolean)
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
      finalFlags.add(`Could not verify a source for competitor "${name}"; it was left out.`);
    }
  }

  if (
    verifiedSources.length === 0 &&
    !Array.from(finalFlags).some((f) => f.toLowerCase().includes("could not verify competitors"))
  ) {
    finalFlags.add("Could not verify competitors");
  }

  const overallScore = Math.round(clamp(parsed.idea_score?.overall ?? 0, 0, 100));
  return {
    idea_title: str(parsed.idea_title).slice(0, 80),
    idea_summary: str(parsed.idea_summary),
    idea_score: {
      overall: overallScore,
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
      ) ?? ("low" as "low" | "medium" | "high"),
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
    decision: {
      call:
        (["go", "pivot", "kill"] as const).find((c) => c === parsed.decision?.call) ??
        ((overallScore >= 60 ? "go" : overallScore >= 30 ? "pivot" : "kill") as
          | "go"
          | "pivot"
          | "kill"),
      reason: str(parsed.decision?.reason),
      pivots: strList(parsed.decision?.pivots).slice(0, 3),
    },
    grounding_flags: Array.from(finalFlags),
    sources: verifiedSources,
    skeptic: null as SkepticSummary | null,
  };
}

/** Analyst agent: scores the idea and writes the report from the Scout's findings. */
export async function stepAnalyst(
  input: AnalyzeInput,
  scout: ScoutResult,
  llm: Llm
): Promise<ForgeReport> {
  const sourcesBlock =
    scout.sources.length > 0
      ? scout.sources.map((s, idx) => `${idx + 1}. ${s.title} — ${s.url}`).join("\n")
      : "NONE (no verified search sources were retrieved)";

  const analysisPrompt = `Analyze this startup idea and return the structured FORGE report.

FOUNDER INPUT:
"""
${combinedContext(input)}
"""

GROUNDED RESEARCH NOTES (web search results; the only verified facts):
"""
${scout.researchNotes || "No grounded research notes were retrieved."}
"""

VERIFIED SOURCES FROM GOOGLE SEARCH (numbered):
${sourcesBlock}

EXPERIMENTS THE FOUNDER REPORTS HAVING RUN (self-reported, not independently verified):
${input.evidenceLines.length > 0 ? input.evidenceLines.join("\n") : "None reported."}

FOUNDER PROFILE (self-reported by the founder):
${profileBlock(input.profileLines)}

PRE-EXISTING GROUNDING FLAGS:
${scout.flags.length > 0 ? scout.flags.join("\n") : "None"}

RULES:
- Score honestly: overall 0-100, each breakdown 0-10. Weak ideas should get weak scores.
- founder_fit: judge it against the FOUNDER PROFILE (skills, background, time, money, location) and anything the founder wrote about themselves. If neither says anything about the founder, score founder_fit conservatively (e.g. 3-5) and note in grounding_flags that founder background was not provided.
- Tailor go_to_market, pricing and validate_next to the founder's country, city, budget and time when the profile gives them. A founder with little money needs steps that cost little or nothing.
- decision: make one clear call. Use "go" only when the idea is worth executing now (roughly overall >= 60 with no fatal flaw). Use "kill" when the core problem or market looks fundamentally weak. Otherwise "pivot". For pivot or kill, give 2-3 concrete alternative ideas built on what is strongest here; for go, give an empty pivots array.
- Competitors: ONLY include competitors backed by the grounded research notes and verified sources above. Every competitor's source_index MUST be the number of the VERIFIED SOURCES entry that backs it, or 0 if none does. If no verified sources exist, leave competitors as [] and include "Could not verify competitors" in grounding_flags.
- Founder experiments: treat reported results as real but self-reported evidence. A result that went against the idea must lower the relevant scores and appear in weaknesses or key_risks. A supporting result only raises scores as far as its notes give specifics (who, how many, what they did or paid); vague or missing notes earn little. Say in the rationale which results moved the score. Add one grounding_flags entry stating that experiment results are self-reported. Do not repeat a finished experiment in validate_next; suggest what to test next instead.
- Business plan: tam_estimate and pricing_hypothesis MUST explicitly state they are estimates and list all underlying assumptions in assumptions[].
- grounding_flags: list every important claim, competitor figure, market size, or assumption that could not be verified from the retrieved sources.`;

  const parsed = (await withRetry(() =>
    llm.generateJson({
      system: ANALYSIS_SYSTEM_INSTRUCTION + languageRule(input.language),
      prompt: analysisPrompt,
      schema: REPORT_SCHEMA,
      schemaName: "forge_report",
      effort: "medium",
    })
  )) as Partial<RawReport> | null;

  if (!parsed || typeof parsed !== "object" || !parsed.idea_score) {
    throw new Error("The model returned a report that could not be read. Click Retry.");
  }
  return buildReport(parsed, scout);
}

const SKEPTIC_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    competitor_checks: {
      type: "ARRAY",
      description: "One entry per listed competitor, in the same order.",
      items: {
        type: "OBJECT",
        properties: {
          competitor_number: { type: "INTEGER", description: "The C number of the competitor." },
          supported: {
            type: "BOOLEAN",
            description:
              "True only if the extract of its cited source clearly shows this company exists and does what is claimed.",
          },
        },
        required: ["competitor_number", "supported"],
      },
    },
    claim_checks: {
      type: "ARRAY",
      description:
        "Up to 8 specific factual claims taken from the report (numbers, market facts, prices, customer behaviour), each judged against the source extracts.",
      items: {
        type: "OBJECT",
        properties: {
          claim: { type: "STRING", description: "The claim, quoted or closely paraphrased." },
          verdict: {
            type: "STRING",
            enum: ["supported", "unsupported", "contradicted", "labelled_estimate"],
            description:
              "supported: a source extract states it. contradicted: an extract says otherwise. labelled_estimate: the report already presents it as an estimate or assumption. unsupported: none of the above.",
          },
        },
        required: ["claim", "verdict"],
      },
    },
    strongest_objection: {
      type: "STRING",
      description:
        "The single strongest argument against this idea, in two plain sentences, written to the founder. Use only facts the extracts state, and do not mention any competitor you marked unsupported.",
    },
  },
  required: ["competitor_checks", "claim_checks", "strongest_objection"],
};

/** Drops sentences that mention any of the given names (rejected competitors). */
function withoutNames(text: string, names: string[]): string {
  const lowered = names.map((n) => n.toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return text;
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .filter((sentence) => !lowered.some((n) => sentence.toLowerCase().includes(n)))
    .join("")
    .trim();
}

/**
 * Skeptic agent: re-reads the Scout's source extracts, removes competitors
 * their source does not back, flags factual claims no source supports, and
 * argues against the idea. Never adds claims of its own.
 */
export async function stepSkeptic(
  input: AnalyzeInput,
  scout: ScoutResult,
  report: ForgeReport,
  llm: Llm
): Promise<ForgeReport> {
  const competitors = report.competitors;
  const sourceNumber = (url: string) => scout.sources.findIndex((s) => s.url === url) + 1;
  const competitorBlock =
    competitors.length > 0
      ? competitors
          .map(
            (c, i) =>
              `C${i + 1}. ${c.name}: ${c.what_they_do} (cites source ${sourceNumber(c.source_url)})`
          )
          .join("\n")
      : "None.";
  const reportText = [
    `Rationale: ${report.idea_score.rationale}`,
    `Market size: ${report.business_plan.tam_estimate}`,
    `Pricing: ${report.business_plan.pricing_hypothesis}`,
    `Go-to-market: ${report.business_plan.go_to_market}`,
    `Opportunities: ${report.swot.opportunities.join(" | ")}`,
    `Threats: ${report.swot.threats.join(" | ")}`,
  ].join("\n");

  const parsed = (await withRetry(() =>
    llm.generateJson({
      system:
        "You are FORGE's Skeptic. Your job is to protect founders from fake research. You check claims ONLY against the numbered source extracts you are given; you know nothing else. If an extract does not clearly state something, it is not supported. Be strict, short and fair." +
        languageRule(input.language),
      prompt: `SOURCE EXTRACTS (numbered; the only evidence):
"""
${scout.researchNotes || "No source extracts were retrieved."}
"""

COMPETITORS THE REPORT LISTS:
${competitorBlock}

REPORT TEXT TO CHECK:
"""
${reportText}
"""

IDEA:
"""
${combinedContext(input)}
"""

Check every competitor against the extract of the source it cites. Then pick up to 8 specific factual claims from the report text and judge each against the extracts. Finally give the strongest objection to the idea, built only on facts the extracts state; never cite a competitor you just marked unsupported.`,
      schema: SKEPTIC_SCHEMA,
      schemaName: "skeptic_check",
      effort: "medium",
    })
  )) as {
    competitor_checks?: Array<{ competitor_number?: unknown; supported?: unknown }>;
    claim_checks?: Array<{ claim?: unknown; verdict?: unknown }>;
    strongest_objection?: unknown;
  } | null;

  const rejected = new Set<number>();
  for (const check of Array.isArray(parsed?.competitor_checks) ? parsed!.competitor_checks : []) {
    const n = Number(check?.competitor_number);
    if (Number.isInteger(n) && n >= 1 && n <= competitors.length && check?.supported === false) {
      rejected.add(n - 1);
    }
  }
  const kept = competitors.filter((_, i) => !rejected.has(i));
  const removed = competitors.filter((_, i) => rejected.has(i)).map((c) => c.name);

  const claims = (Array.isArray(parsed?.claim_checks) ? parsed!.claim_checks : [])
    .map((c) => ({ claim: str(c?.claim).slice(0, 300), verdict: str(c?.verdict) }))
    .filter((c) => c.claim && c.verdict)
    .slice(0, 8);
  const unsupported = claims
    .filter((c) => c.verdict === "unsupported" || c.verdict === "contradicted")
    .map((c) => (c.verdict === "contradicted" ? `${c.claim} (the sources say otherwise)` : c.claim));
  const supportedCount =
    claims.filter((c) => c.verdict === "supported" || c.verdict === "labelled_estimate").length +
    kept.length;

  const flags = new Set(report.grounding_flags);
  for (const name of removed) {
    flags.add(`Skeptic removed competitor "${name}": its cited source does not back it.`);
  }
  for (const claim of unsupported) flags.add(`Skeptic: not supported by the sources: ${claim}`);

  const checked = competitors.length + claims.length;
  const weakEvidence = checked > 0 && supportedCount / checked < 0.5;
  return {
    ...report,
    competitors: kept,
    idea_score: {
      ...report.idea_score,
      // Mostly unsupported evidence cannot carry a confident verdict.
      confidence: weakEvidence ? "low" : report.idea_score.confidence,
    },
    grounding_flags: Array.from(flags),
    skeptic: {
      checked,
      supported: supportedCount,
      removed,
      unsupported,
      counterargument: withoutNames(str(parsed?.strongest_objection), removed).slice(0, 600),
    },
  };
}

/**
 * Runs the Skeptic, but never lets it sink a finished report: if it fails for
 * any reason other than quota, the report goes out with a note instead.
 */
export async function stepSkepticSafe(
  input: AnalyzeInput,
  scout: ScoutResult,
  report: ForgeReport,
  llm: Llm,
  rethrow: (err: unknown) => boolean = () => false
): Promise<ForgeReport> {
  try {
    return await stepSkeptic(input, scout, report, llm);
  } catch (err) {
    if (rethrow(err)) throw err;
    return {
      ...report,
      grounding_flags: [
        ...report.grounding_flags,
        "The Skeptic check could not run on this report, so its claims were not double-checked.",
      ],
    };
  }
}

/**
 * Runs one analysis and reports progress through emit: "phase" events, then
 * exactly one of "clarification", "report" or "error".
 */
export async function runAnalysis(
  input: AnalyzeInput,
  deps: AnalysisDeps,
  emit: Emit
): Promise<void> {
  const { llm } = deps;
  try {
    // Phase 1: Problem — one clarifying question if the idea is too vague
    emit("phase", { phaseIndex: 0, phaseName: "Problem" });
    const question = await stepClarity(input, llm);
    if (question) {
      emit("clarification", { question });
      return;
    }
    if (deps.isCancelled()) return;

    // Phases 2-4: Customer, Market, Competition — the Scout's web research
    emit("phase", { phaseIndex: 1, phaseName: "Customer" });
    emit("phase", { phaseIndex: 2, phaseName: "Market" });
    emit("phase", { phaseIndex: 3, phaseName: "Competition" });
    const scout = await stepScout(input, deps);
    if (deps.isCancelled()) return;

    // Phase 5: Business Model — the Analyst writes the report
    emit("phase", { phaseIndex: 4, phaseName: "Business Model" });
    const report = await stepAnalyst(input, scout, llm);
    if (deps.isCancelled()) return;

    // Phase 6: Execution Risk — the Skeptic checks it against the sources
    emit("phase", { phaseIndex: 5, phaseName: "Execution Risk" });
    const checked = await stepSkepticSafe(input, scout, report, llm);
    emit("report", { report: checked });
  } catch (err) {
    emit("error", { error: formatApiError(err, llm) });
  }
}
