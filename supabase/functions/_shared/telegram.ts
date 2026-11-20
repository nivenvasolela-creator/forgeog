// FORGE on Telegram: founders link their account from the app, then get a
// morning brief and can Ask FORGE by simply messaging the bot.
// Needs one secret on the server: TELEGRAM_BOT_TOKEN (from @BotFather).
import type { Llm } from "./llm.ts";
import type { WebSearch } from "./search.ts";
import type { Db } from "./nexus.ts";
import { askForge, chatRateLimited, sprintToday, type ChatAnswer } from "./forge_chat.ts";
import { str } from "./analysis.ts";

const API = "https://api.telegram.org";
const LINK_CODE_MINUTES = 30;
const MAX_TELEGRAM_TEXT = 4000;

interface TelegramLinkRow {
  user_id: string;
  chat_id: number | null;
}

async function tg(token: string, method: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    description?: string;
    error_code?: number;
  };
  if (!json.ok) {
    const err = new Error(`Telegram ${method} failed: ${json.description ?? res.status}`) as Error & {
      code?: number;
    };
    err.code = json.error_code ?? res.status;
    throw err;
  }
  return json.result;
}

/** Secret Telegram sends back with every webhook call, derived from the token. */
export async function webhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`forge-telegram-webhook:${token}`),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

let botUsername: string | null = null;
let webhookUrlSet: string | null = null;

