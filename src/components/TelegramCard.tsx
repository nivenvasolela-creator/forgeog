import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Send } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useI18n } from "../lib/i18n";
import {
  createTelegramLink,
  disconnectTelegram,
  getTelegramStatus,
  setBriefEnabled,
  telegramAvailable,
  type TelegramStatus,
} from "../lib/askForge";

const POLL_MS = 3000;
const POLL_FOR_MS = 5 * 60 * 1000;

/** Connects the founder's Telegram for the morning brief and chat. */
export function TelegramCard({ supabase }: { supabase: SupabaseClient }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    void telegramAvailable().then(setAvailable);
  }, []);

  useEffect(() => {
    getTelegramStatus(supabase)
      .then(setStatus)
      .catch(() => setStatus({ connected: false, briefEnabled: true }));
  }, [supabase]);

  // While waiting for the founder to press Start, watch for the connection.
  useEffect(() => {
    if (!link || status?.connected) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) {
        window.clearInterval(timer);
        return;
      }
      getTelegramStatus(supabase)
        .then((next) => {
          if (next.connected) {
            setStatus(next);
            setLink(null);
          }
        })
        .catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [link, status?.connected, supabase]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    // Open the tab now, while the click still counts, so it is not blocked.
    const tab = window.open("", "_blank");
    try {
      const url = await createTelegramLink(supabase);
      setLink(url);
      if (tab) tab.location.href = url;
    } catch (err) {
      tab?.close();
      setError(t.telegramFailed(err instanceof Error ? err.message : t.unknownError));
    } finally {
      setBusy(false);
    }
  };

  const toggleBrief = async () => {
    if (!status) return;
    const next = !status.briefEnabled;
    setStatus({ ...status, briefEnabled: next });
    try {
      await setBriefEnabled(supabase, next);
    } catch (err) {
      setStatus({ ...status, briefEnabled: !next });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnectTelegram(supabase);
      setStatus({ connected: false, briefEnabled: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Hidden until a bot is set up on the server, so nobody meets a dead button.
  if (!available) return null;

  return (
    <section className="mt-6 rounded-2xl border border-white/80 bg-white/70 shadow-[0_1px_2px_rgba(24,24,27,0.04),0_24px_60px_-36px_rgba(40,48,90,0.35)] backdrop-blur-xl p-5 sm:p-8">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#18181B] text-white">
          <Send className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-medium text-[#18181B]">{t.telegramHeading}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#575752]">{t.telegramLead}</p>
        </div>
      </div>

      <div className="mt-5">
        {status === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-[#9B9B94]" />
        ) : status.connected ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-[#18181B]">
              <CheckCircle2 className="h-4 w-4" />
              {t.telegramConnected}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={status.briefEnabled}
                onClick={() => void toggleBrief()}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-[#DFDED8] bg-white px-3 text-sm text-[#18181B] hover:bg-[#FAFAF8]"
              >
                <span
                  className={`relative h-5 w-9 rounded-full transition-colors ${status.briefEnabled ? "bg-[#F97316]" : "bg-[#D4D4CF]"}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${status.briefEnabled ? "left-[18px]" : "left-0.5"}`}
                  />
                </span>
                {t.telegramBrief}: {status.briefEnabled ? t.telegramBriefOn : t.telegramBriefOff}
              </button>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={busy}
                className="min-h-[40px] cursor-pointer text-sm font-medium text-[#6B6B65] underline underline-offset-4 hover:text-[#B91C1C] disabled:opacity-50"
              >
                {t.telegramDisconnect}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy}
              className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#18181B] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#3F3F46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? t.telegramOpening : t.telegramConnect}
            </button>
            {link && (
              <p className="text-sm leading-relaxed text-[#3F3F46]">
                {t.telegramWaiting}{" "}
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#3F3F46] underline underline-offset-4"
                >
                  {t.telegramOpenAgain}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-[#B91C1C]">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
