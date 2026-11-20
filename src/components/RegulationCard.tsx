import { Landmark } from "lucide-react";
import type { RegulationItem } from "../lib/analyzeIdea";
import { useI18n } from "../lib/i18n";

/** Licences, permits and rules the idea likely needs. Hidden when there are none. */
export function RegulationCard({ items }: { items: RegulationItem[] | undefined }) {
  const { t } = useI18n();
  if (!items || items.length === 0) return null;
  return (
    <section
      aria-labelledby="regulation-heading"
      className="rounded-2xl border border-[#FCD34D] bg-[#FFFBEB] p-6 sm:p-8"
    >
      <h2
        id="regulation-heading"
        className="flex items-center gap-2 font-display text-lg font-semibold text-[#18181B]"
      >
        <Landmark className="h-5 w-5 text-[#B45309]" />
        {t.regulationHeading}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[#57534E]">{t.regulationLead}</p>
      <ul className="mt-4 space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-xl border border-[#FDE68A] bg-white p-4">
            <p className="text-sm font-semibold text-[#18181B]">{item.area}</p>
            <p className="mt-1 text-sm leading-relaxed text-[#3F3F46]">{item.why}</p>
            {item.check_with && (
              <p className="mt-2 text-xs text-[#78716C]">
                <span className="font-semibold text-[#92400E]">{t.regulationCheckWith}:</span> {item.check_with}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
