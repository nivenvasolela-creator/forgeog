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

function createGemini(env: Env): Llm {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const model = env.GEMINI_MODEL?.trim() || "gemini-4-hydrogen";
  const baseUrl = (
    env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com"
  ).replace(/\/+$/, "");

  const generate = async (
    body: Record<string, unknown>
  ): Promise<{ text: string; response: GeminiResponse }> => {
    if (!apiKey) {
      throw new LlmError("GEMINI_API_KEY is not configured on the server.");
    }
    const res = await fetch(
      `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(150_000),
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
    model,
    keyConfigured: Boolean(apiKey),
    keyVariable: "GEMINI_API_KEY",
    async generateJson({ system, prompt, schema, effort }) {
      const { text } = await generate({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          thinkingConfig: { thinkingLevel: effort },
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
      signal: AbortSignal.timeout(150_000),
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
