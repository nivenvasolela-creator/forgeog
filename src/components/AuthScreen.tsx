import { useState } from "react";
import { AlertCircle, ArrowRight } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LanguageToggle, useI18n } from "../lib/i18n";
import { Logo } from "./Logo";

type AuthMode = "sign-in" | "sign-up";

export function AuthScreen({ supabase }: { supabase: SupabaseClient }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "sign-in") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        // No session means the project requires email confirmation first.
        if (!data.session) {
          setNotice(t.confirmEmail);
          setMode("sign-in");
          setPassword("");
        }
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t.signInFailed
      );
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "mt-2 w-full rounded-xl border border-[#DFDED8] bg-white px-4 py-3 text-base text-[#18181B] placeholder-[#9B9B94] transition-colors focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none";

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:px-6 sm:py-20">
      <header className="mb-8">
        <div className="flex items-center justify-between gap-4">
          <h1>
            <Logo />
          </h1>
          <LanguageToggle />
        </div>
        <p className="mt-8 flex items-center gap-3 font-mono text-[10.5px] tracking-[0.22em] text-[#6B6B65] uppercase">
          <span className="h-px w-8 bg-[#A1A19A]" />
          {t.eyebrow}
        </p>
        <h2 className="mt-4 font-display text-[44px] leading-[0.95] tracking-[-0.01em] text-[#0B0B0B] sm:text-[56px]">
          {t.heroLead} <em className="text-[#F97316]">{t.heroAccent}</em> {t.heroTail}
        </h2>
        <p className="mt-5 text-base leading-relaxed text-[#3F3F46]">{t.tagline}</p>
        <p className="mt-2 text-sm leading-relaxed text-[#6B6B65]">
          {mode === "sign-in" ? t.authSignInLead : t.authSignUpLead}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/80 bg-white/70 shadow-[0_1px_2px_rgba(24,24,27,0.04),0_24px_60px_-36px_rgba(40,48,90,0.35)] backdrop-blur-xl p-5 sm:p-8"
      >
        <label htmlFor="auth-email" className="block text-sm font-medium text-[#18181B]">
          {t.email}
        </label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={inputClass}
        />

        <label
          htmlFor="auth-password"
          className="mt-5 block text-sm font-medium text-[#18181B]"
        >
          {t.password}
        </label>
        <input
          id="auth-password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "sign-up" ? t.passwordHint : ""}
          className={inputClass}
        />

        {notice && (
          <p
            role="status"
            className="mt-5 rounded-xl border border-[#E5E4DF] bg-[#FAF9F6] p-4 text-sm text-[#3F3F46]"
          >
            {notice}
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#F5C2C0] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#18181B] px-7 py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[#3F3F46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>
            {busy ? t.working : mode === "sign-in" ? t.signIn : t.createAccount}
          </span>
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>

      <p className="mt-5 px-1 text-sm text-[#575752]">
        {mode === "sign-in" ? t.newHere : t.haveAccount}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setError(null);
            setNotice(null);
          }}
          className="cursor-pointer font-medium text-[#C2410C] underline underline-offset-4 hover:text-[#C2410C]"
        >
          {mode === "sign-in" ? t.createAnAccount : t.signIn}
        </button>
      </p>
    </div>
  );
}
