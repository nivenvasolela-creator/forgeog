// The report as a deck of cards: one idea per card, in brief, swiped like a
// dating app (or arrows / keyboard). Every card can hand the founder to Ask
// FORGE for the detail, so the cards stay short. Quiet, editorial styling:
// paper, ink, hairlines, one accent.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { sprintTotals, type ForgeReportData, type Idea } from "../lib/analyzeIdea";
import { useI18n } from "../lib/i18n";
import { track } from "../lib/track";

interface ReportDeckProps {
  idea: Idea;
  data: ForgeReportData;
  /** Only the latest report can start a sprint. */
  isLatest: boolean;
  onAsk?: (question: string) => void;
  onTestIdea: (text: string) => void;
  onBuildSprint: () => void;
  sprintBuilding: boolean;
  onOpenPlan: () => void;
  onOpenFull: () => void;
}

interface Card {
  id: string;
  title: string;
  body: ReactNode;
}

/** The first sentence or so of a text, cut cleanly at a word. */
export function brief(text: string | undefined, max: number): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  return `${cut.replace(/\s+\S*$/, "")}…`;
}

const SWIPE_DISTANCE = 80;
const SWIPE_SPEED = 0.45; // px per ms
const LEAVE_MS = 260;
const pad = (n: number) => String(n).padStart(2, "0");

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10.5px] font-medium tracking-[0.16em] text-[#8A8A82] uppercase">{children}</p>
  );
}

function Ring({ value, size = 132, caption }: { value: number; size?: number; caption?: string }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECEBE6" strokeWidth="2" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#18181B"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-display leading-none font-normal tracking-tight text-[#18181B] tabular-nums"
          style={{ fontSize: size * 0.34 }}
        >
          {value}
        </span>
        {caption && (
          <span className="mt-1 text-[10px] tracking-[0.16em] text-[#8A8A82] uppercase">{caption}</span>
        )}
      </div>
    </div>
  );
}

