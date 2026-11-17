import { AlertCircle, ArrowRight, RotateCcw } from "lucide-react";
import type { Idea } from "../lib/analyzeIdea";
import { getVerdictLabel } from "../lib/storage";

interface InputScreenProps {
  rawIdea: string;
  onChangeIdea: (value: string) => void;
  clarifyingQuestion: string | null;
  clarificationAnswer: string;
  onChangeClarification: (value: string) => void;
  errorMessage: string | null;
  onSubmit: () => void;
  onRetry: () => void;
  onResetClarification: () => void;
  /** Title of the idea being revised, or null when starting a new idea. */
  revisingTitle: string | null;
  /** Finished experiments that will be sent along with this re-run. */
  revisingEvidenceCount: number;
  onCancelRevise: () => void;
  ideas: Idea[];
  ideasLoading: boolean;
  onSelectIdea: (idea: Idea) => void;
  /** Null when sign-in is not enabled (browser-only mode). */
  userEmail: string | null;
  onSignOut: (() => void) | null;
}

export function InputScreen({
  rawIdea,
  onChangeIdea,
  clarifyingQuestion,
  clarificationAnswer,
  onChangeClarification,
  errorMessage,
  onSubmit,
  onRetry,
  onResetClarification,
  revisingTitle,
  revisingEvidenceCount,
  onCancelRevise,
  ideas,
  ideasLoading,
  onSelectIdea,
  userEmail,
  onSignOut,
}: InputScreenProps) {
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-8 sm:mb-10">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#18181B] sm:text-3xl">
            FORGE
          </h1>
          {onSignOut && (
            <div className="flex min-w-0 items-baseline gap-3 text-xs text-[#6B6B65]">
              {userEmail && <span className="truncate">{userEmail}</span>}
              <button
                type="button"
                onClick={onSignOut}
                className="shrink-0 cursor-pointer font-medium underline underline-offset-4 hover:text-[#18181B]"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-[#575752]">
          Paste your startup idea and get one honest, grounded reality-check report.
        </p>
      </header>

      <main>
        <form
          onSubmit={handleFormSubmit}
          className="rounded-2xl border border-[#E5E4DF] bg-white p-5 sm:p-8"
        >
          {revisingTitle && (
            <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-[#FDBA74] bg-[#FFFBEB] px-4 py-3">
              <p className="min-w-0 text-sm leading-relaxed text-[#3F3F46]">
                Revising <span className="font-medium text-[#18181B]">{revisingTitle}</span>.
                The new report is saved as the next version of this idea
                {revisingEvidenceCount > 0
                  ? ` and will weigh ${revisingEvidenceCount} finished ${
                      revisingEvidenceCount === 1 ? "experiment" : "experiments"
                    }.`
                  : "."}
              </p>
              <button
                type="button"
                onClick={onCancelRevise}
                className="shrink-0 cursor-pointer text-xs font-medium text-[#6B6B65] underline underline-offset-4 hover:text-[#18181B]"
              >
                Cancel
              </button>
            </div>
          )}

          <label
            htmlFor="idea-input"
            className="block text-sm font-medium text-[#18181B]"
          >
            {revisingTitle ? "Updated idea" : "Your startup idea"}
          </label>

          <textarea
            id="idea-input"
            value={rawIdea}
            onChange={(e) => onChangeIdea(e.target.value)}
            placeholder="Drop your idea, messy is fine"
            rows={7}
            readOnly={Boolean(clarifyingQuestion)}
            className={`mt-3 w-full resize-y rounded-xl border px-4 py-3.5 text-base leading-relaxed text-[#18181B] placeholder-[#9B9B94] transition-colors focus:outline-none ${
              clarifyingQuestion
                ? "border-[#E5E4DF] bg-[#F7F7F5] text-[#575752]"
                : "border-[#DFDED8] bg-white focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15"
            }`}
          />

          {clarifyingQuestion && (
            <div className="mt-6 border-t border-[#ECEBE6] pt-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium tracking-wide text-[#C2410C] uppercase">
                    One quick question before analysis
                  </p>
                  <p className="mt-1.5 text-base font-medium leading-snug text-[#18181B]">
                    {clarifyingQuestion}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onResetClarification}
                  className="shrink-0 text-xs font-medium text-[#6B6B65] underline underline-offset-4 hover:text-[#18181B]"
                >
                  Edit idea
                </button>
              </div>

              <textarea
                id="clarification-input"
                value={clarificationAnswer}
                onChange={(e) => onChangeClarification(e.target.value)}
                placeholder="Answer in one or two direct sentences"
                rows={3}
                autoFocus
                className="mt-3 w-full resize-y rounded-xl border border-[#DFDED8] bg-white px-4 py-3 text-base leading-relaxed text-[#18181B] placeholder-[#9B9B94] transition-colors focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none"
              />
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="mt-5 flex flex-col gap-3 rounded-xl border border-[#F5C2C0] bg-[#FEF2F2] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2.5 text-sm text-[#991B1B]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              {rawIdea.trim().length > 0 && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#FCA5A5] bg-white px-3.5 py-2 text-xs font-semibold text-[#991B1B] transition-colors hover:bg-[#FEE2E2]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-[#6B6B65]">
              No flattery. Anything that could not be verified is flagged.
            </p>
            <button
              type="submit"
              className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#F97316] px-7 py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[#EA580C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316] sm:w-auto"
            >
              <span>
                {clarifyingQuestion ? "CONTINUE" : revisingTitle ? "RE-RUN" : "IGNITE"}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>

        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 className="text-sm font-medium text-[#575752]">Your ideas</h2>
            {!onSignOut && (
              <span className="text-xs text-[#787871]">
                Saved in this browser only
              </span>
            )}
          </div>

          {ideasLoading ? (
            <p className="px-1 text-sm text-[#787871]">Loading your ideas...</p>
          ) : ideas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#DFDED8] px-5 py-6 text-sm leading-relaxed text-[#6B6B65]">
              Nothing here yet. Each idea you test gets its own workspace, so you
              can revise it and see whether the score moves.
            </p>
          ) : (
            <div className="divide-y divide-[#ECEBE6] rounded-2xl border border-[#E5E4DF] bg-white">
              {ideas.map((idea) => {
                const latest = idea.versions[0];
                const previous = idea.versions[1];
                const score = latest.data.idea_score.overall;
                const delta = previous
                  ? score - previous.data.idea_score.overall
                  : null;
                const dateLabel = new Date(idea.updatedAt).toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric" }
                );
                return (
                  <button
                    key={idea.id}
                    type="button"
                    onClick={() => onSelectIdea(idea)}
                    className="flex min-h-[56px] w-full cursor-pointer items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-[#FAFAF8]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#18181B]">
                        {idea.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#6B6B65]">
                        <span>{getVerdictLabel(score)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {idea.versions.length === 1
                            ? "1 report"
                            : `${idea.versions.length} reports`}
                        </span>
                        {idea.experiments.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {idea.experiments.filter((e) => e.status === "done").length}/
                              {idea.experiments.length} experiments done
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{dateLabel}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm font-semibold tabular-nums text-[#18181B]">
                        {score}/100
                      </div>
                      {delta !== null && delta !== 0 && (
                        <div
                          className={`font-mono text-xs tabular-nums ${
                            delta > 0 ? "text-[#15803D]" : "text-[#B91C1C]"
                          }`}
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
