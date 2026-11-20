// Ask FORGE: the founder's chat with FORGE. It answers questions, concerns
// and "explain this" requests from everything FORGE knows about the founder
// (profile, ideas, the agents' reports, experiments, sprint), searches the web
// through the Scout when an answer needs outside facts, and suggests next
// steps the app turns into buttons. The same chat runs in the app and on
// Telegram. Runtime-neutral: plain fetch via the Db client.
import type { Llm, SchemaNode } from "./llm.ts";
import type { WebSearch } from "./search.ts";
import type { Db } from "./nexus.ts";
import { str, strList, withRetry } from "./analysis.ts";
import { languageRule, parseProfile, profileBlock, type Language } from "./founder.ts";

export const MAX_CHAT_MESSAGE = 2000;
/** Questions a founder may ask per window, across the app and Telegram. */
export const CHAT_LIMIT = 20;
const CHAT_WINDOW_MS = 10 * 60 * 1000;
const HISTORY_TURNS = 10;
const MAX_IDEAS = 8;

export type ChatChannel = "web" | "telegram";

export type ChatAction =
  | { type: "run_analysis"; ideaText: string }
  | { type: "open_idea"; ideaId: string; title: string }
  | { type: "build_sprint"; ideaId: string; title: string }
  | { type: "edit_profile" };

export interface ChatAnswer {
  reply: string;
  sources: Array<{ title: string; url: string }>;
  actions: ChatAction[];
  ideaId: string | null;
}

// ---------------------------------------------------------------------------
// What FORGE knows about the founder
// ---------------------------------------------------------------------------

interface SprintTask {
  title?: string;
  material_title?: string;
}
interface SprintData {
  plan?: {
    goal?: string;
    success_metric?: string;
    days?: Array<{ day?: number; theme?: string; tasks?: SprintTask[] }>;
  };
  done?: string[];
}

export interface SprintToday {
  day: number;
  theme: string;
  tasks: Array<{ title: string; material: string }>;
  done: number;
  total: number;
  goal: string;
}

/** The first sprint day with unfinished tasks, and overall progress. */
export function sprintToday(data: unknown): SprintToday | null {
  const sprint = (data ?? {}) as SprintData;
  const days = Array.isArray(sprint.plan?.days) ? sprint.plan!.days! : [];
  if (days.length === 0) return null;
  const done = new Set(Array.isArray(sprint.done) ? sprint.done : []);
  let total = 0;
  let finished = 0;
  let today: SprintToday | null = null;
  for (const day of days) {
    const n = Number(day.day) || 0;
    const tasks = Array.isArray(day.tasks) ? day.tasks : [];
    tasks.forEach((task, i) => {
      total++;
      const isDone = done.has(`${n}-${i}`);
      if (isDone) finished++;
      if (!isDone && (!today || today.day === n)) {
        if (!today) {
          today = { day: n, theme: str(day.theme), tasks: [], done: 0, total: 0, goal: "" };
        }
        today.tasks.push({ title: str(task.title), material: str(task.material_title) });
      }
    });
  }
  const result = today ?? { day: 0, theme: "", tasks: [], done: 0, total: 0, goal: "" };
  return { ...result, done: finished, total, goal: str(sprint.plan?.goal) };
}

interface IdeaRow {
  id: string;
  title: string;
  updated_at: string;
}
interface ReportRow {
  idea_id: string;
  data: Record<string, any>;
  created_at: string;
}
interface ExperimentRow {
  idea_id: string;
  title: string;
  status: string;
  outcome: string | null;
  notes: string;
}
interface SprintRow {
  idea_id: string;
  data: unknown;
}

export interface FounderContext {
  text: string;
  profile: Record<string, unknown> | null;
  language: Language;
  /** Ideas in the order they are numbered in the text (1-based). */
  ideas: Array<{ id: string; title: string; hasSprint: boolean }>;
  focusId: string | null;
}

