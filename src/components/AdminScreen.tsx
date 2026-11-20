// FORGE's private dashboard for the team: who uses FORGE, what they use,
// where they drop off, what breaks, and what they say. Read through the
// admin_stats() database function, which refuses anyone not in `admins`.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Loader2, Mail, RefreshCw } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Named {
  name: string;
  count: number;
  users?: number;
}

interface FeedbackRow {
  id: string;
  kind: string;
  rating: number | null;
  message: string;
  screen: string | null;
  context: Record<string, unknown>;
  status: "new" | "seen" | "done";
  created_at: string;
  email: string | null;
}

interface Stats {
  users_total: number;
  users_new: number;
  active_today: number;
  active_7d: number;
  active_period: number;
  returning: number;
  ideas: number;
  reports: number;
  sprints: number;
  questions: number;
  funnel: Record<string, number>;
  events: Named[];
  screens: Named[];
  daily: Array<{ day: string; users: number; signups: number }>;
  decisions: Record<string, number>;
  languages: Record<string, number>;
  countries: Named[];
  jobs: { done: number; failed: number; waiting: number; quota_waits: number };
  job_errors: Array<{ error: string; count: number }>;
  client_errors: Array<{ error: string; count: number; users: number }>;
  ratings: { up: number; down: number };
  feedback: FeedbackRow[];
  recent_questions: Array<{ text: string; at: string; channel: string }>;
}

export async function checkIsAdmin(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc("is_admin");
  return !error && data === true;
}

const FUNNEL_STEPS: Array<[string, string]> = [
  ["signed_up", "Signed up"],
  ["profile", "Filled profile"],
  ["tested_idea", "Tested an idea"],
  ["built_sprint", "Built a sprint"],
  ["did_a_task", "Ticked a sprint task"],
  ["finished_test", "Finished a test"],
  ["asked_forge", "Asked FORGE"],
  ["came_back", "Came back another day"],
];

/** Friendly names for event codes. */
const EVENT_NAMES: Record<string, string> = {
  app_open: "Opened FORGE",
  analysis_started: "Started an analysis",
  analysis_done: "Got a report",
  analysis_failed: "Analysis failed",
  analysis_background: "Sent analysis to background",
  clarification_asked: "FORGE asked a question first",
  revise_started: "Re-ran an idea",
  sprint_requested: "Asked for a sprint",
  sprint_built: "Got a sprint",
  sprint_failed: "Sprint failed",
  sprint_task_toggled: "Ticked a sprint task",
  experiments_added: "Added tests",
  experiment_updated: "Updated a test",
  ask_opened: "Opened Ask FORGE",
  ask_sent: "Asked FORGE a question",
  ask_failed: "Ask FORGE failed",
  ask_action: "Clicked a chat suggestion",
  today_open_plan: "Today card: opened plan",
  today_ask: "Today card: asked FORGE",
  profile_saved: "Saved profile",
  language_changed: "Switched language",
  report_copied: "Copied a report",
  idea_deleted: "Deleted an idea",
  feedback_opened: "Opened feedback",
  feedback_sent: "Sent feedback",
};

const KIND_LABEL: Record<string, string> = {
  bug: "Bug",
  idea: "Idea",
  confusing: "Confusing",
  praise: "Praise",
  rating: "Rating",
  other: "Other",
};
const FACES = ["", "1/4", "2/4", "3/4", "4/4"];

