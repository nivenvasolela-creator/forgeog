import { useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import {
  completedEvidence,
  type Experiment,
  type ExperimentOutcome,
  type ExperimentStatus,
} from "../lib/analyzeIdea";
import type { ExperimentPatch } from "../lib/store";

interface ValidationPlanProps {
  experiments: Experiment[];
  /** True when the idea could not be saved, so there is nowhere to keep a plan. */
  disabled: boolean;
  onAdd: (title: string) => void;
  onUpdate: (experimentId: string, patch: ExperimentPatch) => void;
  onDelete: (experimentId: string) => void;
  onRerun: () => void;
}

const STATUS_LABELS: Record<ExperimentStatus, string> = {
  todo: "To do",
  running: "In progress",
  done: "Done",
};

const OUTCOME_LABELS: Record<ExperimentOutcome, string> = {
  supported: "Supported the idea",
  refuted: "Went against the idea",
  inconclusive: "Inconclusive",
};

const selectClass =
  "min-h-[36px] cursor-pointer rounded-lg border border-[#DFDED8] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18181B] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none";

export function ValidationPlan({
  experiments,
  disabled,
  onAdd,
  onUpdate,
  onDelete,
  onRerun,
}: ValidationPlanProps) {
  const [draft, setDraft] = useState("");
  const doneCount = experiments.filter((e) => e.status === "done").length;
  const evidenceCount = completedEvidence(experiments).length;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    onAdd(title);
    setDraft("");
  };

  return (
    <section
      aria-labelledby="validation-plan-heading"
      className="rounded-2xl border border-[#E5E4DF] bg-white p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="validation-plan-heading"
          className="font-display text-lg font-semibold text-[#18181B]"
        >
          Validation plan
        </h2>
        {experiments.length > 0 && (
          <span className="font-mono text-xs tabular-nums text-[#6B6B65]">
            {doneCount} of {experiments.length} done
          </span>
        )}
      </div>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#575752]">
        The score only moves on evidence. Run these in the real world, record
        what happened, then re-run the idea so the report weighs your results.
      </p>

      {disabled ? (
        <p className="mt-4 text-sm text-[#787871]">
          This idea was not saved, so a plan cannot be kept for it.
        </p>
      ) : (
        <>
          {experiments.length > 0 && (
            <ul className="mt-5 divide-y divide-[#ECEBE6] border-y border-[#ECEBE6]">
              {experiments.map((exp) => (
                <ExperimentRow
                  key={exp.id}
                  experiment={exp}
                  onUpdate={(patch) => onUpdate(exp.id, patch)}
                  onDelete={() => onDelete(exp.id)}
                />
              ))}
            </ul>
          )}

          <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="new-experiment" className="sr-only">
              Add an experiment
            </label>
            <input
              id="new-experiment"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder="Add your own experiment, e.g. Interview 10 target users"
              className="min-h-[44px] w-full flex-1 rounded-xl border border-[#DFDED8] bg-white px-4 py-2 text-sm text-[#18181B] placeholder-[#9B9B94] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[#DFDED8] bg-white px-4 py-2 text-sm font-medium text-[#18181B] transition-colors hover:bg-[#FAFAF8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>Add</span>
            </button>
          </form>

          {evidenceCount > 0 && (
            <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[#FDBA74] bg-[#FFFBEB] p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-relaxed text-[#3F3F46]">
                {evidenceCount === 1
                  ? "1 finished experiment is"
                  : `${evidenceCount} finished experiments are`}{" "}
                ready to be weighed in a new report.
              </p>
              <button
                type="button"
                onClick={onRerun}
                className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#F97316] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#EA580C]"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Re-run with results</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ExperimentRow({
  experiment,
  onUpdate,
  onDelete,
}: {
  experiment: Experiment;
  onUpdate: (patch: ExperimentPatch) => void;
  onDelete: () => void;
}) {
  // Notes are edited locally and saved when the field loses focus.
  const [notes, setNotes] = useState(experiment.notes);
  const isDone = experiment.status === "done";

  return (
    <li className="py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p
          className={`min-w-0 flex-1 text-sm leading-relaxed ${
            isDone ? "text-[#575752]" : "text-[#18181B]"
          }`}
        >
          {experiment.title}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label={`Status of: ${experiment.title}`}
            value={experiment.status}
            onChange={(e) =>
              onUpdate({ status: e.target.value as ExperimentStatus })
            }
            className={selectClass}
          >
            {(Object.keys(STATUS_LABELS) as ExperimentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Remove: ${experiment.title}`}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[#9B9B94] transition-colors hover:bg-[#FEF2F2] hover:text-[#B91C1C]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isDone && (
        <div className="mt-3 rounded-xl bg-[#FAFAF8] p-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[#6B6B65] sm:flex-row sm:items-center sm:gap-3">
            <span>Result</span>
            <select
              value={experiment.outcome ?? ""}
              onChange={(e) =>
                onUpdate({
                  outcome: (e.target.value || null) as ExperimentOutcome | null,
                })
              }
              className={selectClass}
            >
              <option value="">Choose a result...</option>
              {(Object.keys(OUTCOME_LABELS) as ExperimentOutcome[]).map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-xs font-medium text-[#6B6B65]">
            What happened
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes.trim() !== experiment.notes) {
                  onUpdate({ notes: notes.trim() });
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder="Specifics count: who, how many, what they said, did or paid."
              className="mt-1.5 w-full resize-y rounded-lg border border-[#DFDED8] bg-white px-3 py-2 text-sm font-normal leading-relaxed text-[#18181B] placeholder-[#9B9B94] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15 focus:outline-none"
            />
          </label>
          {!experiment.outcome && (
            <p className="mt-2 text-xs text-[#C2410C]">
              Choose a result so this counts in your next re-run.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
