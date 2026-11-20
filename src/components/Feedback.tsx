import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Loader2, MessageSquareHeart, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useI18n } from "../lib/i18n";
import { sendFeedback, type FeedbackKind } from "../lib/feedback";
import { track } from "../lib/track";

interface OpenOptions {
  kind?: FeedbackKind;
  rating?: number | null;
  /** Shown above the message box, e.g. "What was wrong with this answer?" */
  prompt?: string;
  context?: Record<string, string | number | boolean>;
}

interface FeedbackApi {
  open: (options?: OpenOptions) => void;
  available: boolean;
  supabase: SupabaseClient | null;
}

const FeedbackContext = createContext<FeedbackApi>({
  open: () => {},
  available: false,
  supabase: null,
});

export function useFeedback(): FeedbackApi {
  return useContext(FeedbackContext);
}

/** Provides the feedback dialog to the whole app, plus the floating button. */
export function FeedbackProvider({
  supabase,
  showButton,
  children,
}: {
  supabase: SupabaseClient | null;
  showButton: boolean;
  children: ReactNode;
}) {
  const [options, setOptions] = useState<OpenOptions | null>(null);
  const available = Boolean(supabase);
  const open = useCallback(
    (opts: OpenOptions = {}) => {
      if (!available) return;
      track("feedback_opened", { kind: opts.kind ?? "", from: opts.context?.target ?? "button" });
      setOptions(opts);
    },
    [available],
  );
  const { t } = useI18n();

  return (
    <FeedbackContext.Provider value={{ open, available, supabase }}>
      {children}
      {available && showButton && !options && (
        <button
          type="button"
          onClick={() => open()}
          className="fixed right-4 bottom-4 z-30 inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-[#18181B] px-4 text-sm font-semibold text-white shadow-lg shadow-black/15 transition-transform hover:-translate-y-0.5 hover:bg-[#3F3F46] sm:right-6 sm:bottom-6"
        >
          <MessageSquareHeart className="h-4 w-4" />
          {t.feedbackButton}
        </button>
      )}
      {supabase && options && (
        <FeedbackDialog supabase={supabase} options={options} onClose={() => setOptions(null)} />
      )}
    </FeedbackContext.Provider>
  );
}

const SCALE = [1, 2, 3, 4];

function FeedbackDialog({
  supabase,
  options,
  onClose,
}: {
  supabase: SupabaseClient;
  options: OpenOptions;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [rating, setRating] = useState<number | null>(options.rating ?? null);
  const [kind, setKind] = useState<FeedbackKind | null>(
    options.kind && options.kind !== "rating" ? options.kind : null,
  );
  const [message, setMessage] = useState("");
  const [contactOk, setContactOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const kinds: Array<[FeedbackKind, string]> = [
    ["bug", t.feedbackKindBug],
    ["confusing", t.feedbackKindConfusing],
    ["idea", t.feedbackKindIdea],
    ["praise", t.feedbackKindPraise],
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError(t.feedbackNeedMessage);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(supabase, {
        kind: kind ?? "other",
        rating,
        message: message.trim(),
        context: options.context,
        contactOk,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.unknownError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="feedback-title" className="font-display text-lg font-medium text-[#18181B]">
            {sent ? t.feedbackThanksTitle : t.feedbackTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="-m-2 inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#6B6B65] hover:bg-[#F4F4F1]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-[#18181B]" />
            <p className="mt-3 text-sm leading-relaxed text-[#3F3F46]">{t.feedbackThanks}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-full bg-[#18181B] px-5 text-sm font-semibold text-white hover:bg-[#3F3F46]"
            >
              {t.close}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="mt-1 text-sm leading-relaxed text-[#575752]">{t.feedbackLead}</p>

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-[#18181B]">{t.feedbackHowIsIt}</legend>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {SCALE.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={rating === value}
                    aria-label={t.feedbackFaces[value - 1]}
                    title={t.feedbackFaces[value - 1]}
                    onClick={() => setRating(rating === value ? null : value)}
                    className={`flex h-12 cursor-pointer items-center justify-center rounded-xl border text-[13px] font-medium transition-colors ${
                      rating === value
                        ? "border-[#18181B] bg-[#18181B] text-white"
                        : "border-[#E5E4DF] bg-white text-[#3F3F46] hover:border-[#18181B]"
                    }`}
                  >
                    {t.feedbackFaces[value - 1]}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-[#18181B]">{t.feedbackAbout}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {kinds.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => setKind(kind === value ? null : value)}
                    className={`min-h-[36px] cursor-pointer rounded-full border px-3 text-sm transition-colors ${
                      kind === value
                        ? "border-[#18181B] bg-[#18181B] text-white"
                        : "border-[#DFDED8] bg-white text-[#3F3F46] hover:border-[#18181B]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label htmlFor="feedback-message" className="mt-5 block text-sm font-medium text-[#18181B]">
              {options.prompt ?? t.feedbackMessageLabel}
            </label>
            <textarea
              id="feedback-message"
              ref={box}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder={t.feedbackPlaceholder}
              className="mt-2 w-full resize-y rounded-xl border border-[#DFDED8] bg-white px-4 py-3 text-base text-[#18181B] placeholder-[#9B9B94] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none"
            />

            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-[#3F3F46]">
              <input
                type="checkbox"
                checked={contactOk}
                onChange={(e) => setContactOk(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-[#F97316]"
              />
              {t.feedbackContactOk}
            </label>

            {error && (
              <p role="alert" className="mt-3 text-sm text-[#B91C1C]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#18181B] px-5 text-sm font-semibold text-white hover:bg-[#3F3F46] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? t.feedbackSending : t.feedbackSend}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Thumbs up / down under an answer or report. Up is recorded quietly; down is
 * recorded and opens the dialog to ask what went wrong.
 */
export function RateThis({
  target,
  label,
  context = {},
}: {
  target: "chat" | "report" | "sprint";
  label?: string;
  context?: Record<string, string | number | boolean>;
}) {
  const { t } = useI18n();
  const { open, available, supabase } = useFeedback();
  const [voted, setVoted] = useState<"up" | "down" | null>(null);
  if (!available || !supabase) return null;

  const vote = (up: boolean) => {
    if (voted) return;
    setVoted(up ? "up" : "down");
    void sendFeedback(supabase, {
      kind: "rating",
      rating: up ? 4 : 1,
      context: { target, ...context },
    }).catch(() => {});
    if (!up) {
      open({ kind: "confusing", rating: 1, prompt: t.feedbackWhatWrong, context: { target, ...context } });
    }
  };

  return (
    <div className="flex items-center gap-1.5 text-xs text-[#6B6B65]">
      {voted ? (
        <span>{t.feedbackRated}</span>
      ) : (
        <>
          {label && <span className="mr-1">{label}</span>}
          <button
            type="button"
            onClick={() => vote(true)}
            aria-label={t.feedbackUseful}
            title={t.feedbackUseful}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-[#F4F3EF] hover:text-[#18181B]"
          >
            <ThumbsUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => vote(false)}
            aria-label={t.feedbackNotUseful}
            title={t.feedbackNotUseful}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-[#FEF2F2] hover:text-[#B91C1C]"
          >
            <ThumbsDown className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
