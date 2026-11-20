import { ArrowRight, CircleCheck, CircleX, Shuffle } from "lucide-react";
import type { ForgeDecision } from "../lib/analyzeIdea";
import { useI18n } from "../lib/i18n";

interface DecisionCardProps {
  decision: ForgeDecision | undefined;
  /** Starts a new idea pre-filled with this text. */
  onTestIdea: (text: string) => void;
}

const STYLES = {
  go: {
    border: "border-[#D6D5CF]",
    bg: "bg-[#F4F3EF]",
    accent: "text-[#18181B]",
    Icon: CircleCheck,
  },
  pivot: {
    border: "border-[#E5E4DF]",
    bg: "bg-[#FAF9F6]",
    accent: "text-[#C2410C]",
    Icon: Shuffle,
  },
  kill: {
    border: "border-[#F5C2C0]",
    bg: "bg-[#FEF2F2]",
    accent: "text-[#B91C1C]",
    Icon: CircleX,
  },
} as const;

export function DecisionCard({ decision, onTestIdea }: DecisionCardProps) {
  const { t } = useI18n();

  if (!decision) {
    return (
      <section className="rounded-2xl border border-dashed border-[#DFDED8] bg-white p-6 text-sm leading-relaxed text-[#575752] sm:p-7">
        {t.decisionMissing}
      </section>
    );
  }

  const style = STYLES[decision.call];
  const { Icon } = style;

  return (
    <section
      aria-labelledby="decision-heading"
      className={`rounded-2xl border ${style.border} ${style.bg} p-6 sm:p-8`}
    >
      <p id="decision-heading" className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
        {t.decisionHeading}
      </p>
      <div className="mt-2 flex items-start gap-3">
        <Icon className={`mt-1 h-6 w-6 shrink-0 ${style.accent}`} />
        <div className="min-w-0">
          <h2 className={`font-display text-2xl font-medium tracking-tight ${style.accent}`}>
            {t.decisionCalls[decision.call]}
          </h2>
          {decision.reason && (
            <p className="mt-2 text-base leading-relaxed text-[#27272A]">{decision.reason}</p>
          )}
          <p className="mt-3 text-sm font-medium text-[#18181B]">
            {t.decisionNext[decision.call]}
          </p>
        </div>
      </div>

      {decision.pivots.length > 0 && (
        <div className="mt-6 border-t border-black/10 pt-5">
          <h3 className="text-sm font-semibold text-[#18181B]">{t.pivotsHeading}</h3>
          <ul className="mt-3 space-y-3">
            {decision.pivots.map((pivot, idx) => (
              <li
                key={idx}
                className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-[#27272A]">{pivot}</p>
                <button
                  type="button"
                  onClick={() => onTestIdea(pivot)}
                  className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[#18181B] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3F3F46]"
                >
                  <span>{t.testThisIdea}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