const short = (value: unknown, max: number) => {
  const s = str(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Loads the founder's profile and ideas and writes them up for the model. */
export async function loadFounderContext(
  db: Db,
  userId: string,
  focusIdeaId: string | null,
): Promise<FounderContext> {
  const uid = encodeURIComponent(userId);
  const [profiles, ideas] = await Promise.all([
    db.select<Record<string, unknown>>("profiles", `user_id=eq.${uid}&select=*`),
    db.select<IdeaRow>(
      "ideas",
      `user_id=eq.${uid}&select=id,title,updated_at&order=updated_at.desc&limit=${MAX_IDEAS}`,
    ),
  ]);
  const profile = profiles[0] ?? null;
  const language: Language = profile?.language === "sw" ? "sw" : "en";
  const ids = ideas.map((i) => i.id);
  const focusId =
    focusIdeaId && ids.includes(focusIdeaId) ? focusIdeaId : (ids[0] ?? null);

  let reports: ReportRow[] = [];
  let experiments: ExperimentRow[] = [];
  let sprints: SprintRow[] = [];
  if (ids.length > 0) {
    const inList = `in.(${ids.join(",")})`;
    [reports, experiments, sprints] = await Promise.all([
      db.select<ReportRow>(
        "reports",
        `user_id=eq.${uid}&idea_id=${inList}&select=idea_id,data,created_at&order=created_at.desc&limit=24`,
      ),
      db.select<ExperimentRow>(
        "experiments",
        `user_id=eq.${uid}&idea_id=${inList}&select=idea_id,title,status,outcome,notes&order=created_at.asc&limit=80`,
      ),
      db.select<SprintRow>("sprints", `user_id=eq.${uid}&idea_id=${inList}&select=idea_id,data`),
    ]);
  }
  const latest = new Map<string, ReportRow>();
  const versions = new Map<string, number>();
  for (const r of reports) {
    if (!latest.has(r.idea_id)) latest.set(r.idea_id, r);
    versions.set(r.idea_id, (versions.get(r.idea_id) ?? 0) + 1);
  }
  const sprintByIdea = new Map(sprints.map((s) => [s.idea_id, s.data]));

  const blocks: string[] = [];
  ideas.forEach((idea, idx) => {
    const report = latest.get(idea.id)?.data ?? {};
    const score = report.idea_score ?? {};
    const decision = report.decision ?? {};
    const isFocus = idea.id === focusId;
    const lines = [
      `IDEA ${idx + 1}: ${idea.title}${isFocus ? "  <- the idea the founder is looking at" : ""}`,
      `  Summary: ${short(report.idea_summary, 300)}`,
      `  FORGE decision: ${str(decision.call).toUpperCase() || "none"} — ${short(decision.reason, isFocus ? 600 : 200)}`,
      `  Score: ${Number(score.overall) || 0}/100 (confidence ${str(score.confidence) || "low"}); report versions: ${versions.get(idea.id) ?? 0}`,
    ];
    if (isFocus) {
      const b = score.breakdown ?? {};
      const bp = report.blueprint ?? {};
      const plan = report.business_plan ?? {};
      const swot = report.swot ?? {};
      const skeptic = report.skeptic;
      lines.push(
        `  Score breakdown (0-10): problem clarity ${b.problem_clarity ?? "?"}, market signal ${b.market_signal ?? "?"}, founder fit ${b.founder_fit ?? "?"}, feasibility ${b.feasibility ?? "?"}, differentiation ${b.differentiation ?? "?"}`,
        `  Opportunity (the market on its own): ${score.opportunity ?? "?"}/100; founder readiness (this founder, now): ${score.readiness ?? "?"}/100`,
        `  Readiness gaps: ${strList(score.readiness_gaps).join(" | ") || "none listed"}`,
        `  Licences and rules to check: ${
          (Array.isArray(report.regulation) ? report.regulation : [])
            .map((r: Record<string, unknown>) => `${str(r.area)} (${short(r.check_with, 80)})`)
            .join("; ") || "none flagged"
        }`,
        `  Why this score: ${short(score.rationale, 600)}`,
        `  Problem: ${short(bp.problem, 300)}`,
        `  Target user: ${short(bp.target_user, 200)}`,
        `  Solution: ${short(bp.solution, 300)}`,
        `  Business model: ${short(bp.business_model, 300)}`,
        `  Key risks: ${strList(bp.key_risks).slice(0, 5).join(" | ")}`,
        `  Strengths: ${strList(swot.strengths).slice(0, 4).join(" | ")}`,
        `  Weaknesses: ${strList(swot.weaknesses).slice(0, 4).join(" | ")}`,
        `  Market size (estimate): ${short(plan.tam_estimate, 300)}`,
        `  Pricing (hypothesis): ${short(plan.pricing_hypothesis, 300)}`,
        `  Go-to-market: ${short(plan.go_to_market, 300)}`,
        `  Pivot ideas: ${strList(decision.pivots).join(" | ") || "none"}`,
        `  Competitors (each backed by a web source): ${
          (Array.isArray(report.competitors) ? report.competitors : [])
            .slice(0, 6)
            .map((c: Record<string, unknown>) => `${str(c.name)} (${short(c.what_they_do, 100)})`)
            .join("; ") || "none verified"
        }`,
        `  Unverified points flagged by FORGE: ${strList(report.grounding_flags).slice(0, 6).map((f) => short(f, 160)).join(" | ") || "none"}`,
      );
      if (skeptic && typeof skeptic === "object") {
        lines.push(
          `  Skeptic agent: ${skeptic.supported ?? 0} of ${skeptic.checked ?? 0} checks backed by sources; removed: ${strList(skeptic.removed).join(", ") || "none"}; strongest objection: ${short(skeptic.counterargument, 400)}`,
        );
      }
      const exps = experiments.filter((e) => e.idea_id === idea.id);
      lines.push(
        `  Experiments: ${
          exps
            .slice(0, 10)
            .map(
              (e) =>
                `"${short(e.title, 120)}" [${e.status}${e.outcome ? `, ${e.outcome}` : ""}]${e.notes ? ` notes: ${short(e.notes, 160)}` : ""}`,
            )
            .join("; ") || "none"
        }`,
      );
      const today = sprintToday(sprintByIdea.get(idea.id));
      lines.push(
        today
          ? `  7-day sprint: ${today.done}/${today.total} tasks done. Goal: ${short(today.goal, 200)}. ${
              today.tasks.length > 0
                ? `Next up (day ${today.day}, ${today.theme}): ${today.tasks.map((t) => t.title).join(" | ")}`
                : "All tasks done."
            }`
          : "  7-day sprint: not built yet.",
      );
    } else {
      lines.push(`  7-day sprint: ${sprintByIdea.has(idea.id) ? "built" : "not built"}`);
    }
    blocks.push(lines.join("\n"));
  });

  const text = `FOUNDER PROFILE:
${profileBlock(parseProfile(profile))}

THE FOUNDER'S IDEAS IN FORGE (${ideas.length}):
${blocks.length > 0 ? blocks.join("\n\n") : "None yet. The founder has not tested an idea."}`;

  return {
    text,
    profile,
    language,
    ideas: ideas.map((i) => ({ id: i.id, title: i.title, hasSprint: sprintByIdea.has(i.id) })),
    focusId,
  };
}

// ---------------------------------------------------------------------------
// The chat itself
// ---------------------------------------------------------------------------

const CHAT_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    needs_web_search: {
      type: "BOOLEAN",
      description:
        "True only when a good answer needs current outside facts that are not in the context (prices, competitors, regulations, fees, market data, how-to steps for a specific service). Then leave reply empty.",
    },
    search_query: {
      type: "STRING",
      description: "When needs_web_search is true: one short web search query. Otherwise empty.",
    },
    reply: {
      type: "STRING",
      description:
        "The answer to the founder. Plain text; **bold** and lines starting with '- ' or '1. ' are allowed. Under 250 words.",
    },
    actions: {
      type: "ARRAY",
      description: "0 to 2 next steps the app shows as buttons. Only when clearly useful.",
      items: {
        type: "OBJECT",
        properties: {
          type: {
            type: "STRING",
            enum: ["run_analysis", "open_idea", "build_sprint", "edit_profile"],
            description:
              "run_analysis: test a new or changed idea with FORGE's full agent analysis. open_idea: open an idea's report. build_sprint: build a 7-day sprint for an idea that has none. edit_profile: the founder should tell FORGE more about themselves.",
          },
          idea_number: {
            type: "INTEGER",
            description: "For open_idea and build_sprint: the IDEA number from the context. Otherwise 0.",
          },
          idea_text: {
            type: "STRING",
            description:
              "For run_analysis: the full idea to test, in 1-3 sentences naming customer, problem and how it makes money. Otherwise empty.",
          },
        },
        required: ["type", "idea_number", "idea_text"],
      },
    },
  },
  required: ["needs_web_search", "search_query", "reply", "actions"],
};

