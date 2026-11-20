import { ExternalLink, ShieldCheck } from "lucide-react";
import type { SkepticSummary } from "../lib/analyzeIdea";
import { useI18n } from "../lib/i18n";

/** What FORGE's Skeptic agent checked, removed and argued. Hidden on older reports. */
export function SkepticCard({
  skeptic,
}: {
  skeptic: SkepticSummary | null | undefined;
}) {
  const { t } = useI18n();
  if (!skeptic) return null;

  return (
    <section
      aria-labelledby="skeptic-heading"
      className="rounded-2xl border border-[#E5E4DF] bg-white p-6 sm:p-8"
    >
      <h2
        id="skeptic-heading"
        className="flex items-center gap-2 font-display text-lg font-semibold text-[#18181B]"
      >
        <ShieldCheck className="h-5 w-5 text-[#15803D]" />
        {t.skepticHeading}
      </h2>
      {skeptic.checked > 0 && (
        <p className="mt-2 text-sm leading-relaxed text-[#3F3F46]">
          {t.skepticChecked(skeptic.supported, skeptic.checked)}
        </p>
      )}

      {skeptic.counterargument && (
        <div className="mt-5 rounded-xl border-l-4 border-[#B91C1C] bg-[#FEF2F2] p-4">
          <p className="text-xs font-semibold tracking-wide text-[#991B1B] uppercase">
            {t.skepticObjection}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-[#27272A]">
            {skeptic.counterargument}
          </p>
        </div>
      )}

      {skeptic.removed.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
            {t.skepticRemoved}
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[#3F3F46]">
            {skeptic.removed.map((name, i) => (
              <li key={i} className="line-through decoration-[#B91C1C]/60">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {skeptic.claims && skeptic.claims.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
            {t.evidenceHeading}
          </h3>
          <ul className="mt-2 space-y-2.5">
            {skeptic.claims.map((c, i) => {
              const badge =
                c.verdict === "supported"
                  ? ["✓", t.evidenceSupported, "bg-[#DCFCE7] text-[#166534]"]
                  : c.verdict === "labelled_estimate"
                    ? ["~", t.evidenceEstimate, "bg-[#F4F4F1] text-[#57534E]"]
                    : c.verdict === "contradicted"
                      ? ["✗", t.evidenceContradicted, "bg-[#FEE2E2] text-[#991B1B]"]
                      : ["✗", t.evidenceUnsupported, "bg-[#FFEDD5] text-[#9A3412]"];
              return (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-[#3F3F46]">
                  <span
                    className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${badge[2]}`}
                  >
                    <span aria-hidden="true">{badge[0]}</span>
                    {badge[1]}
                  </span>
                  <span className="min-w-0">
                    {c.claim}
                    {c.source_url && (
                      <a
                        href={c.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-medium text-[#C2410C] underline underline-offset-2"
                      >
                        {t.evidenceSource}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!skeptic.claims?.length && skeptic.unsupported.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold tracking-wide text-[#6B6B65] uppercase">
            {t.skepticUnsupported}
          </h3>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-[#3F3F46]">
            {skeptic.unsupported.map((claim, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C2410C]"
                />
                <span>{claim}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
