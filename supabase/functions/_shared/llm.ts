// Model access for FORGE. Two back ends sit behind one interface:
//  - Gemini (Google's API), which can also ground research in Google Search.
//  - Any OpenAI-compatible chat API (OpenRouter, NVIDIA NIM, Groq, Ollama, ...),
//    which is how open models such as NVIDIA Nemotron are used.
/** Configuration values, read from the process or Deno environment by the caller. */
export type Env = Record<string, string | undefined>;

/** Schema in the Gemini SDK's shape: `type` is an upper-case name such as "OBJECT". */
export interface SchemaNode {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
}

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: SchemaNode;
  /** Short identifier for the schema, e.g. "forge_report". */
  schemaName: string;
  effort: "low" | "medium";
}

export interface ResearchResult {
  notes: string;
  sources: Array<{ title: string; url: string }>;
}

export interface Llm {
  /** Human name used in error messages, e.g. "Gemini" or "OpenRouter". */
  label: string;
  model: string;
  keyConfigured: boolean;
  /** Name of the environment variable that holds this provider's key. */
  keyVariable: string;
  generateJson(request: JsonRequest): Promise<unknown>;
  /** Web-grounded research, or null when this provider cannot search the web. */
  research: ((system: string, prompt: string) => Promise<ResearchResult>) | null;
}

/**
 * Longest a single model request may take. Hosted steps must finish inside
 * the free plan's 150 s limit, so a stuck provider has to give up early
 * enough for the next provider to answer.
 */
export const MODEL_CALL_TIMEOUT_MS = 60_000;

export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Pulls the JSON object out of a model reply that may wrap it in prose or fences. */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new LlmError("The model did not return valid JSON.");
  }
}

/** Converts the Gemini-shaped schema to standard JSON Schema. */
export function toJsonSchema(node: SchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = { type: node.type.toLowerCase() };
  if (node.description) out.description = node.description;
  if (node.enum) out.enum = node.enum;
  if (node.items) out.items = toJsonSchema(node.items);
  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties).map(([k, v]) => [k, toJsonSchema(v)])
    );
    out.required = node.required ?? Object.keys(node.properties);
    out.additionalProperties = false;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gemini (REST, so no SDK is needed in either runtime)
// ---------------------------------------------------------------------------

interface GeminiResponse {
  error?: { code?: number; message?: string };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
}

/**
 * Picks a model when GEMINI_MODEL is not set: the newest "flash-lite" model
 * the key can call (the family with the most generous free quota), else the
 * newest "flash" model. Model names change often, so this avoids hard-coding one.
 */