const CHAT_SYSTEM = `You are FORGE, a founder operating system and co-pilot for first-time founders, many in Tanzania and East Africa. The founder asks you questions, raises concerns, or asks you to explain parts of their reports. You know their profile, their ideas and the work of FORGE's agents: the Scout (found real web sources), the Analyst (scored the idea and wrote the report), the Skeptic (fact-checked it against the sources), plus their experiments and their 7-day sprint. You can also ask the Scout to search the web.

How to answer:
- Be direct, warm and practical. Short paragraphs or short bullet lists. No hype and no filler.
- Ground answers in the context. When you use a number from the reports, say whether it is an estimate.
- Never invent facts, figures, competitors, prices, fees or laws. Every number you give must come from the context or the search results, never from "typical rates" or your own guess. If you do not know and search cannot help, say so and say how the founder can check.
- Explain jargon (TAM, MVP, unit economics...) in plain words with a local example when useful.
- When the founder is worried or stuck, name the real risk, then give the smallest next step they can take today.
- Tanzania registration questions: BRELA registers business names and companies (online at ors.brela.go.tz), TRA issues the TIN and handles tax, and the local council issues the business licence. Tell them to confirm current fees on the official sites.
- If they describe a new or changed idea, offer a run_analysis action so FORGE's agents test it properly.
- If the founder has no ideas in FORGE yet, do not give a generic answer. Help them find a first idea: ask one or two short questions about problems they see every day, their skills and who they know, or suggest 2-3 concrete small business ideas that fit their profile and location, then offer a run_analysis action for the most promising one.
- Readiness is not destiny: when a founder's readiness is low, show the smallest version they can start now and how to close the gap (a partner, a skill, a cheaper first step).`;