function Line({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="border-t border-[#ECEBE6] pt-3 first:border-t-0 first:pt-0">
      <Label>{label}</Label>
      <p className="mt-1 text-[15px] leading-snug text-[#27272A]">{text}</p>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-snug text-[#27272A]">
          <span className="mt-[11px] h-px w-3 shrink-0 bg-[#18181B]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Note({ label, text, accent = false }: { label: string; text: string; accent?: boolean }) {
  return (
    <div className={`border-l-2 pl-4 ${accent ? "border-[#C2410C]" : "border-[#18181B]"}`}>
      <Label>{label}</Label>
      <p className="mt-1 font-display text-[18px] leading-snug text-[#18181B]">{text}</p>
    </div>
  );
}

export function ReportDeck({
  idea,
  data,
  isLatest,
  onAsk,
  onTestIdea,
  onBuildSprint,
  sprintBuilding,
  onOpenPlan,
  onOpenFull,
}: ReportDeckProps) {
  const { t } = useI18n();

  const cards = useMemo<Card[]>(() => {
    const out: Card[] = [];
    const score = data.idea_score;
    const call = data.decision?.call;

    out.push({
      id: "verdict",
      title: t.deckVerdict,
      body: (
        <div className="forge-rise flex h-full flex-col items-center justify-center text-center">
          <Ring value={score.overall} size={148} caption="/ 100" />
          <h3 className="mt-6 font-display text-[26px] leading-tight font-normal text-[#18181B]">
            {t.verdict(score.overall)}
          </h3>
          {call && (
            <p className="mt-3 text-[11px] font-medium tracking-[0.18em] text-[#C2410C] uppercase">
              {t.decisionCalls[call]}
            </p>
          )}
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#575752]">
            {brief(data.decision?.reason || score.rationale, 170)}
          </p>
          <p className="mt-4 text-[11px] text-[#9B9B94]">
            {t.confidence(t.confidenceWords[score.confidence] ?? score.confidence)}
          </p>
        </div>
      ),
    });

    if (typeof score.opportunity === "number" && typeof score.readiness === "number") {
      const gap = score.readiness_gaps?.[0];
      out.push({
        id: "split",
        title: t.deckSplit,
        body: (
          <div className="forge-rise flex h-full flex-col justify-center">
            <div className="grid grid-cols-2 divide-x divide-[#ECEBE6]">
              {(
                [
                  [score.opportunity, t.splitOpportunity, t.splitOpportunityHint],
                  [score.readiness, t.splitReadiness, t.splitReadinessHint],
                ] as const
              ).map(([value, name, hint]) => (
                <div key={name} className="flex flex-col items-center px-2 text-center">
                  <Ring value={value} size={104} />
                  <p className="mt-3 text-sm font-medium text-[#18181B]">{name}</p>
                  <p className="text-xs text-[#8A8A82]">{hint}</p>
                </div>
              ))}
            </div>
            {score.opportunity - score.readiness >= 20 && (
              <p className="mt-6 text-center text-sm leading-relaxed text-[#575752]">{t.splitGapNote}</p>
            )}
            {gap && (
              <div className="mt-6">
                <Note label={t.deckBiggestGap} text={brief(gap, 150)} />
              </div>
            )}
          </div>
        ),
      });
    }

    out.push({
      id: "idea",
      title: t.deckIdea,
      body: (
        <div className="forge-rise flex h-full flex-col justify-center gap-3">
          <Line label={t.deckProblem} text={brief(data.blueprint.problem, 110)} />
          <Line label={t.deckCustomer} text={brief(data.blueprint.target_user, 90)} />
          <Line label={t.deckSolution} text={brief(data.blueprint.solution, 110)} />
          <Line label={t.deckMoney} text={brief(data.blueprint.business_model, 100)} />
        </div>
      ),
    });

    out.push({
      id: "market",
      title: t.deckMarket,
      body: (
        <div className="forge-rise flex h-full flex-col justify-center gap-3">
          <Line label={`${t.deckMarketSize} · ${t.estimate}`} text={brief(data.business_plan.tam_estimate, 150)} />
          <Line label={`${t.deckPricing} · ${t.estimate}`} text={brief(data.business_plan.pricing_hypothesis, 110)} />
          <div className="border-t border-[#ECEBE6] pt-3">
            <Label>{t.deckCompetitors}</Label>
            {data.competitors.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {data.competitors.slice(0, 4).map((c) => (
                  <li key={c.name}>
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[15px] text-[#18181B] underline decoration-[#D6D5CF] underline-offset-4 hover:decoration-[#18181B]"
                    >
                      {c.name}
                      <ArrowUpRight className="h-3.5 w-3.5 text-[#8A8A82]" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-[#8A8A82]">{t.deckNoCompetitors}</p>
            )}
          </div>
        </div>
      ),
    });

    const risks = data.blueprint.key_risks.slice(0, 3).map((r) => brief(r, 95));
    const objection = data.skeptic?.counterargument;
    if (risks.length > 0 || objection) {
      out.push({
        id: "risks",
        title: t.deckRisks,
        body: (
          <div className="forge-rise flex h-full flex-col justify-center gap-6">
            {risks.length > 0 && <Bullets items={risks} />}
            {objection && <Note label={t.deckObjection} text={brief(objection, 170)} accent />}
          </div>
        ),
      });
    }

    const sk = data.skeptic;
    if (sk && sk.checked > 0) {
      const claims = (sk.claims ?? []).slice(0, 3);
      const pct = Math.round((sk.supported / sk.checked) * 100);
      out.push({
        id: "evidence",
        title: t.deckEvidence,
        body: (
          <div className="forge-rise flex h-full flex-col justify-center gap-5">
            <div>
              <p className="font-display text-5xl leading-none font-normal text-[#18181B] tabular-nums">
                {pct}
                <span className="text-2xl text-[#8A8A82]">%</span>
              </p>
              <p className="mt-2 text-sm text-[#575752]">{t.deckBacked(sk.supported, sk.checked)}</p>
              <div className="mt-3 h-px bg-[#ECEBE6]">
                <div className="h-px bg-[#18181B]" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {claims.length > 0 && (
              <ul className="space-y-2.5">
                {claims.map((c, i) => {
                  const [mark, tone] =
                    c.verdict === "supported"
                      ? ["✓", "text-[#18181B]"]
                      : c.verdict === "labelled_estimate"
                        ? ["~", "text-[#9B9B94]"]
                        : ["✕", "text-[#C2410C]"];
                  return (
                    <li key={i} className="flex gap-3 text-sm leading-snug text-[#3F3F46]">
                      <span className={`w-3 shrink-0 font-medium ${tone}`}>{mark}</span>
                      <span className="min-w-0">
                        {brief(c.claim, 100)}
                        {c.source_url && (
                          <a
                            href={c.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 text-[#18181B] underline decoration-[#D6D5CF] underline-offset-2"
                          >
                            {t.evidenceSource}
                          </a>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ),
      });
    }

    if (data.regulation && data.regulation.length > 0) {
      const shown = data.regulation.slice(0, 3);
      out.push({
        id: "rules",
        title: t.deckRules,
        body: (
          <div className="forge-rise flex h-full flex-col justify-center gap-4">
            {shown.map((r, i) => (
              <div key={i} className="border-l-2 border-[#C2410C] pl-4">
                <p className="text-[15px] font-medium text-[#18181B]">{r.area}</p>
                {r.check_with && (
                  <p className="mt-0.5 text-xs leading-relaxed text-[#6B6B65]">
                    {t.regulationCheckWith}: {brief(r.check_with, 80)}
                  </p>
                )}
              </div>
            ))}
            {data.regulation.length > shown.length && (
              <p className="text-xs text-[#8A8A82]">{t.deckMoreRules(data.regulation.length - shown.length)}</p>
            )}
          </div>
        ),
      });
    }

    const pivots = call && call !== "go" ? (data.decision?.pivots ?? []).slice(0, 3) : [];
    if (pivots.length > 0) {
      out.push({
        id: "moves",
        title: t.deckMoves,
        body: (
          <div className="forge-rise flex h-full flex-col justify-center divide-y divide-[#ECEBE6]">
            {pivots.map((p, i) => (
              <div key={i} className="py-3.5 first:pt-0 last:pb-0">
                <p className="text-[15px] leading-snug text-[#27272A]">{brief(p, 140)}</p>
                <button
                  type="button"
                  onClick={() => onTestIdea(p)}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-[#18181B] underline decoration-[#D6D5CF] underline-offset-4 hover:decoration-[#18181B]"
                >
                  {t.testThisIdea}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ),
      });
    } else if (data.blueprint.validate_next.length > 0) {
      out.push({
        id: "tests",
        title: t.deckTests,
        body: (
          <div className="forge-rise flex h-full flex-col justify-center">
            <Bullets items={data.blueprint.validate_next.slice(0, 3).map((v) => brief(v, 110))} />
          </div>
        ),
      });
    }

    const totals = idea.sprint ? sprintTotals(idea.sprint) : null;
    const primary =
      "inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-full bg-[#18181B] px-6 text-sm font-medium text-white transition-colors hover:bg-[#3F3F46] disabled:opacity-60";
    out.push({
      id: "next",
      title: t.deckNextMove,
      body: (
        <div className="forge-rise flex h-full flex-col justify-center gap-4">
          <p className="font-display text-[28px] leading-[1.15] font-normal text-[#18181B]">{t.deckNextLead}</p>
          {totals && (
            <div>
              <p className="text-sm text-[#575752]">{t.deckSprintProgress(totals.done, totals.total)}</p>
              <div className="mt-2 h-px bg-[#ECEBE6]">
                <div
                  className="h-px bg-[#18181B]"
                  style={{ width: `${totals.total ? (totals.done / totals.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
          {isLatest && !idea.sprint ? (
            <button
              type="button"
              disabled={sprintBuilding}
              onClick={() => {
                onBuildSprint();
                onOpenPlan();
              }}
              className={`mt-2 ${primary}`}
            >
              {t.deckBuildSprint}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={onOpenPlan} className={`mt-2 ${primary}`}>
              {t.deckOpenPlan}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenFull}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center text-sm font-medium text-[#3F3F46] underline decoration-[#D6D5CF] underline-offset-4 hover:text-[#18181B] hover:decoration-[#18181B]"
          >
            {t.deckSeeFull}
          </button>
        </div>
      ),
    });
    return out;
  }, [data, idea, isLatest, sprintBuilding, t, onBuildSprint, onOpenPlan, onOpenFull, onTestIdea]);

  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [entering, setEntering] = useState(false);
  const start = useRef<{ x: number; y: number; time: number; horizontal: boolean | null } | null>(null);
  const busy = useRef(false);

  // A new report starts at the first card.
  useEffect(() => {
    setIndex(0);
  }, [data]);

  useEffect(() => {
    const card = cards[index];
    if (card) track("deck_card", { card: card.id, index });
  }, [index, cards]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (busy.current) return;
      const target = index + dir;
      if (target < 0 || target >= cards.length) {
        setDx(0);
        return;
      }
      busy.current = true;
      if (dir === 1) {
        setLeaving(dx > 0 ? "right" : "left");
        window.setTimeout(() => {
          setIndex(target);
          setLeaving(null);
          setDx(0);
          busy.current = false;
        }, LEAVE_MS);
      } else {
        // The previous card slides back in from the left.
        setEntering(true);
        setIndex(target);
        setDx(0);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setEntering(false);
            window.setTimeout(() => (busy.current = false), LEAVE_MS);
          }),
        );
      }
    },
    [index, cards.length, dx],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    start.current = { x: e.clientX, y: e.clientY, time: Date.now(), horizontal: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (s.horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      s.horizontal = Math.abs(mx) > Math.abs(my);
      if (s.horizontal) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (s.horizontal) setDx(mx);
  };
  const onPointerUp = () => {
    const s = start.current;
    start.current = null;
    if (!s || !s.horizontal) return;
    setDragging(false);
    const speed = Math.abs(dx) / Math.max(1, Date.now() - s.time);
    if (dx <= -SWIPE_DISTANCE || (dx < -20 && speed > SWIPE_SPEED)) go(1);
    else if (dx >= SWIPE_DISTANCE || (dx > 20 && speed > SWIPE_SPEED)) go(-1);
    else setDx(0);
  };

  const card = cards[index];
  const progress = Math.min(Math.abs(dx) / 220, 1);

  const topTransform = leaving
    ? `translateX(${leaving === "left" ? "-120%" : "120%"}) rotate(${leaving === "left" ? -8 : 8}deg)`
    : entering
      ? "translateX(-110%) rotate(-5deg)"
      : `translateX(${dx}px) rotate(${dx / 40}deg)`;

  return (
    <section aria-roledescription="carousel" aria-label={idea.title} className="relative">
      {/* Progress */}
      <div className="flex items-center gap-4 px-1">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {cards.map((c, i) => (
            <button
              key={c.id}
              type="button"
              tabIndex={-1}
              onClick={() => !busy.current && setIndex(i)}
              className="h-6 flex-1 cursor-pointer"
            >
              <span
                className={`block h-[2px] w-full transition-colors duration-300 ${
                  i <= index ? "bg-[#18181B]" : "bg-[#DFDED8]"
                }`}
              />
            </button>
          ))}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-[#8A8A82] tabular-nums">
          {pad(index + 1)} / {pad(cards.length)}
        </span>
      </div>

      {/* The stack */}
      <div className="relative mt-3 h-[min(560px,68dvh)] min-h-[440px]">
        {[2, 1].map((k) => {
          const behind = cards[index + k];
          if (!behind) return null;
          const lift = k === 1 ? progress : 0;
          return (
            <div
              key={behind.id}
              aria-hidden="true"
              className="absolute inset-0 rounded-[22px] border border-[#E5E4DF] bg-white"
              style={{
                transform: `translateY(${10 * k - 10 * lift}px) scale(${1 - 0.035 * k + 0.035 * lift})`,
                opacity: 1 - 0.35 * k + 0.35 * lift,
                transition: dragging ? "none" : "transform 0.35s ease, opacity 0.35s ease",
              }}
            />
          );
        })}

        {card && (
          <article
            key={card.id}
            aria-live="polite"
            aria-label={`${t.deckOf(index + 1, cards.length)}: ${card.title}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="absolute inset-0 flex cursor-grab touch-pan-y flex-col overflow-hidden rounded-[22px] border border-[#E5E4DF] bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_30px_60px_-30px_rgba(24,24,27,0.22)] select-none active:cursor-grabbing"
            style={{
              transform: topTransform,
              opacity: leaving ? 0 : 1,
              transition: dragging
                ? "none"
                : `transform ${LEAVE_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${LEAVE_MS}ms ease`,
            }}
          >
            <header className="flex items-baseline justify-between gap-3 border-b border-[#F0EFEA] px-7 pt-6 pb-4">
              <h2 className="font-display text-[21px] font-normal tracking-tight text-[#18181B]">{card.title}</h2>
              <span className="shrink-0 font-mono text-[11px] text-[#9B9B94] tabular-nums">{pad(index + 1)}</span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">{card.body}</div>

            {onAsk && (
              <footer className="border-t border-[#F0EFEA] px-7 py-4">
                <button
                  type="button"
                  onClick={() => {
                    track("deck_ask", { card: card.id });
                    onAsk(t.deckAskQuestion(card.title));
                  }}
                  className="group inline-flex w-full cursor-pointer items-center justify-between text-sm font-medium text-[#18181B]"
                >
                  <span className="inline-flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-[#C2410C]" />
                    {t.deckAsk}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#8A8A82] transition-transform group-hover:translate-x-0.5 group-hover:text-[#18181B]" />
                </button>
              </footer>
            )}
          </article>
        )}
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label={t.deckPrev}
          className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[#DFDED8] bg-white text-[#18181B] transition-colors hover:border-[#18181B] disabled:cursor-default disabled:opacity-35 disabled:hover:border-[#DFDED8]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-center text-xs text-[#8A8A82]">{t.deckHint}</p>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === cards.length - 1}
          aria-label={t.deckNext}
          className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-[#18181B] text-white transition-colors hover:bg-[#3F3F46] disabled:cursor-default disabled:bg-[#DFDED8]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
