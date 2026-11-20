import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarCheck,
  FlaskConical,
  Loader2,
  MessageCircle,
  MessageSquareHeart,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LanguageToggle, useI18n } from "../lib/i18n";
import {
  clearChat,
  loadChat,
  sendChat,
  type ChatAction,
  type ChatMessage,
  type ChatSource,
} from "../lib/askForge";
import { LogoMark } from "./Logo";
import { track } from "../lib/track";
import { RateThis, useFeedback } from "./Feedback";

interface AskForgeScreenProps {
  supabase: SupabaseClient;
  ideas: Array<{ id: string; title: string }>;
  /** The idea the founder came from, if any. */
  initialIdeaId: string | null;
  /** Sent automatically once the history has loaded. */
  initialQuestion?: string | null;
  onQuestionSent?: () => void;
  onBack: () => void;
  onAction: (action: ChatAction) => void;
}

// ---------------------------------------------------------------------------
// A small, safe renderer for FORGE's light markdown: paragraphs, "- " and
// "1. " lists, **bold**, and [1]-style citations linked to the sources.
// ---------------------------------------------------------------------------

function inline(text: string, sources: ChatSource[]): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i} className="font-semibold text-[#18181B]">{bold[1]}</strong>;
    const cite = part.match(/^\[(\d+)\]$/);
    const source = cite ? sources[Number(cite[1]) - 1] : undefined;
    if (cite && source) {
      return (
        <a
          key={i}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          title={source.title}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-[#F4F3EF] px-1 align-[2px] font-mono text-[10px] font-semibold text-[#C2410C] no-underline hover:bg-[#ECEBE6]"
        >
          {cite[1]}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function RichText({ text, sources }: { text: string; sources: ChatSource[] }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "), sources)}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item, i) => <li key={i}>{inline(item, sources)}</li>);
      blocks.push(
        list.ordered ? (
          <ol key={blocks.length} className="list-decimal space-y-1 pl-5">{items}</ol>
        ) : (
          <ul key={blocks.length} className="list-disc space-y-1 pl-5 marker:text-[#F97316]">{items}</ul>
        ),
      );
      list = null;
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (!line) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return <div className="space-y-2.5">{blocks}</div>;
}

function actionView(action: ChatAction, t: ReturnType<typeof useI18n>["t"]) {
  switch (action.type) {
    case "run_analysis":
      return { label: t.actionRunAnalysis, icon: <FlaskConical className="h-4 w-4" /> };
    case "open_idea":
      return { label: t.actionOpenIdea(action.title), icon: <ArrowRight className="h-4 w-4" /> };
    case "build_sprint":
      return { label: t.actionBuildSprint(action.title), icon: <CalendarCheck className="h-4 w-4" /> };
    default:
      return { label: t.actionEditProfile, icon: <UserRound className="h-4 w-4" /> };
  }
}

export function AskForgeScreen({
  supabase,
  ideas,
  initialIdeaId,
  initialQuestion,
  onQuestionSent,
  onBack,
  onAction,
}: AskForgeScreenProps) {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string>(
    initialIdeaId && ideas.some((i) => i.id === initialIdeaId) ? initialIdeaId : "",
  );
  const listEnd = useRef<HTMLDivElement>(null);
  const feedback = useFeedback();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadChat(supabase)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // Grow the box with its text, up to a limit.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const send = async (text: string, retryOf?: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    setSending(true);
    setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 9000);
    const localId = retryOf ?? `local-${Date.now()}`;
    const mine: ChatMessage = {
      id: localId,
      role: "user",
      content: message,
      sources: [],
      actions: [],
      channel: "web",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) =>
      retryOf ? prev.map((m) => (m.id === retryOf ? mine : m)) : [...prev, mine],
    );
    if (!retryOf) setDraft("");
    track("ask_sent", {
      suggested: t.askForgeSuggestions.includes(message),
      focused: Boolean(focusId),
      retry: Boolean(retryOf),
      length: message.length,
    });
    try {
      const answer = await sendChat(supabase, message, focusId || null, lang);
      setMessages((prev) => [
        ...prev,
        {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: answer.reply,
          sources: answer.sources ?? [],
          actions: answer.actions ?? [],
          channel: "web",
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : t.unknownError;
      track("ask_failed", { message: reason });
      setMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, failed: true } : m)));
      setError(t.askForgeFailed(reason));
    } finally {
      window.clearTimeout(slowTimer);
      setSending(false);
      setSlow(false);
      input.current?.focus();
    }
  };

  const handleClear = async () => {
    if (!window.confirm(t.askForgeClearConfirm)) return;
    try {
      await clearChat(supabase);
      setMessages([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // A question handed over from a report card is asked once, after the history loads.
  const askedInitial = useRef(false);
  useEffect(() => {
    if (loading || askedInitial.current || !initialQuestion) return;
    askedInitial.current = true;
    onQuestionSent?.();
    void send(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initialQuestion]);

  const empty = !loading && messages.length === 0;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-white/70 bg-white/60 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            aria-label={t.back}
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#3F3F46] hover:bg-[#F4F4F1]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <LogoMark className="h-6 w-[25px] shrink-0" />
            <h1 className="truncate font-display text-lg font-medium tracking-tight text-[#18181B]">
              {t.askForge}
            </h1>
          </div>
          {feedback.available && (
            <button
              type="button"
              onClick={() => feedback.open({ context: { target: "chat" } })}
              title={t.feedbackButton}
              aria-label={t.feedbackButton}
              className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#6B6B65] hover:bg-[#F4F4F1] hover:text-[#18181B]"
            >
              <MessageSquareHeart className="h-4 w-4" />
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClear()}
              title={t.askForgeClear}
              aria-label={t.askForgeClear}
              className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#6B6B65] hover:bg-[#F4F4F1] hover:text-[#B91C1C]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <LanguageToggle />
        </div>
        {ideas.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">
            <label className="flex min-w-0 items-center gap-2 text-xs text-[#6B6B65]">
              <span className="shrink-0 font-medium">{t.askForgeFocus}:</span>
              <select
                value={focusId}
                onChange={(e) => setFocusId(e.target.value)}
                className="min-h-[34px] min-w-0 flex-1 cursor-pointer truncate rounded-lg border border-[#DFDED8] bg-white px-2 text-sm text-[#18181B] focus:border-[#F97316] focus:outline-none sm:flex-none"
              >
                <option value="">{t.askForgeAllIdeas}</option>
                {ideas.map((idea) => (
                  <option key={idea.id} value={idea.id}>
                    {idea.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        {loading && (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-[#6B6B65]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.loading}
          </p>
        )}

        {empty && (
          <div className="py-6 sm:py-10">
            <h2 className="font-display text-2xl font-medium tracking-tight text-[#18181B]">
              {t.askForge}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#575752]">{t.askForgeLead}</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {t.askForgeSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={sending}
                  className="cursor-pointer rounded-xl border border-[#E5E4DF] bg-white px-4 py-3 text-left text-sm leading-snug text-[#3F3F46] transition-colors hover:border-[#F97316] hover:text-[#18181B] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <ol className="space-y-5" aria-live="polite">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex flex-col items-end">
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed ${
                    m.failed ? "border border-[#F5C2C0] bg-[#FEF2F2] text-[#991B1B]" : "bg-[#18181B] text-white"
                  }`}
                >
                  {m.content}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[#9B9B94]">
                  {m.channel === "telegram" && <span>{t.askForgeViaTelegram}</span>}
                  {m.failed && (
                    <button
                      type="button"
                      onClick={() => void send(m.content, m.id)}
                      disabled={sending}
                      className="inline-flex cursor-pointer items-center gap-1 font-medium text-[#B91C1C] hover:underline disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t.askForgeRetry}
                    </button>
                  )}
                </div>
              </li>
            ) : (
              <li key={m.id} className="flex gap-3">
                <LogoMark className="mt-1 h-5 w-[21px] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="rounded-2xl rounded-tl-md border border-[#E5E4DF] bg-white px-4 py-3 text-[15px] leading-relaxed break-words text-[#3F3F46]">
                    <RichText text={m.content} sources={m.sources} />
                    {m.sources.length > 0 && (
                      <div className="mt-3 border-t border-[#F0EFEA] pt-2.5">
                        <p className="text-[11px] font-semibold tracking-wide text-[#6B6B65] uppercase">
                          {t.askForgeSources}
                        </p>
                        <ol className="mt-1 space-y-0.5 text-xs">
                          {m.sources.map((s, i) => (
                            <li key={s.url} className="flex min-w-0 gap-1.5">
                              <span className="shrink-0 font-mono text-[#C2410C]">{i + 1}.</span>
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate text-[#3F3F46] underline decoration-[#DFDED8] underline-offset-2 hover:text-[#18181B]"
                              >
                                {s.title}
                              </a>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                  {m.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.actions.map((a, i) => {
                        const view = actionView(a, t);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => onAction(a)}
                            className="inline-flex min-h-[38px] max-w-full cursor-pointer items-center gap-2 rounded-lg border border-[#18181B] bg-white px-3 text-sm font-medium text-[#18181B] transition-colors hover:bg-[#18181B] hover:text-white"
                          >
                            {view.icon}
                            <span className="truncate">{view.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    {m.channel === "telegram" ? (
                      <p className="text-[11px] text-[#9B9B94]">{t.askForgeViaTelegram}</p>
                    ) : (
                      <span />
                    )}
                    <RateThis
                      target="chat"
                      label={t.feedbackRateAnswer}
                      context={{ answer: m.content.slice(0, 200), sources: m.sources.length }}
                    />
                  </div>
                </div>
              </li>
            ),
          )}
          {sending && (
            <li className="flex gap-3">
              <LogoMark className="mt-1 h-5 w-[21px] shrink-0" />
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-[#E5E4DF] bg-white px-4 py-3 text-sm text-[#6B6B65]">
                <Loader2 className="h-4 w-4 animate-spin text-[#F97316]" />
                {slow ? t.askForgeThinkingLong : t.askForgeThinking}
              </div>
            </li>
          )}
        </ol>
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-[#F5C2C0] bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">
            {error}
          </p>
        )}
        <div ref={listEnd} className="h-2" />
      </main>

      <div className="sticky bottom-0 border-t border-white/70 bg-white/60 backdrop-blur-xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3 sm:px-6"
        >
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={t.askForgePlaceholder}
            aria-label={t.askForgePlaceholder}
            className="max-h-[180px] min-h-[46px] flex-1 resize-none rounded-xl border border-[#DFDED8] bg-white px-4 py-3 text-[15px] leading-snug text-[#18181B] placeholder-[#9B9B94] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label={t.askForgeSend}
            title={t.askForgeSend}
            className="inline-flex h-[46px] w-[46px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#18181B] text-white transition-colors hover:bg-[#3F3F46] disabled:cursor-not-allowed disabled:bg-[#E5E4DF] disabled:text-[#9B9B94]"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