async function pickGeminiModel(baseUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1beta/models?pageSize=200`, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new LlmError(`Could not list Gemini models (${res.status}).`, res.status);
  }
  const body = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  const usable = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/preview|exp|tts|image|audio|live|thinking/.test(n));
  const version = (n: string) => Number(n.match(/^gemini-([\d.]+)/)?.[1] ?? 0);
  const newest = (list: string[]) => list.sort((a, b) => version(b) - version(a))[0];
  const pick =
    newest(usable.filter((n) => n.includes("flash-lite"))) ??
    newest(usable.filter((n) => !n.includes("lite")));
  if (!pick) throw new LlmError("No usable Gemini Flash model is available for this key.");
  return pick;
}

function createGemini(env: Env): Llm {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const configuredModel = env.GEMINI_MODEL?.trim() ?? "";
  const baseUrl = (
    env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com"
  ).replace(/\/+$/, "");
  let model = configuredModel || "auto";
  let modelReady: Promise<string> | null = configuredModel
    ? Promise.resolve(configuredModel)
    : null;
  const resolveModel = (): Promise<string> => {
    if (!modelReady) {
      modelReady = pickGeminiModel(baseUrl, apiKey ?? "").then((picked) => {
        model = picked;
        return picked;
      });
      // A failed lookup should be retried on the next request, not cached.
      modelReady.catch(() => {
        modelReady = null;
      });
    }
    return modelReady;
  };

  const generate = async (
    body: Record<string, unknown>
  ): Promise<{ text: string; response: GeminiResponse }> => {
    if (!apiKey) {
      throw new LlmError("GEMINI_API_KEY is not configured on the server.");
    }
    const modelName = await resolveModel();
    const res = await fetch(
      `${baseUrl}/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      }
    );
    const raw = await res.text();
    let response: GeminiResponse = {};
    try {
      response = JSON.parse(raw);
    } catch {
      // Non-JSON body; handled below.
    }
    if (!res.ok || response.error) {
      throw new LlmError(
        response.error?.message || raw.slice(0, 300) || res.statusText,
        response.error?.code ?? res.status
      );
    }
    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    return { text, response };
  };

  return {
    label: "Gemini",
    get model() {
      return model;
    },
    keyConfigured: Boolean(apiKey),
    keyVariable: "GEMINI_API_KEY",
    async generateJson({ system, prompt, schema, effort }) {
      // The model must be known before building the request (see below).
      const modelName = apiKey ? await resolveModel() : model;
      const { text } = await generate({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          // Flash-Lite models reject thinking settings, so only send them elsewhere.
          ...(modelName.includes("lite") ? {} : { thinkingConfig: { thinkingLevel: effort } }),
          seed: 42,
        },
      });
      if (!text) throw new LlmError("The model returned an empty response.");
      return extractJson(text);
    },
    async research(system, prompt) {
      const { text, response } = await generate({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { seed: 42 },
      });
      const sources: ResearchResult["sources"] = [];
      const seen = new Set<string>();
      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      for (const chunk of chunks) {
        const url = chunk.web?.uri?.trim();
        if (url && !seen.has(url)) {
          seen.add(url);
          sources.push({ title: chunk.web?.title?.trim() || url, url });
        }
      }
      return { notes: text, sources };
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat API
// ---------------------------------------------------------------------------

function providerLabel(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    if (host.endsWith("openrouter.ai")) return "OpenRouter";
    if (host.endsWith("nvidia.com")) return "NVIDIA";
    if (host.endsWith("groq.com")) return "Groq";
    if (host === "localhost" || host === "127.0.0.1") return "The local model";
    return host;
  } catch {
    return "The model provider";
  }
}

function createOpenAiCompatible(baseUrl: string, env: Env): Llm {
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim() ?? "";
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const chat = async (
    messages: Array<{ role: string; content: string }>,
    responseFormat: Record<string, unknown> | null
  ): Promise<string> => {
    if (!model) {
      throw new LlmError("LLM_MODEL is not configured on the server.");
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        seed: 42,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });

    const bodyText = await response.text();
    let body: {
      error?: { message?: string; code?: number | string } | string;
      choices?: Array<{ message?: { content?: string | null } }>;
    } = {};
    try {
      body = JSON.parse(bodyText);
    } catch {
      // Non-JSON body; handled below.
    }

    // Some gateways report upstream failures inside a 200 response.
    const error = body.error;
    if (!response.ok || error) {
      const message =
        typeof error === "string"
          ? error
          : error?.message || bodyText.slice(0, 300) || response.statusText;
      const code =
        typeof error === "object" && typeof error?.code === "number"
          ? error.code
          : undefined;
      throw new LlmError(message, response.ok ? code : response.status);
    }

    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new LlmError("The model returned an empty response.");
    return content;
  };

  // Strictest format first. Providers and open models differ in what they
  // accept, so step down when one is rejected and remember what worked.
  let formatLevel = 0;

  return {
    label: providerLabel(baseUrl),
    model,
    keyConfigured: Boolean(apiKey),
    keyVariable: "LLM_API_KEY",
    research: null,
    async generateJson({ system, prompt, schema, schemaName }) {
      const jsonSchema = toJsonSchema(schema);
      const formats: Array<Record<string, unknown> | null> = [
        {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema: jsonSchema },
        },
        { type: "json_object" },
        null,
      ];
      const messages = [
        {
          role: "system",
          content: `${system}\n\nReply with one JSON object and nothing else: no prose, no code fences. It must match this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`,
        },
        { role: "user", content: prompt },
      ];

      let lastError: unknown;
      for (let level = formatLevel; level < formats.length; level++) {
        try {
          const text = await chat(messages, formats[level]);
          const parsed = extractJson(text);
          formatLevel = level;
          return parsed;
        } catch (err) {
          lastError = err;
          const status = err instanceof LlmError ? err.status : undefined;
          // 400/404/422 here mean "this response_format is not supported".
          const formatRejected =
            formats[level] !== null &&
            (status === 400 || status === 404 || status === 422);
          if (!formatRejected) throw err;
        }
      }
      throw lastError;
    },
  };
}

