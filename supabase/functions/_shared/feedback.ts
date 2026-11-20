// Founder feedback: saved for the admin inbox, then sent to the team by email
// (Resend) and/or WhatsApp (CallMeBot) when those are configured.
//   FEEDBACK_EMAIL + RESEND_API_KEY        -> email
//   NTFY_TOPIC                             -> phone push (ntfy app, free, no account)
//   CALLMEBOT_PHONE + CALLMEBOT_APIKEY     -> WhatsApp
import type { Db } from "./nexus.ts";

const KINDS = new Set(["bug", "idea", "confusing", "praise", "rating", "other"]);
const MAX_PER_HOUR = 20;

export interface FeedbackInput {
  kind: string;
  rating: number | null;
  message: string;
  screen: string | null;
  context: Record<string, unknown>;
  contactOk: boolean;
}

/** Cleans a feedback request body. Returns the input or an error message. */
export function parseFeedback(body: Record<string, unknown>): FeedbackInput | string {
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!KINDS.has(kind)) return "Pick what kind of feedback this is.";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  const rating = Number(body.rating);
  if (kind !== "rating" && !message) return "Write a few words first.";
  const context =
    typeof body.context === "object" && body.context !== null && !Array.isArray(body.context)
      ? (body.context as Record<string, unknown>)
      : {};
  // Keep the context small: short strings and numbers only.
  const cleanContext: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context).slice(0, 12)) {
    if (typeof v === "string") cleanContext[k.slice(0, 40)] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean") cleanContext[k.slice(0, 40)] = v;
  }
  return {
    kind,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 4 ? rating : null,
    message,
    screen: typeof body.screen === "string" ? body.screen.slice(0, 40) : null,
    context: cleanContext,
    contactOk: body.contactOk === true,
  };
}

export async function feedbackRateLimited(db: Db, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await db.select<{ id: string }>(
    "feedback",
    `user_id=eq.${encodeURIComponent(userId)}&created_at=gt.${encodeURIComponent(since)}&select=id&limit=${MAX_PER_HOUR}`,
  );
  return rows.length >= MAX_PER_HOUR;
}

export async function saveFeedback(db: Db, userId: string, input: FeedbackInput): Promise<void> {
  await db.insert("feedback", {
    user_id: userId,
    kind: input.kind,
    rating: input.rating,
    message: input.message,
    screen: input.screen,
    context: input.context,
    contact_ok: input.contactOk,
  });
}

const LABELS: Record<string, string> = {
  bug: "🐞 Bug",
  idea: "💡 Idea",
  confusing: "🤔 Confusing",
  praise: "❤️ Praise",
  rating: "👍👎 Rating",
  other: "💬 Other",
};
const FACES = ["", "😞", "😐", "🙂", "😍"];

function summary(input: FeedbackInput, email: string | null): string {
  const lines = [
    `FORGE feedback: ${LABELS[input.kind] ?? input.kind}${input.rating ? ` ${FACES[input.rating]}` : ""}`,
    "",
    input.message || "(no message)",
    "",
    `Screen: ${input.screen ?? "?"}`,
  ];
  for (const [k, v] of Object.entries(input.context)) lines.push(`${k}: ${v}`);
  lines.push(input.contactOk && email ? `Reply to: ${email}` : "The founder did not ask to be contacted.");
  return lines.join("\n");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Sends the team a copy of the feedback. Never throws. */
export async function notifyTeam(
  env: Record<string, string | undefined>,
  input: FeedbackInput,
  email: string | null,
): Promise<void> {
  // Plain thumbs are counted on the dashboard; only words are worth a ping.
  if (input.kind === "rating" && !input.message) return;
  const text = summary(input, email);
  const jobs: Promise<unknown>[] = [];

  const resendKey = env.RESEND_API_KEY?.trim();
  const to = env.FEEDBACK_EMAIL?.trim();
  if (resendKey && to) {
    jobs.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: env.FEEDBACK_FROM?.trim() || "FORGE Feedback <onboarding@resend.dev>",
          to: [to],
          subject: `FORGE ${LABELS[input.kind] ?? "feedback"}: ${(input.message || "rating").slice(0, 60)}`,
          text,
          html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
          ...(input.contactOk && email ? { reply_to: email } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      }).then(async (r) => {
        if (!r.ok) console.error("feedback email failed:", r.status, (await r.text()).slice(0, 200));
      }),
    );
  }

  // ntfy: the team subscribes to a secret topic in the free ntfy app.
  const topic = env.NTFY_TOPIC?.trim();
  if (topic && /^[A-Za-z0-9_-]{6,64}$/.test(topic)) {
    const server = (env.NTFY_SERVER?.trim() || "https://ntfy.sh").replace(/\/+$/, "");
    jobs.push(
      fetch(`${server}/${topic}`, {
        method: "POST",
        headers: {
          Title: `FORGE feedback: ${(LABELS[input.kind] ?? input.kind).replace(/[^\x20-\x7E]/g, "").trim()}`,
          Tags: input.kind === "bug" ? "bug" : input.kind === "praise" ? "heart" : "speech_balloon",
          Priority: input.kind === "bug" ? "high" : "default",
        },
        body: text.slice(0, 3500),
        signal: AbortSignal.timeout(10_000),
      }).then((r) => {
        if (!r.ok) console.error("feedback push failed:", r.status);
      }),
    );
  }

  const phone = env.CALLMEBOT_PHONE?.trim();
  const apiKey = env.CALLMEBOT_APIKEY?.trim();
  if (phone && apiKey) {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(
      text.slice(0, 1500),
    )}&apikey=${encodeURIComponent(apiKey)}`;
    jobs.push(
      fetch(url, { signal: AbortSignal.timeout(10_000) }).then((r) => {
        if (!r.ok) console.error("feedback whatsapp failed:", r.status);
      }),
    );
  }

  await Promise.allSettled(jobs);
}

export function notificationChannels(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  if (env.RESEND_API_KEY?.trim() && env.FEEDBACK_EMAIL?.trim()) out.push("email");
  if (env.NTFY_TOPIC?.trim()) out.push("push");
  if (env.CALLMEBOT_PHONE?.trim() && env.CALLMEBOT_APIKEY?.trim()) out.push("whatsapp");
  return out;
}
