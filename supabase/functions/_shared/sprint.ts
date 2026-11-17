// The execution sprint: turns a validated idea into a 7-day plan of small,
// concrete tasks, each with step-by-step guidance and a ready-to-use material
// (a script, message or template) so the founder can act today.
import type { Llm, SchemaNode } from "./llm.ts";
import {
  formatApiError,
  str,
  strList,
  withRetry,
  type Emit,
} from "./analysis.ts";
import {
  languageRule,
  parseLanguage,
  parseProfile,
  profileBlock,
  type Language,
} from "./founder.ts";

const MAX_FIELD = 2000;
/** A plan with fewer days than this is asked for again. */
const MIN_DAYS = 5;
const MAX_ATTEMPTS = 3;
/** Hosted functions are cut off at 150 s, so only retry while there is time for one more call. */
const RETRY_BUDGET_MS = 70_000;

export interface SprintInput {
  ideaTitle: string;
  ideaSummary: string;
  decision: string;
  blueprint: string;
  validateNext: string[];
  doneLines: string[];
  profileLines: string[];
  language: Language;
}

export interface SprintTask {
  title: string;
  why: string;
  steps: string[];
  material_title: string;
  material: string;
}

export interface SprintDay {
  day: number;
  theme: string;
  tasks: SprintTask[];
}

export interface SprintPlan {
  goal: string;
  success_metric: string;
  days: SprintDay[];
}

const SPRINT_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    goal: {
      type: "STRING",
      description:
        "One sentence: what the founder will have proven or built by the end of the 7 days.",
    },
    success_metric: {
      type: "STRING",
      description:
        "One measurable target for the week, e.g. '10 customer conversations and 3 people agreeing to pay'.",
    },
    days: {
      type: "ARRAY",
      description: "Exactly 7 days, in order.",
      items: {
        type: "OBJECT",
        properties: {
          day: { type: "INTEGER", description: "1 to 7" },
          theme: { type: "STRING", description: "Short focus for the day." },
          tasks: {
            type: "ARRAY",
            description: "1 or 2 tasks, each doable in under 2 hours.",
            items: {
              type: "OBJECT",
              properties: {
                title: {
                  type: "STRING",
                  description: "Starts with a verb. Specific and small.",
                },
                why: {
                  type: "STRING",
                  description: "One sentence: what this proves or unlocks.",
                },
                steps: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description:
                    "3 or 4 short how-to steps a first-time founder can follow without help.",
                },
                material_title: {
                  type: "STRING",
                  description:
                    "Name of the ready-to-use material, e.g. 'WhatsApp message to send' or 'Interview questions'. Empty if none.",
                },
                material: {
                  type: "STRING",
                  description:
                    "The full material, ready to copy and use as-is (under 70 words): a message, script, questions, post, or form text. Empty if none.",
                },
              },
              required: ["title", "why", "steps", "material_title", "material"],
            },
          },
        },
        required: ["day", "theme", "tasks"],
      },
    },
  },
  required: ["goal", "success_metric", "days"],
};

const SPRINT_SYSTEM =
  "You are FORGE's execution coach. Founders suffer from analysis paralysis; your job is to get them doing real things this week. Give small, concrete, cheap actions in the real world: talking to customers, pre-selling, posting offers, building the simplest possible version. Prefer free tools and channels the founder actually has (WhatsApp, Instagram, phone calls, visiting people in person, free form builders). Never pad the plan with research or planning tasks. Every material must be complete and usable as written, with placeholders like [your name] only where unavoidable.";

function clip(value: unknown, max = MAX_FIELD): string {
  return str(value).slice(0, max);
}

/**
 * Open models occasionally break their JSON and then repeat it, which leaves
 * raw JSON inside a text field. Treat such text, or text far too long for the
 * field, as missing.
 */