export function createLlm(env: Env): Llm {
  const baseUrl = env.LLM_BASE_URL?.trim();
  return baseUrl ? createOpenAiCompatible(baseUrl, env) : createGemini(env);
}

/** True when a provider refused because a rate or daily quota ran out, or is overloaded. */
export function isQuotaOrOverload(err: unknown): boolean {
  const status = err instanceof LlmError ? err.status : undefined;
  if (status === 429 || status === 503) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|quota|rate limit|free-models-per-day|overloaded|UNAVAILABLE/i.test(
    message
  );
}

/** True when a request was cut off by its own time limit. */
export function isTimeout(err: unknown): boolean {
  if (err instanceof Error && err.name === "TimeoutError") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /timed out|aborted due to timeout/i.test(message);
}

/** How long a provider that ran out of quota is skipped before being tried again. */
const COOL_DOWN_MS = 10 * 60 * 1000;

/**
 * Every provider that has a key, in order: Gemini first (largest free daily
 * allowance), then the OpenAI-compatible provider (OpenRouter by default).
 * When one runs out of quota the next takes over, so free allowances stack.
 */
export function createLlmChain(env: Env, defaults: Env = {}): Llm {
  const providers: Llm[] = [];
  if (env.GEMINI_API_KEY?.trim()) providers.push(createGemini(env));
  const baseUrl = env.LLM_BASE_URL?.trim() || defaults.LLM_BASE_URL;
  if (baseUrl && (env.LLM_API_KEY?.trim() || env.LLM_BASE_URL?.trim())) {
    providers.push(
      createOpenAiCompatible(baseUrl, {
        ...env,
        LLM_MODEL: env.LLM_MODEL?.trim() || defaults.LLM_MODEL,
      })
    );
  }
  if (providers.length === 0) return createLlm(env);
  if (providers.length === 1) return providers[0];

  const coolingUntil = new Map<Llm, number>();
  // The provider that served most recently; error messages name it.
  let current = providers[0];

  const ordered = (): Llm[] => {
    const now = Date.now();
    const ready = providers.filter((p) => (coolingUntil.get(p) ?? 0) <= now);
    // If every provider is cooling down, still try them all in order.
    return ready.length > 0 ? ready : providers;
  };

  async function attempt<T>(run: (p: Llm) => Promise<T>, onlyWith?: (p: Llm) => boolean): Promise<T> {
    let lastError: unknown;
    for (const provider of ordered()) {
      if (onlyWith && !onlyWith(provider)) continue;
      current = provider;
      try {
        return await run(provider);
      } catch (err) {
        lastError = err;
        // A slow provider is treated like an exhausted one: try the next.
        if (!isQuotaOrOverload(err) && !isTimeout(err)) throw err;
        coolingUntil.set(provider, Date.now() + COOL_DOWN_MS);
      }
    }
    throw lastError ?? new LlmError("No AI provider is available.");
  }

  const researcher = providers.find((p) => p.research);
  return {
    get label() {
      return current.label;
    },
    get model() {
      return current.model;
    },
    get keyVariable() {
      return current.keyVariable;
    },
    keyConfigured: providers.some((p) => p.keyConfigured),
    generateJson: (request) => attempt((p) => p.generateJson(request)),
    research: researcher
      ? (system, prompt) => attempt((p) => p.research!(system, prompt), (p) => Boolean(p.research))
      : null,
  };
}

/** Names of the providers in a chain, for the health check. */
export function describeChain(env: Env): string[] {
  const names: string[] = [];
  if (env.GEMINI_API_KEY?.trim()) names.push("Gemini");
  if (env.LLM_API_KEY?.trim() || env.LLM_BASE_URL?.trim()) names.push("OpenAI-compatible");
  return names;
}