const ACTION_TYPES = new Set(["run_analysis", "open_idea", "build_sprint", "edit_profile"]);

function cleanActions(raw: unknown, context: FounderContext): ChatAction[] {
  const actions: ChatAction[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const a = (item ?? {}) as Record<string, unknown>;
    const type = str(a.type);
    if (!ACTION_TYPES.has(type)) continue;
    const idea = context.ideas[Number(a.idea_number) - 1];
    let action: ChatAction | null = null;
    if (type === "run_analysis") {
      const ideaText = str(a.idea_text).slice(0, 1500);
      if (ideaText) action = { type, ideaText };
    } else if (type === "edit_profile") {
      action = { type };
    } else if (idea && (type === "open_idea" || !idea.hasSprint)) {
      action = { type: type as "open_idea" | "build_sprint", ideaId: idea.id, title: idea.title };
    }
    const key = JSON.stringify(action);
    if (action && !seen.has(key)) {
      seen.add(key);
      actions.push(action);
    }
  }
  return actions.slice(0, 2);
}

/** True when the founder has asked too many questions recently. */
export async function chatRateLimited(db: Db, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - CHAT_WINDOW_MS).toISOString();
  const rows = await db.select<{ id: string }>(
    "chat_messages",
    `user_id=eq.${encodeURIComponent(userId)}&role=eq.user&created_at=gt.${encodeURIComponent(since)}&select=id&limit=${CHAT_LIMIT + 1}`,
  );
  return rows.length >= CHAT_LIMIT;
}