function cleanText(value: unknown, max: number): string {
  const text = str(value);
  if (text.length > max * 3) return "";
  if (/['"]\s*,\s*['"]?[a-z_]+['"]?\s*:|['"](days|tasks|steps)['"]\s*:/i.test(text)) return "";
  return text.slice(0, max);
}

/** Validates a sprint request body. */
export function parseSprintInput(
  body: unknown
): { ok: true; input: SprintInput } | { ok: false; error: string } {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const ideaTitle = clip(record.ideaTitle, 200);
  const ideaSummary = clip(record.ideaSummary);
  if (!ideaSummary) {
    return { ok: false, error: "Run an analysis first so there is a plan to build." };
  }
  const done = Array.isArray(record.doneTasks) ? record.doneTasks : [];
  return {
    ok: true,
    input: {
      ideaTitle,
      ideaSummary,
      decision: clip(record.decision, 1000),
      blueprint: clip(record.blueprint, 3000),
      validateNext: strList(record.validateNext).slice(0, 8).map((s) => s.slice(0, 300)),
      doneLines: done
        .slice(0, 30)
        .map((t) => str(t).slice(0, 200))
        .filter(Boolean),
      profileLines: parseProfile(record.profile),
      language: parseLanguage(record.language),
    },
  };
}

function cleanPlan(raw: unknown): SprintPlan {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawDays = Array.isArray(record.days) ? record.days : [];
  const days: SprintDay[] = rawDays
    .slice(0, 7)
    .map((d, idx) => {
      const day = (typeof d === "object" && d !== null ? d : {}) as Record<string, unknown>;
      const tasks = (Array.isArray(day.tasks) ? day.tasks : [])
        .slice(0, 2)
        .map((t) => {
          const task = (typeof t === "object" && t !== null ? t : {}) as Record<string, unknown>;
          return {
            title: cleanText(task.title, 200),
            why: cleanText(task.why, 400),
            steps: strList(task.steps).slice(0, 5).map((step) => cleanText(step, 400)).filter(Boolean),
            material_title: cleanText(task.material_title, 120),
            material: cleanText(task.material, 1500),
          };
        })
        .filter((t) => t.title);
      return { day: idx + 1, theme: cleanText(day.theme, 120), tasks };
    })
    .filter((d) => d.tasks.length > 0);
  return {
    goal: cleanText(record.goal, 400),
    success_metric: cleanText(record.success_metric, 400),
    days,
  };
}

/** Builds the sprint and reports it through emit as one "sprint" event, or "error". */
export async function runSprint(
  input: SprintInput,
  deps: { llm: Llm; isCancelled: () => boolean },
  emit: Emit
): Promise<void> {
  const { llm } = deps;
  try {
    emit("phase", { phaseIndex: 0, phaseName: "Planning" });
    const prompt = `Build a 7-day launch sprint for this founder and idea.

IDEA: ${input.ideaTitle}
${input.ideaSummary}

FORGE'S DECISION ON THE IDEA:
${input.decision || "Not given."}

BLUEPRINT FROM THE LATEST REPORT:
${input.blueprint || "Not given."}

TESTS THE REPORT SUGGESTED:
${input.validateNext.length > 0 ? input.validateNext.map((v) => `- ${v}`).join("\n") : "None."}

ALREADY DONE (do not repeat these; build on them):
${input.doneLines.length > 0 ? input.doneLines.map((d) => `- ${d}`).join("\n") : "Nothing yet."}

FOUNDER PROFILE:
${profileBlock(input.profileLines)}

RULES:
- Exactly 7 days. Day 1 must contain something the founder can finish within 2 hours of reading this.
- By day 7 the founder should have real evidence from real people: conversations, sign-ups, pre-orders or payments.
- Fit the founder's budget, time and location. If money is tight, every task must be free.
- 1 or 2 tasks per day. Each task gets 3-4 short plain steps and, where useful, one complete material under 70 words, ready to copy.
- Keep every sentence short. Do not repeat the same material on different days.`;

    // Open models sometimes stop after a day or two; ask again and keep the
    // most complete plan.
    let best: SprintPlan | null = null;
    const started = Date.now();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0 && Date.now() - started > RETRY_BUDGET_MS) break;
      const reminder =
        attempt === 0
          ? ""
          : `\n\nIMPORTANT: your previous answer only covered ${best?.days.length ?? 0} day(s). Return all 7 days, numbered 1 to 7.`;
      const raw = await withRetry(() =>
        llm.generateJson({
          system: SPRINT_SYSTEM + languageRule(input.language),
          prompt: prompt + reminder,
          schema: SPRINT_SCHEMA,
          schemaName: "launch_sprint",
          effort: "medium",
        })
      );
      if (deps.isCancelled()) return;
      const plan = cleanPlan(raw);
      if (!best || plan.days.length > best.days.length) best = plan;
      if (best.days.length >= MIN_DAYS) break;
    }
    if (!best || best.days.length === 0) {
      throw new Error("The model returned a plan that could not be read. Click Retry.");
    }
    emit("sprint", { plan: best });
  } catch (err) {
    emit("error", { error: formatApiError(err, llm) });
  }
}
