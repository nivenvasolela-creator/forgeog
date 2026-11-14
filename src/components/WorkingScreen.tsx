import { Check, Loader2 } from "lucide-react";
import { STRESS_TEST_PHASES } from "../lib/analyzeIdea";

interface WorkingScreenProps {
  activePhaseIndex: number;
  ideaPreview: string;
}

const PHASE_NOTES: Record<string, string> = {
  Problem: "Checking problem specificity and pain intensity",
  Customer: "Evaluating target buyer and willingness to pay",
  Market: "Scanning live web sources for market signals",
  Competition: "Verifying existing alternatives and pricing",
  "Business Model": "Testing unit economics and revenue assumptions",
  "Execution Risk": "Compiling failure modes and validation steps",
};

export function WorkingScreen({
  activePhaseIndex,
  ideaPreview,
}: WorkingScreenProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
      <header className="mb-8">
        <span className="font-display text-xl font-bold tracking-tight text-[#18181B]">
          FORGE
        </span>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-[#18181B] sm:text-3xl">
          Stress-testing your idea
        </h1>
        <p className="mt-2 truncate text-sm text-[#6B6B65]">{ideaPreview}</p>
      </header>

      <div className="rounded-2xl border border-[#E5E4DF] bg-white p-5 sm:p-8">
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
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#FFF7ED] text-[#F97316]">
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
                      {phase}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[#787871]">
                      {isComplete ? "Done" : isActive ? "Running" : "Queued"}
                    </span>
                  </div>
                  {(isActive || isComplete) && (
                    <p className="mt-1 text-sm text-[#6B6B65]">
                      {PHASE_NOTES[phase]}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
