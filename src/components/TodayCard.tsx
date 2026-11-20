import { ArrowRight, CalendarCheck, FlaskConical, MessageCircle, Sun } from "lucide-react";
import { sprintTaskKey, sprintTotals, type Idea } from "../lib/analyzeIdea";
import { useI18n } from "../lib/i18n";
import { track } from "../lib/track";

interface TodayCardProps {
  ideas: Idea[];
  founderName: string;
  onOpenIdea: (idea: Idea) => void;
  onAsk?: () => void;
}

/** The first sprint day that still has unfinished tasks. */
function nextSprintDay(idea: Idea) {
  if (!idea.sprint) return null;
  const done = new Set(idea.sprint.done);
  for (const day of idea.sprint.plan.days) {
    const open = day.tasks
      .map((task, i) => ({ task, key: sprintTaskKey(day.day, i) }))
      .filter(({ key }) => !done.has(key));
    if (open.length > 0) return { day, open };
  }
  return null;
}

/**
 * The founder's morning brief, at the top of the home screen: today's sprint
 * tasks for the idea they are working on, and the tests still open.
 */
export function TodayCard({ ideas, founderName, onOpenIdea, onAsk }: TodayCardProps) {
  const { t } = useI18n();
  if (ideas.length === 0) return null;

  // Work on the most recently touched idea that has a sprint, else the newest idea.
  const byRecent = [...ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const focus = byRecent.find((i) => i.sprint) ?? byRecent[0];
  const next = nextSprintDay(focus);
  const totals = focus.sprint ? sprintTotals(focus.sprint) : null;
  const openTests = focus.experiments.filter((e) => e.status !== "done").slice(0, 3);
  const decision = focus.versions[0]?.data.decision?.call;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t.todayMorning : hour < 17 ? t.todayAfternoon : t.todayEvening;
  const pct = totals && totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;

  return (
    <section
      aria-labelledby="today-heading"
      className="mb-6 overflow-hidden rounded-2xl border border-[#E5E4DF] bg-white"
    >
      <div className="flex items-center gap-2 border-b border-[#F0EFEA] bg-[#FFF7ED] px-5 py-3">
        <Sun className="h-4 w-4 text-[#EA580C]" />
        <h2 id="today-heading" className="text-sm font-semibold text-[#18181B]">
          {greeting}
          {founderName ? `, ${founderName}` : ""}
        </h2>
      </div>

      <div className="p-5">
        <button
          type="button"
          onClick={() => onOpenIdea(focus)}
          className="group flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 text-left"
        >
          <span className="min-w-0">
            <span className="block text-xs font-medium text-[#6B6B65]">{t.todayIdea}</span>
            <span className="block truncate font-display text-lg font-semibold text-[#18181B] group-hover:underline">
              {focus.title}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-[#9B9B94] group-hover:text-[#18181B]" />
        </button>

        {next ? (
          <div className="mt-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#18181B]">
              <CalendarCheck className="h-4 w-4 text-[#F97316]" />
              {t.todaySprintDay(next.day.day)}
              {next.day.theme ? <span className="font-normal text-[#575752]">· {next.day.theme}</span> : null}
            </p>
            <ul className="mt-2 space-y-1.5">
              {next.open.map(({ task, key }) => (
                <li key={key} className="flex gap-2 text-sm leading-snug text-[#3F3F46]">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#F97316]" />
                  <span className="min-w-0">
                    {task.title}
                    {task.material_title && (
                      <span className="block text-xs text-[#6B6B65]">
                        {t.todayReady}: {task.material_title}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {totals && (
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F0EFEA]">
                  <div className="h-full rounded-full bg-[#F97316]" style={{ width: `${pct}%` }} />
                </div>
                <span className="shrink-0 text-xs text-[#6B6B65]">{t.sprintTasksDone(totals.done, totals.total)}</span>
              </div>
            )}
          </div>
        ) : focus.sprint ? (
          <p className="mt-4 text-sm leading-relaxed text-[#3F3F46]">{t.todaySprintFinished}</p>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-[#3F3F46]">
            {decision ? t.todayNoSprint(decision.toUpperCase()) : t.todayNoSprint("—")}
          </p>
        )}

        {openTests.length > 0 && (
          <div className="mt-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#18181B]">
              <FlaskConical className="h-4 w-4 text-[#F97316]" />
              {t.todayOpenTests}
            </p>
            <ul className="mt-2 space-y-1">
              {openTests.map((e) => (
                <li key={e.id} className="truncate text-sm text-[#3F3F46]">
                  · {e.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              track("today_open_plan", { hasSprint: Boolean(focus.sprint) });
              onOpenIdea(focus);
            }}
            className="inline-flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#F97316] px-4 text-sm font-semibold text-white hover:bg-[#EA580C]"
          >
            {focus.sprint ? t.todayOpenPlan : t.todayBuildSprint}
            <ArrowRight className="h-4 w-4" />
          </button>
          {onAsk && (
            <button
              type="button"
              onClick={() => {
                track("today_ask");
                onAsk();
              }}
              className="inline-flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#DFDED8] bg-white px-4 text-sm font-medium text-[#18181B] hover:bg-[#FAFAF8]"
            >
              <MessageCircle className="h-4 w-4" />
              {t.todayAsk}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
