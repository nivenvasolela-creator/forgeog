import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { Idea, StoredForgeReport } from "../lib/analyzeIdea";
import { formatReportAsMarkdown, getVerdictLabel } from "../lib/storage";

interface ReportScreenProps {
  idea: Idea;
  /** Which report to show; null means the latest. */
  activeVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  warning: string | null;
  onBack: () => void;
  onNewIdea: () => void;
  onRevise: () => void;
  onDelete: () => void;
}

const BREAKDOWN_LABELS: Array<{
  key: keyof StoredForgeReport["data"]["idea_score"]["breakdown"];
  label: string;
}> = [
  { key: "problem_clarity", label: "Problem clarity" },
  { key: "market_signal", label: "Market signal" },
  { key: "founder_fit", label: "Founder fit" },
  { key: "feasibility", label: "Feasibility" },
  { key: "differentiation", label: "Differentiation" },
];

export function ReportScreen({
  idea,
  activeVersionId,
  onSelectVersion,
  warning,
  onBack,
  onNewIdea,
  onRevise,
  onDelete,
}: ReportScreenProps) {
  const [copied, setCopied] = useState(false);
  // Versions are stored newest first; number them oldest = v1.
  const versionIndex = Math.max(
    0,
    idea.versions.findIndex((v) => v.id === activeVersionId)
  );
  const report = idea.versions[versionIndex];
  const previous = idea.versions[versionIndex + 1];
  const versionNumber = idea.versions.length - versionIndex;
  const { data } = report;
  const overall = data.idea_score.overall;
  const delta = previous ? overall - previous.data.idea_score.overall : null;
  const verdict = getVerdictLabel(overall);

  const handleCopyMarkdown = async () => {
    const md = formatReportAsMarkdown(report);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy method if clipboard API is restricted
      const textarea = document.createElement("textarea");
      textarea.value = md;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const scoreAccentClass =
    overall >= 65
      ? "text-[#15803D]"
      : overall >= 45
      ? "text-[#C2410C]"
      : "text-[#B91C1C]";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Top Action Strip */}
      <header className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-[#575752] hover:text-[#18181B]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>
              <span className="font-display font-bold tracking-tight text-[#18181B]">
                FORGE
              </span>{" "}
              · All ideas
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleCopyMarkdown} className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#DFDED8] bg-white px-4 py-2 text-sm font-medium text-[#18181B] transition-colors hover:bg-[#FAFAF8] whitespace-nowrap shrink-0">
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-[#F97316]" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-[#575752]" />
                  <span>Copy as Markdown</span>
                </>
              )}
            </button>

            <button type="button" onClick={onNewIdea} className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#DFDED8] bg-white px-4 py-2 text-sm font-medium text-[#18181B] transition-colors hover:bg-[#FAFAF8] whitespace-nowrap shrink-0">
              <Plus className="h-4 w-4 text-[#575752]" />
              <span>New idea</span>
            </button>

            <button
              type="button"
              onClick={onRevise}
              className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#F97316] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#EA580C] whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Revise and re-run</span>
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#18181B] sm:text-3xl">
              {idea.title}
            </h1>
            <p className="mt-1 text-xs text-[#6B6B65]">
              Report v{versionNumber} of {idea.versions.length} ·{" "}
              {new Date(report.createdAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-[#787871] underline underline-offset-4 hover:text-[#B91C1C]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete idea</span>
          </button>
        </div>

        {idea.versions.length > 1 && (
          <nav aria-label="Report versions" className="mt-4 flex flex-wrap gap-2">
            {idea.versions.map((v, idx) => {
              const isActive = idx === versionIndex;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelectVersion(v.id)}
                  className={`inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs tabular-nums transition-colors ${
                    isActive
                      ? "border-[#18181B] bg-[#18181B] text-white"
                      : "border-[#DFDED8] bg-white text-[#3F3F46] hover:bg-[#FAFAF8]"
                  }`}
                >
                  <span>v{idea.versions.length - idx}</span>
                  <span className={isActive ? "text-[#D4D4D8]" : "text-[#787871]"}>
                    {v.data.idea_score.overall}/100
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        {warning && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-[#F5C2C0] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]"
          >
            {warning}
          </p>
        )}
      </header>

      <div className="space-y-6">
        {/* Hero Verdict + Breakdown */}
        <section className="rounded-2xl border border-[#E5E4DF] bg-white p-6 sm:p-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-7">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs font-medium text-[#6B6B65]">
                <span>Verdict</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">
                  Confidence: {data.idea_score.confidence}
                </span>
              </div>

              <div className="mt-4 flex items-baseline gap-3">
                <span
                  className={`font-display text-5xl font-bold tracking-tight tabular-nums sm:text-6xl ${scoreAccentClass}`}
                >
                  {overall}
                </span>
                <span className="font-mono text-lg text-[#787871] tabular-nums">
                  / 100
                </span>
                {delta !== null && (
                  <span
                    className={`font-mono text-sm tabular-nums ${
                      delta > 0
                        ? "text-[#15803D]"
                        : delta < 0
                        ? "text-[#B91C1C]"
                        : "text-[#787871]"
                    }`}
                  >
                    {delta > 0 ? `+${delta}` : delta === 0 ? "no change" : delta}{" "}
                    {delta === 0 ? `from v${versionNumber - 1}` : `vs v${versionNumber - 1}`}
                  </span>
                )}
              </div>

              <h2 className="mt-3 font-display text-xl font-semibold text-[#18181B] sm:text-2xl">
                {verdict}
              </h2>

              <p className="mt-3 text-base leading-relaxed text-[#27272A]">
                {data.idea_score.rationale}
              </p>

              <div className="mt-5 border-t border-[#ECEBE6] pt-4">
                <p className="text-xs font-medium text-[#6B6B65]">Idea tested</p>
                <p className="mt-1 text-sm leading-relaxed text-[#3F3F46]">
                  {data.idea_summary}
                </p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-[#6B6B65] hover:text-[#18181B]">
                    What you wrote for this version
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-[#575752]">
                    {report.rawIdea}
                    {report.clarification ? `\n\n${report.clarification}` : ""}
                  </p>
                </details>
              </div>
            </div>

            <div className="border-t border-[#ECEBE6] pt-6 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
              <h3 className="text-sm font-semibold text-[#18181B]">
                Score breakdown
              </h3>
              <div className="mt-4 space-y-4">
                {BREAKDOWN_LABELS.map(({ key, label }) => {
                  const val = data.idea_score.breakdown[key];
                  const pct = Math.min(100, Math.max(0, (val / 10) * 100));
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#3F3F46]">{label}</span>
                        <span className="font-mono font-medium tabular-nums text-[#18181B]">
                          {val}/10
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#EFECE6]"
                        role="progressbar"
                        aria-valuenow={val}
                        aria-valuemin={0}
                        aria-valuemax={10}
                        aria-label={label}
                      >
                        <div
                          className="h-full rounded-full bg-[#F97316] transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Clearly visible "What I couldn't verify" Card */}
        <section
          aria-labelledby="unverified-heading"
          className="rounded-2xl border border-[#FDBA74] bg-[#FFFBEB] p-6 sm:p-7"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#C2410C]" />
            <div className="min-w-0 flex-1">
              <h2
                id="unverified-heading"
                className="font-display text-lg font-semibold text-[#18181B]"
              >
                What I couldn&apos;t verify
              </h2>
              {data.grounding_flags.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#3F3F46]">
                  {data.grounding_flags.map((flag, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C2410C]"
                      />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-[#3F3F46]">
                  Competitor references matched retrieved web sources, though market size and pricing figures remain estimates until tested with buyers.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* SWOT 2x2 Grid */}
        <section className="rounded-2xl border border-[#E5E4DF] bg-white p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold text-[#18181B]">
            SWOT Analysis
          </h2>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <SwotQuadrant
              title="Strengths"
              items={data.swot.strengths}
              emptyText="No clear strengths identified from the input."
            />
            <SwotQuadrant
              title="Weaknesses"
              items={data.swot.weaknesses}
              emptyText="No weaknesses listed."
            />
            <SwotQuadrant
              title="Opportunities"
              items={data.swot.opportunities}
              emptyText="No verified opportunities identified."
            />
            <SwotQuadrant
              title="Threats"
              items={data.swot.threats}
              emptyText="No major threats listed."
            />
          </div>
        </section>

        {/* Competitors & Sources */}
        <section className="rounded-2xl border border-[#E5E4DF] bg-white p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold text-[#18181B]">
            Competitors
          </h2>

          {data.competitors.length > 0 ? (
            <div className="mt-4 divide-y divide-[#ECEBE6]">
              {data.competitors.map((comp, idx) => (
                <div
                  key={`${comp.name}-${idx}`}
                  className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-[#18181B]">
                      {comp.name}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#575752]">
                      {comp.what_they_do}
                    </p>
                  </div>
                  {comp.source_url ? (
                    <a
                      href={comp.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 text-xs font-medium text-[#C2410C] underline underline-offset-4 hover:text-[#9A3412]"
                    >
                      <span>Source</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-[#787871]">
                      Unverified source
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-[#575752]">
              Could not verify competitors from live search sources. No unverified competitors were fabricated.
            </p>
          )}

          {data.sources.length > 0 && (
            <div className="mt-6 border-t border-[#ECEBE6] pt-5">
              <h3 className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                Retrieved search sources
              </h3>
              <ul className="mt-3 space-y-2">
                {data.sources.map((src, idx) => (
                  <li key={`${src.url}-${idx}`} className="text-sm">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[#3F3F46] underline decoration-[#D6D5CF] underline-offset-4 hover:text-[#F97316] hover:decoration-[#F97316]"
                    >
                      <span className="break-all">{src.title || src.url}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Blueprint & Business Plan */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Blueprint */}
          <section className="rounded-2xl border border-[#E5E4DF] bg-white p-6 sm:p-8">
            <h2 className="font-display text-lg font-semibold text-[#18181B]">
              Blueprint
            </h2>

            <dl className="mt-5 space-y-5">
              <div>
                <dt className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  Problem
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-[#27272A]">
                  {data.blueprint.problem}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  Target user
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-[#27272A]">
                  {data.blueprint.target_user}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  Solution
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-[#27272A]">
                  {data.blueprint.solution}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  Business model
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-[#27272A]">
                  {data.blueprint.business_model}
                </dd>
              </div>
            </dl>

            <div className="mt-6 border-t border-[#ECEBE6] pt-5">
              <h3 className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                Key risks
              </h3>
              <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-[#27272A]">
                {data.blueprint.key_risks.map((risk, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#18181B]"
                    />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 border-t border-[#ECEBE6] pt-5">
              <h3 className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                Validate next
              </h3>
              <ol className="mt-2.5 space-y-2 text-sm leading-relaxed text-[#27272A]">
                {data.blueprint.validate_next.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="font-mono text-xs font-semibold tabular-nums text-[#F97316] mt-0.5">
                      {idx + 1}.
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Business Plan */}
          <section className="rounded-2xl border border-[#E5E4DF] bg-white p-6 sm:p-8">
            <h2 className="font-display text-lg font-semibold text-[#18181B]">
              Business Plan
            </h2>

            <dl className="mt-5 space-y-5">
              <div>
                <dt className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  <span>TAM</span>
                  <EstimateTag />
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-[#27272A]">
                  {data.business_plan.tam_estimate}
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  <span>Pricing hypothesis</span>
                  <EstimateTag />
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-[#27272A]">
                  {data.business_plan.pricing_hypothesis}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  Go-to-market
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-[#27272A]">
                  {data.business_plan.go_to_market}
                </dd>
              </div>
            </dl>

            <div className="mt-6 border-t border-[#ECEBE6] pt-5">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
                  Assumptions
                </h3>
                <EstimateTag />
              </div>
              <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-[#27272A]">
                {data.business_plan.assumptions.map((assumption, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#787871]"
                    />
                    <span>{assumption}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function EstimateTag() {
  return (
    <span className="rounded border border-[#FDBA74] bg-[#FFF7ED] px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#C2410C] uppercase">
      ESTIMATE
    </span>
  );
}

function SwotQuadrant({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <div className="rounded-xl border border-[#ECEBE6] bg-[#FAFAF8] p-5">
      <h3 className="text-sm font-semibold text-[#18181B]">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#3F3F46]">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#575752]"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[#787871]">{emptyText}</p>
      )}
    </div>
  );
}
