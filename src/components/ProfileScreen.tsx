import { useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { LanguageToggle, useI18n } from "../lib/i18n";
import {
  PROFILE_LIMITS,
  type FounderProfile,
} from "../lib/profile";

interface ProfileScreenProps {
  initial: FounderProfile;
  /** True the first time, when the founder has never saved a profile. */
  isOnboarding: boolean;
  onSave: (profile: FounderProfile) => Promise<void>;
  /** Leaves without saving: "skip" while onboarding, "back" otherwise. */
  onLeave: () => void;
  /** Shown below the form, e.g. the Telegram connection. */
  footer?: ReactNode;
}

type TextField = keyof typeof PROFILE_LIMITS;

export function ProfileScreen({ initial, isOnboarding, onSave, onLeave, footer }: ProfileScreenProps) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState<FounderProfile>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: TextField, value: string) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...draft, language: lang });
    } catch (err) {
      setError(t.profileSaveFailed(err instanceof Error ? err.message : t.unknownError));
      setBusy(false);
    }
  };

  const inputClass =
    "mt-2 w-full rounded-xl border border-[#DFDED8] bg-white px-4 py-3 text-base text-[#18181B] placeholder-[#9B9B94] transition-colors focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none";

  const field = (
    name: TextField,
    label: string,
    hint?: string,
    multiline = false
  ) => (
    <div className="mt-5">
      <label htmlFor={`profile-${name}`} className="block text-sm font-medium text-[#18181B]">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={`profile-${name}`}
          value={draft[name]}
          onChange={(e) => set(name, e.target.value)}
          maxLength={PROFILE_LIMITS[name]}
          placeholder={hint}
          rows={3}
          className={`${inputClass} resize-y leading-relaxed`}
        />
      ) : (
        <input
          id={`profile-${name}`}
          value={draft[name]}
          onChange={(e) => set(name, e.target.value)}
          maxLength={PROFILE_LIMITS[name]}
          placeholder={hint}
          className={inputClass}
        />
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-8">
        <div className="flex items-center justify-between gap-4">
          {isOnboarding ? (
            <span className="font-display text-2xl font-bold tracking-tight text-[#18181B]">
              FORGE
            </span>
          ) : (
            <button
              type="button"
              onClick={onLeave}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-[#575752] hover:text-[#18181B]"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t.back}</span>
            </button>
          )}
          <LanguageToggle />
        </div>
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight text-[#18181B] sm:text-3xl">
          {isOnboarding ? t.profileTitleNew : t.profileTitleEdit}
        </h1>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-[#575752]">{t.profileLead}</p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[#E5E4DF] bg-white p-5 sm:p-8"
      >
        {/* Every field carries a top margin; cancel it for the first row. */}
        <div className="-mt-5 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{field("name", t.fieldName)}</div>
          {field("country", t.fieldCountry, "Tanzania")}
          {field("city", t.fieldCity, "Dar es Salaam")}
        </div>
        {field("background", t.fieldBackground, t.fieldBackgroundHint, true)}
        {field("skills", t.fieldSkills, t.fieldSkillsHint)}
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {field("hours_per_week", t.fieldHours, t.fieldHoursHint)}
          {field("budget", t.fieldBudget, t.fieldBudgetHint)}
        </div>
        {field("goal", t.fieldGoal, t.fieldGoalHint, true)}

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#F5C2C0] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {isOnboarding ? (
            <button
              type="button"
              onClick={onLeave}
              className="min-h-[44px] cursor-pointer text-sm font-medium text-[#6B6B65] underline underline-offset-4 hover:text-[#18181B]"
            >
              {t.skipForNow}
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#F97316] px-7 py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            <span>{busy ? t.saving : t.saveProfile}</span>
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </form>
      {footer}
    </div>
  );
}
