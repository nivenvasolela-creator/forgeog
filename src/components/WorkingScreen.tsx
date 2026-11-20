import { Check, Loader2 } from "lucide-react";
import { STRESS_TEST_PHASES } from "../lib/analyzeIdea";
import { useI18n } from "../lib/i18n";

interface WorkingScreenProps {
  activePhaseIndex: number;
  ideaPreview: string;
  /** Set when Nexus runs the job: the founder may leave and it keeps going. */
  onBackground?: () => void;
  /** True while the job waits for free model quota to come back. */
  waitingForQuota?: boolean;
}

export function WorkingScreen({
  activePhaseIndex,
  ideaPreview,
  onBackground,
  waitingForQuota = false,
}: WorkingScreenProps) {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
      <header className="mb-8">
        <span className="font-display text-xl font-medium tracking-tight text-[#18181B]">
          FORGE
        </span>
        <h1 className="mt-3 font-display text-2xl font-medium tracking-tight text-[#18181B] sm:text-3xl">
          {t.stressTesting}
        </h1>
        <p className="mt-2 truncate text-sm text-[#6B6B65]">{ideaPreview}</p>
      </header>

      <div className="rounded-2xl border border-white/80 bg-white/70 shadow-[0_1px_2px_rgba(24,24,27,0.04),0_24px_60px_-36px_rgba(40,48,90,0.35)] backdrop-blur-xl p-5 sm:p-8">
        <ol className="divide-y divide-[#F0EFEA]">
          {STRESS_TEST_PHASES.map((phase, index) => {
            const isComplete = index < activePhaseIndex;
            const isActive = index === activePhaseIndex;

            return (
              <li
                key={phase}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
                  {isComplete ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#F97316] text-white">
                      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                    </span>
                  ) : isActive ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#FAF9F6] text-[#F97316]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </span>
                  ) : (
                    <span className="font-mono text-xs font-medium tabular-nums text-[#A1A19A]">
                      0{index + 1}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-base font-medium transition-colors ${
                        isActive
                          ? "text-[#18181B]"
                          : isComplete
                          ? "text-[#18181B]"
                          : "text-[#9B9B94]"
                      }`}
                    >
                      {t.phaseNames[index] ?? phase}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[#787871]">
                      {isComplete ? t.phaseDone : isActive ? t.phaseRunning : t.phaseQueued}
                    </span>
                  </div>
                  {(isActive || isComplete) && (
                    <p className="mt-1 text-sm text-[#6B6B65]">
                      {t.phaseNotes[index]}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {waitingForQuota && (
        <p
          role="status"
          className="mt-5 rounded-xl border border-[#E5E4DF] bg-[#FAF9F6] p-4 text-sm leading-relaxed text-[#3F3F46]"
        >
          {t.nexusQuotaWait}
        </p>
      )}

      {onBackground && (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-relaxed text-[#6B6B65]">{t.nexusNote}</p>
          <button
            type="button"
            onClick={onBackground}
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[#DFDED8] bg-white px-4 text-sm font-medium text-[#18181B] hover:bg-[#FAFAF8]"
          >
            {t.keepInBackground}
          </button>
        </div>
      )}
    </div>
  );
}