/** Points Telegram at our webhook (once per worker) and returns the bot's username. */
export async function prepareBot(token: string, webhookUrl: string): Promise<string> {
  if (webhookUrlSet !== webhookUrl) {
    await tg(token, "setWebhook", {
      url: webhookUrl,
      secret_token: await webhookSecret(token),
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    webhookUrlSet = webhookUrl;
  }
  if (!botUsername) {
    const me = (await tg(token, "getMe", {})) as { username?: string };
    botUsername = me.username ?? "";
  }
  return botUsername;
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates a one-time link code for a founder; returns the t.me link. */
export async function createTelegramLink(
  db: Db,
  token: string,
  webhookUrl: string,
  userId: string,
): Promise<{ url: string; botUsername: string }> {
  const username = await prepareBot(token, webhookUrl);
  const code = randomCode();
  await db.insert(
    "telegram_links",
    {
      user_id: userId,
      link_code: code,
      code_expires_at: new Date(Date.now() + LINK_CODE_MINUTES * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    "user_id",
  );
  return { url: `https://t.me/${username}?start=${code}`, botUsername: username };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Turns FORGE's light markdown into Telegram HTML. */
export function toTelegramHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-*] /gm, "• ")
    .slice(0, MAX_TELEGRAM_TEXT);
}

async function send(token: string, chatId: number, html: string): Promise<void> {
  await tg(token, "sendMessage", {
    chat_id: chatId,
    text: html.slice(0, MAX_TELEGRAM_TEXT),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

type Lang = "en" | "sw";

const TEXT = {
  en: {
    linked: "✅ <b>Your FORGE account is connected.</b>\n\nEvery morning at 7:00 I'll send you a short brief: today's sprint tasks and the tests still open.\n\nYou can also message me any question about your ideas, like you would in Ask FORGE.\n\n/brief: get today's brief now\n/stop: pause the morning brief\n/resume: turn it back on",
    linkExpired: "That link has expired or was already used. Open FORGE, go to your Profile and press <b>Connect Telegram</b> again.",
    notLinked: (app: string) =>
      `Hi! I'm FORGE. To connect me to your account, open FORGE (${app}), go to your <b>Profile</b> and press <b>Connect Telegram</b>.`,
    stopped: "Morning brief paused. Send /resume to turn it back on.",
    resumed: "Morning brief is on. See you at 7:00.",
    tooMany: "You've asked a lot in a short time. Give me a few minutes and ask again.",
    failed: "Sorry, I couldn't answer that right now. Please try again in a few minutes.",
    quota: "FORGE's free AI allowance is used up for now. Try again in a while.",
    openApp: "Open in FORGE",
    sources: "Sources",
    actionAnalyze: "Test this idea in FORGE",
    actionOpen: (t: string) => `Open “${t}” in FORGE`,
    actionSprint: (t: string) => `Build a 7-day sprint for “${t}” in FORGE`,
    actionProfile: "Update your profile in FORGE",
  },
  sw: {
    linked: "✅ <b>Akaunti yako ya FORGE imeunganishwa.</b>\n\nKila asubuhi saa 1:00 nitakutumia muhtasari mfupi: kazi za leo za sprint na majaribio yaliyobaki.\n\nUnaweza pia kuniuliza swali lolote kuhusu mawazo yako, kama kwenye Uliza FORGE.\n\n/brief: pata muhtasari wa leo sasa\n/stop: simamisha muhtasari wa asubuhi\n/resume: uwashe tena",
    linkExpired: "Kiungo hicho kimeisha muda au kimeshatumika. Fungua FORGE, nenda kwenye Wasifu na ubonyeze <b>Unganisha Telegram</b> tena.",
    notLinked: (app: string) =>
      `Habari! Mimi ni FORGE. Kuniunganisha na akaunti yako, fungua FORGE (${app}), nenda kwenye <b>Wasifu</b> na ubonyeze <b>Unganisha Telegram</b>.`,
    stopped: "Muhtasari wa asubuhi umesimamishwa. Tuma /resume kuuwasha tena.",
    resumed: "Muhtasari wa asubuhi umewashwa. Tuonane saa 1:00 asubuhi.",
    tooMany: "Umeuliza mengi kwa muda mfupi. Nipe dakika chache kisha uulize tena.",
    failed: "Samahani, sikuweza kujibu sasa hivi. Jaribu tena baada ya dakika chache.",
    quota: "Kiasi cha bure cha AI cha FORGE kimeisha kwa sasa. Jaribu tena baadaye.",
    openApp: "Fungua kwenye FORGE",
    sources: "Vyanzo",
    actionAnalyze: "Jaribu wazo hili kwenye FORGE",
    actionOpen: (t: string) => `Fungua “${t}” kwenye FORGE`,
    actionSprint: (t: string) => `Tengeneza sprint ya siku 7 ya “${t}” kwenye FORGE`,
    actionProfile: "Sasisha wasifu wako kwenye FORGE",
  },
};

async function languageFor(db: Db, userId: string): Promise<Lang> {
  const rows = await db
    .select<{ language: string }>("profiles", `user_id=eq.${userId}&select=language`)
    .catch(() => []);
  return rows[0]?.language === "sw" ? "sw" : "en";
}

function answerToHtml(answer: ChatAnswer, lang: Lang, appUrl: string): string {
  const t = TEXT[lang];
  let html = toTelegramHtml(answer.reply);
  if (answer.sources.length > 0) {
    html += `\n\n<b>${t.sources}</b>\n${answer.sources
      .map((s, i) => `[${i + 1}] <a href="${escapeHtml(s.url)}">${escapeHtml(s.title.slice(0, 80))}</a>`)
      .join("\n")}`;
  }
  const labels = answer.actions.map((a) =>
    a.type === "run_analysis"
      ? t.actionAnalyze
      : a.type === "open_idea"
        ? t.actionOpen(a.title)
        : a.type === "build_sprint"
          ? t.actionSprint(a.title)
          : t.actionProfile,
  );
  if (labels.length > 0) {
    html += `\n\n${labels.map((l) => `👉 <a href="${escapeHtml(appUrl)}">${escapeHtml(l)}</a>`).join("\n")}`;
  }
  return html;
}

// ---------------------------------------------------------------------------
// The morning brief
// ---------------------------------------------------------------------------

/** Writes one founder's brief (HTML), from their most recently active idea. */
export async function buildBrief(db: Db, userId: string, lang: Lang, appUrl: string): Promise<string> {
  const sw = lang === "sw";
  const [profiles, ideas] = await Promise.all([
    db.select<{ name: string }>("profiles", `user_id=eq.${userId}&select=name`),
    db.select<{ id: string; title: string }>(
      "ideas",
      `user_id=eq.${userId}&select=id,title&order=updated_at.desc&limit=5`,
    ),
  ]);
  const name = str(profiles[0]?.name);
  const lines: string[] = [
    `☀️ <b>${sw ? "Habari ya asubuhi" : "Good morning"}${name ? `, ${escapeHtml(name)}` : ""}!</b>`,
  ];

  if (ideas.length === 0) {
    lines.push(
      sw
        ? "Bado hujajaribu wazo lolote. Leo, andika wazo lako moja kwenye FORGE na upate uamuzi wazi ndani ya dakika chache."
        : "You haven't tested an idea yet. Today, write one idea into FORGE and get a clear decision in a few minutes.",
    );
  } else {
    const ids = ideas.map((i) => i.id).join(",");
    const [sprints, experiments, reports] = await Promise.all([
      db.select<{ idea_id: string; data: unknown; updated_at: string }>(
        "sprints",
        `user_id=eq.${userId}&idea_id=in.(${ids})&select=idea_id,data,updated_at&order=updated_at.desc`,
      ),
      db.select<{ idea_id: string; title: string; status: string }>(
        "experiments",
        `user_id=eq.${userId}&idea_id=in.(${ids})&status=neq.done&select=idea_id,title,status&order=created_at.asc&limit=20`,
      ),
      db.select<{ idea_id: string; data: Record<string, any> }>(
        "reports",
        `user_id=eq.${userId}&idea_id=eq.${ideas[0].id}&select=idea_id,data&order=created_at.desc&limit=1`,
      ),
    ]);
    // Focus on the idea with the most recently touched sprint, else the newest idea.
    const focusId = sprints[0]?.idea_id ?? ideas[0].id;
    const focus = ideas.find((i) => i.id === focusId) ?? ideas[0];
    lines.push(`${sw ? "Wazo" : "Idea"}: <b>${escapeHtml(focus.title)}</b>`);

    const sprint = sprints.find((s) => s.idea_id === focus.id);
    const today = sprint ? sprintToday(sprint.data) : null;
    if (today && today.tasks.length > 0) {
      lines.push(
        "",
        `🗓 <b>${sw ? `Sprint, siku ya ${today.day}` : `Sprint day ${today.day}`}${today.theme ? `: ${escapeHtml(today.theme)}` : ""}</b>`,
        ...today.tasks.map(
          (task) =>
            `• ${escapeHtml(task.title)}${task.material ? `\n   <i>${sw ? "Tayari kwako" : "Ready for you"}: ${escapeHtml(task.material)}</i>` : ""}`,
        ),
        sw
          ? `Maendeleo: kazi ${today.done} kati ya ${today.total} zimekamilika.`
          : `Progress: ${today.done} of ${today.total} tasks done.`,
      );
    } else if (today) {
      lines.push(
        "",
        sw
          ? "🎉 Umemaliza kazi zote za sprint yako! Andika matokeo kwenye majaribio yako na uendeshe uchambuzi upya."
          : "🎉 You finished every task in your sprint! Record the results in your experiments and re-run the analysis.",
      );
    } else {
      const call = str(reports[0]?.data?.decision?.call);
      lines.push(
        "",
        sw
          ? `Uamuzi wa FORGE: <b>${call.toUpperCase() || "—"}</b>. Hatua inayofuata: tengeneza sprint yako ya siku 7 kwenye FORGE ili ujue cha kufanya kila siku.`
          : `FORGE's call: <b>${call.toUpperCase() || "—"}</b>. Next step: build your 7-day sprint in FORGE so you know exactly what to do each day.`,
      );
    }

    const open = experiments.filter((e) => e.idea_id === focus.id).slice(0, 3);
    if (open.length > 0) {
      lines.push(
        "",
        `🧪 <b>${sw ? "Majaribio yaliyo wazi" : "Tests still open"}</b>`,
        ...open.map((e) => `• ${escapeHtml(e.title)}`),
      );
    }
  }

  lines.push(
    "",
    sw
      ? `💬 Una swali au wasiwasi? Nijibu hapa tu. · <a href="${escapeHtml(appUrl)}">Fungua FORGE</a>`
      : `💬 Questions or worries? Just reply here. · <a href="${escapeHtml(appUrl)}">Open FORGE</a>`,
  );
  return lines.join("\n");
}

function todayInTanzania(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Sends today's brief to every linked founder who has not had one yet. */
export async function sendBriefs(db: Db, token: string, appUrl: string): Promise<number> {
  const today = todayInTanzania();
  // Claiming by date first means a second call the same day sends nothing.
  const claimed = (await db.update(
    "telegram_links",
    `chat_id=not.is.null&brief_enabled=is.true&or=(last_brief_on.is.null,last_brief_on.lt.${today})`,
    { last_brief_on: today },
  )) as TelegramLinkRow[];
  let sent = 0;
  for (const link of claimed ?? []) {
    if (!link.chat_id) continue;
    try {
      const lang = await languageFor(db, link.user_id);
      await send(token, link.chat_id, await buildBrief(db, link.user_id, lang, appUrl));
      sent++;
    } catch (err) {
      // 403: the founder blocked the bot, so stop sending.
      if ((err as { code?: number }).code === 403) {
        await db
          .update("telegram_links", `user_id=eq.${link.user_id}`, { chat_id: null })
          .catch(() => {});
      }
      console.error("brief failed:", err);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Incoming messages
// ---------------------------------------------------------------------------

export interface TelegramDeps {
  db: Db;
  token: string;
  appUrl: string;
  llm: Llm;
  search: WebSearch | null;
}

/** Handles one Telegram update. Never throws. */
export async function handleTelegramUpdate(update: unknown, deps: TelegramDeps): Promise<void> {
  const { db, token, appUrl } = deps;
  const msg = (update as { message?: Record<string, any> })?.message;
  const chatId = Number(msg?.chat?.id);
  const text = str(msg?.text);
  // Private chats only; ignore stickers, photos, groups.
  if (!msg || !Number.isSafeInteger(chatId) || msg.chat?.type !== "private" || !text) return;
  const guessLang: Lang = String(msg.from?.language_code ?? "").startsWith("sw") ? "sw" : "en";

  try {
    const start = text.match(/^\/start(?:@\w+)?(?:\s+([0-9a-f]{24}))?\s*$/i);
    if (start) {
      const code = start[1];
      if (!code) {
        const linked = await db.select<TelegramLinkRow>("telegram_links", `chat_id=eq.${chatId}&select=user_id,chat_id`);
        const lang = linked[0] ? await languageFor(db, linked[0].user_id) : guessLang;
        await send(token, chatId, linked[0] ? TEXT[lang].linked : TEXT[guessLang].notLinked(escapeHtml(appUrl)));
        return;
      }
      const rows = await db.select<TelegramLinkRow>(
        "telegram_links",
        `link_code=eq.${code}&code_expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id,chat_id`,
      );
      const row = rows[0];
      if (!row) {
        await send(token, chatId, TEXT[guessLang].linkExpired);
        return;
      }
      // One Telegram chat belongs to one FORGE account.
      await db.update("telegram_links", `chat_id=eq.${chatId}&user_id=neq.${row.user_id}`, { chat_id: null });
      await db.update("telegram_links", `user_id=eq.${row.user_id}`, {
        chat_id: chatId,
        link_code: null,
        code_expires_at: null,
        brief_enabled: true,
        updated_at: new Date().toISOString(),
      });
      await send(token, chatId, TEXT[await languageFor(db, row.user_id)].linked);
      return;
    }

    const links = await db.select<TelegramLinkRow & { brief_enabled: boolean }>(
      "telegram_links",
      `chat_id=eq.${chatId}&select=user_id,chat_id,brief_enabled`,
    );
    const link = links[0];
    if (!link) {
      await send(token, chatId, TEXT[guessLang].notLinked(escapeHtml(appUrl)));
      return;
    }
    const lang = await languageFor(db, link.user_id);
    const t = TEXT[lang];
    const command = text.match(/^\/(\w+)/)?.[1]?.toLowerCase();

    if (command === "brief") {
      await send(token, chatId, await buildBrief(db, link.user_id, lang, appUrl));
      return;
    }
    if (command === "stop" || command === "resume") {
      await db.update("telegram_links", `user_id=eq.${link.user_id}`, { brief_enabled: command === "resume" });
      await send(token, chatId, command === "stop" ? t.stopped : t.resumed);
      return;
    }
    if (command === "help") {
      await send(token, chatId, t.linked);
      return;
    }

    // Anything else is a question for Ask FORGE.
    if (await chatRateLimited(db, link.user_id)) {
      await send(token, chatId, t.tooMany);
      return;
    }
    await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    try {
      const answer = await askForge({
        db,
        llm: deps.llm,
        search: deps.search,
        userId: link.user_id,
        message: text,
        ideaId: null,
        channel: "telegram",
      });
      await send(token, chatId, answerToHtml(answer, lang, appUrl));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await send(token, chatId, /quota|429|rate limit|RESOURCE_EXHAUSTED/i.test(message) ? t.quota : t.failed);
      console.error("telegram ask failed:", err);
    }
  } catch (err) {
    console.error("telegram update failed:", err);
  }
}
