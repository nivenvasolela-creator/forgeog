import { useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  Rocket,
  Target,
} from "lucide-react";
import {
  sprintTaskKey,
  sprintTotals,
  type Sprint,
  type SprintTask,
} from "../lib/analyzeIdea";
import { useI18n } from "../lib/i18n";

interface SprintPanelProps {
  sprint: Sprint | null;
  /** True when the idea was not saved, so a sprint cannot be kept. */
  disabled: boolean;
  building: boolean;
  error: string | null;
  showProfileTip: boolean;
  onBuild: () => void;
  onToggleTask: (key: string) => void;
}

export function SprintPanel({
  sprint,
  disabled,
  building,
  error,
  showProfileTip,
  onBuild,
  onToggleTask,
}: SprintPanelProps) {
  const { t } = useI18n();
  const totals = sprint ? sprintTotals(sprint) : { done: 0, total: 0 };
  const doneSet = new Set(sprint?.done ?? []);

  // The first unfinished task, in day order, is what the founder should do next.
  let nextKey: string | null = null;
  if (sprint) {
    for (const day of sprint.plan.days) {
      const idx = day.tasks.findIndex(
        (_, i) => !doneSet.has(sprintTaskKey(day.day, i)),
      );
      if (idx >= 0) {
        nextKey = sprintTaskKey(day.day, idx);
        break;
      }
    }
  }
  const pct =
    totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;

  const handleRebuild = () => {
    if (window.confirm(t.rebuildConfirm)) onBuild();
  };

  return (
    <section
      aria-labelledby="sprint-heading"
      className="rounded-2xl border border-[#18181B] bg-white p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2
          id="sprint-heading"
          className="flex items-center gap-2 font-display text-lg font-medium text-[#18181B]"
        >
          <Rocket className="h-5 w-5 text-[#F97316]" />
          {t.sprintHeading}
        </h2>
        {sprint && !building && (
          <button
            type="button"
            onClick={handleRebuild}
            className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 text-xs font-medium text-[#6B6B65] underline underline-offset-4 hover:text-[#18181B]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t.rebuildSprint}
          </button>
        )}
      </div>

      {disabled ? (
        <p className="mt-3 text-sm text-[#787871]">{t.sprintUnavailable}</p>
      ) : building ? (
        <p
          className="mt-4 flex items-center gap-2 text-sm text-[#3F3F46]"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin text-[#F97316]" />
          {t.buildingSprint}
        </p>
      ) : !sprint ? (
        <div className="mt-2">
          <p className="max-w-2xl text-sm leading-relaxed text-[#575752]">
            {t.sprintIntro}
          </p>
          {showProfileTip && (
            <p className="mt-3 text-xs leading-relaxed text-[#6B6B65]">
              {t.sprintAskProfile}
            </p>
          )}
          <button
            type="button"
            onClick={onBuild}
            className="mt-5 inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#18181B] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3F3F46] sm:w-auto"
          >
            <Rocket className="h-4 w-4" />
            <span>{t.buildSprint}</span>
          </button>
        </div>
      ) : (
        <>
          {(sprint.plan.goal || sprint.plan.success_metric) && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sprint.plan.goal && (
                <div className="rounded-xl bg-[#FAFAF8] p-4">
                  <p className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                    {t.sprintGoal}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[#18181B]">
                    {sprint.plan.goal}
                  </p>
                </div>
              )}
              {sprint.plan.success_metric && (
                <div className="rounded-xl bg-[#FAFAF8] p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                    <Target className="h-3.5 w-3.5" />
                    {t.sprintMetric}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[#18181B]">
                    {sprint.plan.success_metric}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-[#6B6B65]">
              <span>{t.sprintTasksDone(totals.done, totals.total)}</span>
              <span className="font-mono tabular-nums">{pct}%</span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#EFECE6]"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t.sprintTasksDone(totals.done, totals.total)}
            >
              <div
                className="h-full rounded-full bg-[#F97316] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {nextKey === null && totals.total > 0 && (
            <p className="mt-5 rounded-xl border border-[#D6D5CF] bg-[#F4F3EF] p-4 text-sm leading-relaxed text-[#14532D]">
              {t.sprintComplete}
            </p>
          )}

          <ol className="mt-6 space-y-3">
            {sprint.plan.days.map((day) => {
              const dayDone = day.tasks.every((_, i) =>
                doneSet.has(sprintTaskKey(day.day, i)),
              );
              const holdsNext = day.tasks.some(
                (_, i) => sprintTaskKey(day.day, i) === nextKey,
              );
              return (
                <li key={day.day}>
                  <details
                    open={holdsNext}
                    className="group rounded-xl border border-[#E5E4DF] open:border-[#D6D5CF]"
                  >
                    <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold tabular-nums ${
                          dayDone
                            ? "bg-[#F97316] text-white"
                            : holdsNext
                              ? "bg-[#18181B] text-white"
                              : "bg-[#F4F3EF] text-[#575752]"
                        }`}
                      >
                        {dayDone ? <Check className="h-4 w-4" /> : day.day}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-[#6B6B65]">
                          {t.day(day.day)}
                        </span>
                        <span className="block text-sm font-semibold text-[#18181B]">
                          {day.theme}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-[#787871]">
                        {
                          day.tasks.filter((_, i) =>
                            doneSet.has(sprintTaskKey(day.day, i)),
                          ).length
                        }
                        /{day.tasks.length}
                      </span>
                    </summary>
                    <ul className="space-y-3 border-t border-[#ECEBE6] p-3 sm:p-4">
                      {day.tasks.map((task, i) => {
                        const key = sprintTaskKey(day.day, i);
                        return (
                          <TaskCard
                            key={key}
                            task={task}
                            done={doneSet.has(key)}
                            isNext={key === nextKey}
                            onToggle={() => onToggleTask(key)}
                          />
                        );
                      })}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 flex flex-col gap-3 rounded-xl border border-[#F5C2C0] bg-[#FEF2F2] p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5 text-sm text-[#991B1B]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          {!building && (
            <button
              type="button"
              onClick={onBuild}
              className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#F5C2C0] bg-white px-3.5 py-2 text-xs font-semibold text-[#991B1B] hover:bg-[#FEF2F2]"
            >
              {t.retry}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function TaskCard({
  task,
  done,
  isNext,
  onToggle,
}: {
  task: SprintTask;
  done: boolean;
  isNext: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copyMaterial = async () => {
    try {
      await navigator.clipboard.writeText(task.material);
    } catch {
      const area = document.createElement("textarea");
      area.value = task.material;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <li
      className={`rounded-xl p-4 ${
        isNext
          ? "border-2 border-[#F97316] bg-[#FAF9F6]"
          : "border border-[#ECEBE6] bg-white"
      }`}
    >
      {isNext && (
        <p className="mb-2 text-xs font-bold tracking-wide text-[#C2410C] uppercase">
          {t.doThisNext}
        </p>
      )}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={done}
          aria-label={done ? t.markNotDone : t.markDone}
          title={done ? t.markNotDone : t.markDone}
          className={`mt-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 transition-colors ${
            done
              ? "border-[#F97316] bg-[#F97316] text-white"
              : "border-[#D6D5CF] bg-white text-transparent hover:border-[#F97316]"
          }`}
        >
          <Check className="h-4 w-4 stroke-[3]" />
        </button>
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-semibold leading-snug ${
              done ? "text-[#787871] line-through" : "text-[#18181B]"
            }`}
          >
            {task.title}
          </p>
          {task.why && (
            <p className="mt-1 text-sm leading-relaxed text-[#575752]">
              <span className="font-medium text-[#3F3F46]">{t.why}: </span>
              {task.why}
            </p>
          )}

          {!done && task.steps.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                {t.howTo}
              </p>
              <ol className="mt-2 space-y-1.5 text-sm leading-relaxed text-[#27272A]">
                {task.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#F97316]">
                      {i + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!done && task.material && (
            <div className="mt-3 rounded-lg border border-[#E5E4DF] bg-[#FAFAF8]">
              <div className="flex items-center justify-between gap-3 border-b border-[#ECEBE6] px-3 py-2">
                <p className="min-w-0 truncate text-xs font-semibold text-[#3F3F46]">
                  {task.material_title || t.copy}
                </p>
                <button
                  type="button"
                  onClick={() => void copyMaterial()}
                  className="inline-flex min-h-[32px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#C2410C] hover:bg-white"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? t.copied : t.copy}
                </button>
              </div>
              <p className="px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-[#27272A]">
                {task.material}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
