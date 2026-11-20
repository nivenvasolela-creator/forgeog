import { AlertCircle, ArrowRight, Loader2, MessageCircle, MessageCircleQuestion, RotateCcw, UserRound } from "lucide-react";
import { sprintTotals, type Idea } from "../lib/analyzeIdea";
import { LanguageToggle, useI18n } from "../lib/i18n";
import type { NexusJob } from "../lib/nexus";

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
  onOpenProfile: () => void;
  /** Opens Ask FORGE; missing when it is not available. */
  onOpenAsk?: () => void;
  /** Shown until the founder has told FORGE something about themselves. */
  showProfileNudge: boolean;
  /** Nexus jobs still working or waiting for an answer. */
  activeJobs: NexusJob[];
  onAnswerJob: (job: NexusJob) => void;
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
  onOpenProfile,
  onOpenAsk,
  showProfileNudge,
  activeJobs,
  onAnswerJob,
}: InputScreenProps) {
  const { t } = useI18n();
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-8 sm:mb-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#18181B] sm:text-3xl">
            FORGE
          </h1>
          <div className="flex min-w-0 items-center gap-2 text-xs text-[#6B6B65] sm:gap-3">
            {onOpenAsk && (
              <button
                type="button"
                onClick={onOpenAsk}
                className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[#18181B] px-2.5 font-semibold text-white hover:bg-[#3F3F46]"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {t.askForge}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenProfile}
              className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#DFDED8] bg-white px-2.5 font-medium text-[#18181B] hover:bg-[#FAFAF8]"
            >
              <UserRound className="h-3.5 w-3.5" />
              {t.profile}
            </button>
            <LanguageToggle />
          </div>
        </div>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-[#575752]">{t.tagline}</p>
        {onSignOut && (
          <p className="mt-2 flex min-w-0 items-baseline gap-3 text-xs text-[#6B6B65]">
            {userEmail && <span className="truncate">{userEmail}</span>}
            <button
              type="button"
              onClick={onSignOut}
              className="shrink-0 cursor-pointer font-medium underline underline-offset-4 hover:text-[#18181B]"
            >
              {t.signOut}
            </button>
          </p>
        )}
        {showProfileNudge && (
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[#E5E4DF] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-[#3F3F46]">{t.profileNudge}</p>
            <button
              type="button"
              onClick={onOpenProfile}
              className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#18181B] px-4 text-sm font-semibold text-white hover:bg-[#3F3F46]"
            >
              {t.profileNudgeAction}
            </button>
          </div>
        )}
      </header>

      <main>
        {activeJobs.length > 0 && (
          <section
            aria-labelledby="nexus-heading"
            className="mb-6 rounded-2xl border border-[#E5E4DF] bg-white p-5"
          >
            <h2 id="nexus-heading" className="text-sm font-semibold text-[#18181B]">
              {t.nexusHeading}
            </h2>
            <ul className="mt-3 divide-y divide-[#ECEBE6]">
              {activeJobs.map((job) => {
                const label = (job.input?.rawIdea || job.input?.ideaTitle || "").slice(0, 90);
                if (job.status === "needs_input") {
                  return (
                    <li
                      key={job.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-[#C2410C]" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#C2410C]">{t.nexusQuestion}</p>
                          <p className="text-sm text-[#18181B]">{job.result?.question}</p>
                          <p className="truncate text-xs text-[#6B6B65]">{label}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onAnswerJob(job)}
                        className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#18181B] px-4 text-sm font-semibold text-white hover:bg-[#3F3F46]"
                      >
                        {t.answer}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={job.id} className="flex items-start gap-2.5 py-3">
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#F97316]" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[#18181B]">
                        {job.kind === "sprint" ? t.nexusSprinting(label) : t.nexusAnalyzing(label)}
                      </p>
                      <p className="text-xs text-[#6B6B65]">
                        {job.error === "quota"
                          ? t.nexusWaiting
                          : job.kind === "sprint"
                          ? t.phaseRunning
                          : t.nexusStep(job.step)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <form
          onSubmit={handleFormSubmit}
          className="rounded-2xl border border-[#E5E4DF] bg-white p-5 sm:p-8"
        >
          {revisingTitle && (
            <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-[#FDBA74] bg-[#FFFBEB] px-4 py-3">
              <p className="min-w-0 text-sm leading-relaxed text-[#3F3F46]">
                {t.revising(revisingTitle, revisingEvidenceCount)}
              </p>
              <button
                type="button"
                onClick={onCancelRevise}
                className="shrink-0 cursor-pointer text-xs font-medium text-[#6B6B65] underline underline-offset-4 hover:text-[#18181B]"
              >
                {t.cancel}
              </button>
            </div>
          )}

          <label
            htmlFor="idea-input"
            className="block text-sm font-medium text-[#18181B]"
          >
            {revisingTitle ? t.updatedIdea : t.yourIdea}
          </label>

          <textarea
            id="idea-input"
            value={rawIdea}
            onChange={(e) => onChangeIdea(e.target.value)}
            placeholder={t.ideaPlaceholder}
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
                    {t.oneQuestion}
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
                  {t.editIdea}
                </button>
              </div>

              <textarea
                id="clarification-input"
                value={clarificationAnswer}
                onChange={(e) => onChangeClarification(e.target.value)}
                placeholder={t.answerPlaceholder}
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
                  {t.retry}
                </button>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-[#6B6B65]">
              {t.noFlattery}
            </p>
            <button
              type="submit"
              className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#F97316] px-7 py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[#EA580C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316] sm:w-auto"
            >
              <span>
                {clarifyingQuestion ? t.submitContinue : revisingTitle ? t.submitRerun : t.submitIgnite}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>

        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 className="text-sm font-medium text-[#575752]">{t.yourIdeas}</h2>
            {!onSignOut && (
              <span className="text-xs text-[#787871]">
                {t.browserOnly}
              </span>
            )}
          </div>

          {ideasLoading ? (
            <p className="px-1 text-sm text-[#787871]">{t.loadingIdeas}</p>
          ) : ideas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#DFDED8] px-5 py-6 text-sm leading-relaxed text-[#6B6B65]">
              {t.noIdeas}
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
                        <span>
                          {latest.data.decision
                            ? t.decisionCalls[latest.data.decision.call]
                            : t.verdict(score)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{t.reportsCount(idea.versions.length)}</span>
                        {idea.sprint && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {t.sprintProgress(
                                sprintTotals(idea.sprint).done,
                                sprintTotals(idea.sprint).total
                              )}
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