/** Answers one founder message, saving both sides of the exchange. */
export async function askForge(opts: {
  db: Db;
  llm: Llm;
  search: WebSearch | null;
  userId: string;
  message: string;
  ideaId: string | null;
  language?: Language;
  channel: ChatChannel;
}): Promise<ChatAnswer> {
  const { db, llm, search, userId, channel } = opts;
  const message = opts.message.trim().slice(0, MAX_CHAT_MESSAGE);
  const [context, history] = await Promise.all([
    loadFounderContext(db, userId, opts.ideaId),
    db.select<{ role: string; content: string }>(
      "chat_messages",
      `user_id=eq.${encodeURIComponent(userId)}&select=role,content&order=created_at.desc&limit=${HISTORY_TURNS}`,
    ),
  ]);
  const language = opts.language ?? context.language;

  // Save the question first so it counts towards the limit even if the answer fails.
  await db.insert("chat_messages", {
    user_id: userId,
    role: "user",
    content: message,
    idea_id: context.focusId,
    channel,
  });

  const conversation = history
    .reverse()
    .map((m) => `${m.role === "user" ? "FOUNDER" : "FORGE"}: ${short(m.content, 700)}`)
    .join("\n");
  const basePrompt = `${context.text}

RECENT CONVERSATION:
${conversation || "(this is the first message)"}

FOUNDER'S NEW MESSAGE${channel === "telegram" ? " (sent from Telegram)" : ""}:
"""
${message}
"""`;
  const system = CHAT_SYSTEM + languageRule(language);

  const ask = (prompt: string) =>
    withRetry(() =>
      llm.generateJson({ system, prompt, schema: CHAT_SCHEMA, schemaName: "ask_forge", effort: "low" }),
    ) as Promise<Record<string, unknown> | null>;

  let parsed = await ask(
    `${basePrompt}\n\nAnswer the founder, or set needs_web_search if you need current outside facts first.${
      search ? "" : " (Web search is not available right now: answer from the context and say what you could not check.)"
    }`,
  );
  let sources: ChatAnswer["sources"] = [];
  const query = str(parsed?.search_query);
  if (search && parsed?.needs_web_search === true && query) {
    let results = "No results came back.";
    try {
      const hits = await search.search(query, 5);
      sources = hits.map((h) => ({ title: h.title, url: h.url }));
      if (hits.length > 0) {
        results = hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.snippet || "(no extract)"}`).join("\n");
      }
    } catch {
      results = "The web search failed.";
    }
    parsed = await ask(
      `${basePrompt}\n\nTHE SCOUT SEARCHED THE WEB FOR "${query}":\n${results}\n\nNow answer the founder using these results where they help, citing them as [1], [2]... Do not ask for another search: needs_web_search must be false. If the results do not answer the question, say so plainly.`,
    );
  }

  let reply = str(parsed?.reply).slice(0, 4000);
  if (!reply) {
    reply =
      language === "sw"
        ? "Samahani, sikuweza kuandaa jibu sasa hivi. Jaribu kuuliza tena kwa maneno mengine."
        : "Sorry, I could not put an answer together just now. Try asking again in other words.";
  }
  // Keep only sources the reply actually cites.
  const cited = sources.filter((_, i) => reply.includes(`[${i + 1}]`));
  const answer: ChatAnswer = {
    reply,
    sources: cited.length > 0 ? sources : [],
    actions: cleanActions(parsed?.actions, context),
    ideaId: context.focusId,
  };
  await db.insert("chat_messages", {
    user_id: userId,
    role: "assistant",
    content: answer.reply,
    data: { sources: answer.sources, actions: answer.actions },
    idea_id: context.focusId,
    channel,
  });
  return answer;
}