function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/80 bg-white/70 shadow-[0_1px_2px_rgba(24,24,27,0.04),0_24px_60px_-36px_rgba(40,48,90,0.35)] backdrop-blur-xl p-5 ${className}`}>
      <h2 className="text-sm font-semibold text-[#18181B]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/70 shadow-[0_1px_2px_rgba(24,24,27,0.04),0_24px_60px_-36px_rgba(40,48,90,0.35)] backdrop-blur-xl p-4">
      <p className="text-xs font-medium text-[#6B6B65]">{label}</p>
      <p className="mt-1 font-display text-2xl font-medium text-[#18181B] tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[#9B9B94]">{hint}</p>}
    </div>
  );
}

function Bars({ rows, empty }: { rows: Array<{ label: string; value: number; note?: string }>; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-[#9B9B94]">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-[#3F3F46]">{r.label}</span>
            <span className="shrink-0 text-[#18181B] tabular-nums">
              {r.value}
              {r.note && <span className="ml-1 text-xs text-[#9B9B94]">{r.note}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F0EFEA]">
            <div className="h-full rounded-full bg-[#F97316]" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export function AdminScreen({ supabase, onBack }: { supabase: SupabaseClient; onBack: () => void }) {
  const [days, setDays] = useState(14);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("admin_stats", { p_days: days });
    if (err) setError(err.message);
    else setStats(data as Stats);
    setLoading(false);
  }, [supabase, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: FeedbackRow["status"]) => {
    setStats((s) => s && { ...s, feedback: s.feedback.map((f) => (f.id === id ? { ...f, status } : f)) });
    await supabase.rpc("admin_set_feedback_status", { p_id: id, p_status: status });
  };

  const maxDaily = Math.max(1, ...(stats?.daily.map((d) => d.users) ?? [1]));
  const feedback = (stats?.feedback ?? []).filter((f) => filter === "all" || f.status !== "done");
  const funnelTop = stats ? Math.max(1, stats.funnel.signed_up ?? 0) : 1;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-[#3F3F46] hover:bg-[#F4F4F1]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="mr-auto font-display text-2xl font-medium tracking-tight text-[#18181B]">FORGE Admin</h1>
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-[#DFDED8] bg-white p-0.5">
          {[1, 7, 14, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`min-h-[32px] min-w-[44px] cursor-pointer rounded-md px-2 text-xs font-semibold ${
                days === d ? "bg-[#18181B] text-white" : "text-[#575752] hover:text-[#18181B]"
              }`}
            >
              {d === 1 ? "Today" : `${d}d`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh"
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-[#DFDED8] bg-white text-[#3F3F46] hover:bg-[#FAFAF8]"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </header>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-[#F5C2C0] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
          {error}
        </p>
      )}

      {stats && (
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Founders (all time)" value={stats.users_total} hint={`+${stats.users_new} in period`} />
            <Kpi label="Active today" value={stats.active_today} hint={`${stats.active_7d} in last 7 days`} />
            <Kpi label="Came back another day" value={stats.returning} hint={`of ${stats.active_period} active`} />
            <Kpi
              label="Answers rated up / down"
              value={`${stats.ratings.up} / ${stats.ratings.down}`}
              hint={`${stats.reports} reports · ${stats.questions} questions`}
            />
          </div>

          <Card title="Active founders per day">
            <div className="flex h-32 items-end gap-1" aria-label="Daily active founders chart">
              {stats.daily.map((d) => (
                <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div
                    className="w-full rounded-t bg-[#F97316] transition-opacity group-hover:opacity-80"
                    style={{ height: `${(d.users / maxDaily) * 100}%`, minHeight: d.users > 0 ? 3 : 0 }}
                  />
                  <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 rounded bg-[#18181B] px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white group-hover:block">
                    {d.day}: {d.users} active, {d.signups} new
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-[#9B9B94]">
              <span>{stats.daily[0]?.day}</span>
              <span>{stats.daily[stats.daily.length - 1]?.day}</span>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Journey: founders who signed up in this period">
              <ul className="space-y-2">
                {FUNNEL_STEPS.map(([key, label]) => {
                  const value = stats.funnel[key] ?? 0;
                  const pct = Math.round((value / funnelTop) * 100);
                  return (
                    <li key={key}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-[#3F3F46]">{label}</span>
                        <span className="tabular-nums text-[#18181B]">
                          {value} <span className="text-xs text-[#9B9B94]">{pct}%</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#F0EFEA]">
                        <div className="h-full rounded-full bg-[#18181B]" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card title="What founders use most">
              <Bars
                empty="No activity yet."
                rows={stats.events.map((e) => ({
                  label: EVENT_NAMES[e.name] ?? e.name,
                  value: e.count,
                  note: e.users ? `${e.users} ppl` : undefined,
                }))}
              />
            </Card>

            <Card title="Screens visited">
              <Bars
                empty="No visits yet."
                rows={stats.screens.map((s) => ({ label: s.name, value: s.count, note: s.users ? `${s.users} ppl` : undefined }))}
              />
            </Card>

            <Card title="FORGE's decisions on ideas">
              <Bars
                empty="No reports yet."
                rows={Object.entries(stats.decisions).map(([k, v]) => ({ label: k.toUpperCase(), value: v }))}
              />
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-[#6B6B65]">Language</p>
                  {Object.entries(stats.languages).map(([k, v]) => (
                    <p key={k} className="text-[#3F3F46]">
                      {k === "sw" ? "Kiswahili" : "English"}: {v}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B6B65]">Countries</p>
                  {stats.countries.map((c) => (
                    <p key={c.name} className="truncate text-[#3F3F46]">
                      {c.name}: {c.count}
                    </p>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <Card title="What sucks: failures and errors">
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <p className="text-sm text-[#3F3F46]">
                  Background jobs: <b>{stats.jobs.done}</b> done · <b className="text-[#B91C1C]">{stats.jobs.failed}</b> failed ·{" "}
                  {stats.jobs.waiting} waiting · {stats.jobs.quota_waits} paused for AI quota
                </p>
                <ul className="mt-2 space-y-1.5">
                  {stats.job_errors.length === 0 && <li className="text-sm text-[#9B9B94]">No failed jobs.</li>}
                  {stats.job_errors.map((e) => (
                    <li key={e.error} className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
                      ×{e.count} {e.error}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm text-[#3F3F46]">Errors in founders' browsers</p>
                <ul className="mt-2 space-y-1.5">
                  {stats.client_errors.length === 0 && <li className="text-sm text-[#9B9B94]">No crashes reported.</li>}
                  {stats.client_errors.map((e) => (
                    <li key={e.error} className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
                      ×{e.count} ({e.users} ppl) {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          <Card title={`Feedback inbox (${stats.feedback.filter((f) => f.status === "new").length} new)`}>
            <div className="mb-3 inline-flex rounded-lg border border-[#DFDED8] bg-white p-0.5 text-xs">
              {(["open", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`min-h-[30px] cursor-pointer rounded-md px-3 font-semibold ${
                    filter === f ? "bg-[#18181B] text-white" : "text-[#575752]"
                  }`}
                >
                  {f === "open" ? "To do" : "All"}
                </button>
              ))}
            </div>
            {feedback.length === 0 && <p className="text-sm text-[#9B9B94]">Nothing here yet.</p>}
            <ul className="divide-y divide-[#F0EFEA]">
              {feedback.map((f) => (
                <li key={f.id} className={`py-3 ${f.status === "done" ? "opacity-50" : ""}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6B6B65]">
                    <span className="font-semibold text-[#18181B]">{KIND_LABEL[f.kind] ?? f.kind}</span>
                    {f.rating && <span className="font-mono">{FACES[f.rating]}</span>}
                    {f.status === "new" && (
                      <span className="rounded-full bg-[#F97316] px-2 py-0.5 text-[10px] font-bold text-white">NEW</span>
                    )}
                    <span>· {ago(f.created_at)}</span>
                    {f.screen && <span>· on {f.screen}</span>}
                    {typeof f.context?.target === "string" && <span>· about {f.context.target}</span>}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap break-words text-[#18181B]">{f.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {f.email && (
                      <a
                        href={`mailto:${f.email}?subject=${encodeURIComponent("About your FORGE feedback")}`}
                        className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[#DFDED8] px-2.5 text-xs font-medium text-[#18181B] hover:bg-[#FAFAF8]"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Reply to {f.email}
                      </a>
                    )}
                    {f.status !== "done" ? (
                      <button
                        type="button"
                        onClick={() => void setStatus(f.id, "done")}
                        className="inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full bg-[#18181B] px-2.5 text-xs font-medium text-white hover:bg-[#3F3F46]"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Mark done
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setStatus(f.id, "new")}
                        className="min-h-[32px] cursor-pointer rounded-lg border border-[#DFDED8] px-2.5 text-xs text-[#3F3F46]"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="What founders ask FORGE (latest, anonymous)">
            {stats.recent_questions.length === 0 && <p className="text-sm text-[#9B9B94]">No questions yet.</p>}
            <ul className="space-y-2">
              {stats.recent_questions.map((q, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="w-16 shrink-0 text-xs text-[#9B9B94]">{ago(q.at)}</span>
                  <span className="min-w-0 break-words text-[#3F3F46]">{q.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
