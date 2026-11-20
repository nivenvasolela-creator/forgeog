// The report as a deck of liquid-glass cards: one idea per card, in brief,
// swiped like a dating app (or arrows / keyboard). Every card can hand the
// founder to Ask FORGE for the detail, so the cards stay short.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, Sparkles } from "lucide-react";
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
  /** Glow colour behind the card. */
  glow: string;
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
const LEAVE_MS = 240;

const CALL_STYLE: Record<string, string> = {
  go: "border-emerald-300/40 bg-emerald-400/15 text-emerald-200",
  pivot: "border-amber-300/40 bg-amber-400/15 text-amber-200",
  kill: "border-rose-300/40 bg-rose-400/15 text-rose-200",
};

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-[0.14em] text-white/45 uppercase">{children}</p>;
}

function Ring({ value, size = 132, label }: { value: number; size?: number; label?: string }) {
  const id = useId();
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="55%" stopColor="#FB923C" />
            <stop offset="100%" stopColor="#F43F5E" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id}-g)`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-display font-bold tracking-tight text-white tabular-nums"
          style={{ fontSize: size * 0.3 }}
        >
          {value}
        </span>
        {label && <span className="text-[10px] tracking-wider text-white/50 uppercase">{label}</span>}
      </div>
    </div>
  );
}

function Row({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <Label>{label}</Label>
      <p className="mt-1 text-[15px] leading-snug text-white/90">{text}</p>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-snug text-white/85">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-amber-200 to-orange-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
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
      glow: "#F97316",
      body: (
        <div className="forge-rise flex h-full flex-col items-center justify-center text-center">
          <Ring value={score.overall} size={150} label="/ 100" />
          <h3 className="mt-5 font-display text-2xl leading-tight font-semibold text-white">{t.verdict(score.overall)}</h3>
          {call && (
            <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${CALL_STYLE[call] ?? ""}`}>
              {t.decisionCalls[call]}
            </span>
          )}
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/75">
            {brief(data.decision?.reason || score.rationale, 170)}
          </p>
          <p className="mt-3 text-[11px] text-white/40">
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
        glow: "#8B5CF6",
        body: (
          <div className="forge-rise flex h-full flex-col justify-center">
            <div className="flex items-center justify-around gap-2">
              <div className="flex flex-col items-center text-center">
                <Ring value={score.opportunity} size={112} />
                <p className="mt-2 text-sm font-semibold text-white">{t.splitOpportunity}</p>
                <p className="text-[11px] text-white/50">{t.splitOpportunityHint}</p>
              </div>
              <div className="flex flex-col items-center text-center">
                <Ring value={score.readiness} size={112} />
                <p className="mt-2 text-sm font-semibold text-white">{t.splitReadiness}</p>
                <p className="text-[11px] text-white/50">{t.splitReadinessHint}</p>
              </div>
            </div>
            {score.opportunity - score.readiness >= 20 && (
              <p className="mt-5 text-center text-sm text-white/70">{t.splitGapNote}</p>
            )}
            {gap && (
              <div className="mt-5 rounded-2xl border border-violet-300/20 bg-violet-400/10 px-4 py-3">
                <Label>{t.deckBiggestGap}</Label>
                <p className="mt-1 text-[15px] leading-snug text-white/90">{brief(gap, 150)}</p>
              </div>
            )}
          </div>
        ),
      });
    }

    out.push({
      id: "idea",
      title: t.deckIdea,
      glow: "#0EA5E9",
      body: (
        <div className="forge-rise flex h-full flex-col justify-center gap-2.5">
          <Row label={t.deckProblem} text={brief(data.blueprint.problem, 110)} />
          <Row label={t.deckCustomer} text={brief(data.blueprint.target_user, 90)} />
          <Row label={t.deckSolution} text={brief(data.blueprint.solution, 110)} />
          <Row label={t.deckMoney} text={brief(data.blueprint.business_model, 100)} />
        </div>
      ),
    });

    out.push({
      id: "market",
      title: t.deckMarket,
      glow: "#10B981",
      body: (
        <div className="forge-rise flex h-full flex-col justify-center gap-3">
          <Row label={`${t.deckMarketSize} · ${t.estimate}`} text={brief(data.business_plan.tam_estimate, 150)} />
          <Row label={`${t.deckPricing} · ${t.estimate}`} text={brief(data.business_plan.pricing_hypothesis, 110)} />
          <div className="px-1">
            <Label>{t.deckCompetitors}</Label>
            {data.competitors.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {data.competitors.slice(0, 4).map((c) => (
                  <a
                    key={c.name}
                    href={c.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm text-white/90 hover:bg-white/[0.12]"
                  >
                    {c.name}
                    <ExternalLink className="h-3 w-3 text-white/50" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-white/60">{t.deckNoCompetitors}</p>
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
        glow: "#F43F5E",
        body: (
          <div className="forge-rise flex h-full flex-col justify-center gap-4">
            {risks.length > 0 && <Bullets items={risks} />}
            {objection && (
              <div className="rounded-2xl border border-rose-300/25 bg-rose-500/10 px-4 py-3">
                <Label>{t.deckObjection}</Label>
                <p className="mt-1 text-[15px] leading-snug text-white/90">{brief(objection, 170)}</p>
              </div>
            )}
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
        glow: "#22C55E",
        body: (
          <div className="forge-rise flex h-full flex-col justify-center gap-4">
            <div>
              <p className="font-display text-4xl font-bold text-white tabular-nums">{pct}%</p>
              <p className="text-sm text-white/65">{t.deckBacked(sk.supported, sk.checked)}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-teal-400" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {claims.length > 0 && (
              <ul className="space-y-2">
                {claims.map((c, i) => {
                  const [mark, tone] =
                    c.verdict === "supported"
                      ? ["✓", "text-emerald-300"]
                      : c.verdict === "labelled_estimate"
                        ? ["~", "text-white/50"]
                        : ["✗", "text-rose-300"];
                  return (
                    <li key={i} className="flex gap-3 text-sm leading-snug text-white/85">
                      <span className={`w-4 shrink-0 font-bold ${tone}`}>{mark}</span>
                      <span className="min-w-0">
                        {brief(c.claim, 100)}
                        {c.source_url && (
                          <a href={c.source_url} target="_blank" rel="noreferrer" className="ml-1 text-amber-200 underline underline-offset-2">
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
        glow: "#EAB308",
        body: (
          <div className="forge-rise flex h-full flex-col justify-center gap-2.5">
            {shown.map((r, i) => (
              <div key={i} className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3">
                <p className="text-[15px] font-semibold text-white">{r.area}</p>
                {r.check_with && <p className="mt-0.5 text-xs text-amber-100/70">{t.regulationCheckWith}: {brief(r.check_with, 80)}</p>}
              </div>
            ))}
            {data.regulation.length > shown.length && (
              <p className="text-xs text-white/50">{t.deckMoreRules(data.regulation.length - shown.length)}</p>
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
        glow: "#F59E0B",
        body: (
          <div className="forge-rise flex h-full flex-col justify-center gap-2.5">
            {pivots.map((p, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[15px] leading-snug text-white/90">{brief(p, 140)}</p>
                <button
                  type="button"
                  onClick={() => onTestIdea(p)}
                  className="mt-2.5 inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-[#0A0A0F] hover:bg-amber-100"
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
        glow: "#F59E0B",
        body: (
          <div className="forge-rise flex h-full flex-col justify-center">
            <Bullets items={data.blueprint.validate_next.slice(0, 3).map((v) => brief(v, 110))} />
          </div>
        ),
      });
    }

    const totals = idea.sprint ? sprintTotals(idea.sprint) : null;
    out.push({
      id: "next",
      title: t.deckNextMove,
      glow: "#F97316",
      body: (
        <div className="forge-rise flex h-full flex-col justify-center gap-3">
          <p className="font-display text-2xl leading-tight font-semibold text-white">{t.deckNextLead}</p>
          {totals && (
            <div>
              <p className="text-sm text-white/70">{t.deckSprintProgress(totals.done, totals.total)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-200 to-orange-500"
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
              className="mt-2 inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 px-5 text-sm font-bold text-[#0A0A0F] shadow-[0_10px_30px_-8px_rgba(251,146,60,0.7)] hover:brightness-105 disabled:opacity-60"
            >
              {t.deckBuildSprint}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenPlan}
              className="mt-2 inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 px-5 text-sm font-bold text-[#0A0A0F] shadow-[0_10px_30px_-8px_rgba(251,146,60,0.7)] hover:brightness-105"
            >
              {t.deckOpenPlan}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenFull}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-2xl border border-white/15 bg-white/[0.05] px-5 text-sm font-medium text-white/85 hover:bg-white/[0.1]"
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
    ? `translateX(${leaving === "left" ? "-130%" : "130%"}) rotate(${leaving === "left" ? -16 : 16}deg)`
    : entering
      ? "translateX(-115%) rotate(-10deg)"
      : `translateX(${dx}px) rotate(${dx / 22}deg)`;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={idea.title}
      className="relative isolate overflow-hidden rounded-[32px] bg-[#09090D] px-3 pt-4 pb-5 shadow-[0_40px_120px_-40px_rgba(15,10,30,0.9)] sm:px-6 sm:pt-6"
    >
      {/* Liquid background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="forge-blob absolute -top-24 -left-20 h-80 w-80 rounded-full bg-[#F97316] opacity-40 blur-[90px]" />
        <div className="forge-blob forge-blob-slow absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-[#7C3AED] opacity-35 blur-[100px]" />
        <div className="forge-blob absolute -bottom-28 left-1/4 h-80 w-80 rounded-full bg-[#0EA5E9] opacity-25 blur-[90px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_60%)]" />
      </div>

      {/* Story-style progress */}
      <div className="flex gap-1.5 px-2" aria-hidden="true">
        {cards.map((c, i) => (
          <button
            key={c.id}
            type="button"
            tabIndex={-1}
            onClick={() => !busy.current && setIndex(i)}
            className="h-1 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/15"
          >
            <span
              className="block h-full rounded-full bg-gradient-to-r from-amber-200 to-orange-400 transition-all duration-500"
              style={{ width: i < index ? "100%" : i === index ? "100%" : "0%", opacity: i === index ? 1 : 0.55 }}
            />
          </button>
        ))}
      </div>

      {/* The stack */}
      <div className="relative mt-4 h-[min(560px,68dvh)] min-h-[440px]">
        {[2, 1].map((k) => {
          const behind = cards[index + k];
          if (!behind) return null;
          const lift = k === 1 ? progress : 0;
          const scale = 1 - 0.05 * k + 0.05 * lift;
          const y = 16 * k - 16 * lift;
          return (
            <div
              key={behind.id}
              aria-hidden="true"
              className="absolute inset-0 rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-xl"
              style={{
                transform: `translateY(${y}px) scale(${scale})`,
                opacity: 1 - 0.3 * k + 0.3 * lift,
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
            className="forge-sheen absolute inset-0 flex cursor-grab touch-pan-y flex-col overflow-hidden rounded-[28px] border border-white/20 bg-white/[0.08] shadow-[0_30px_80px_-25px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-2xl select-none active:cursor-grabbing"
            style={{
              transform: topTransform,
              opacity: leaving ? 0 : 1,
              transition: dragging
                ? "none"
                : `transform ${LEAVE_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${LEAVE_MS}ms ease`,
            }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-28 -right-24 h-64 w-64 rounded-full opacity-40 blur-3xl"
              style={{ background: card.glow }}
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />

            <header className="relative flex items-center justify-between gap-3 px-6 pt-5">
              <h2 className="font-display text-lg font-semibold tracking-tight text-white">{card.title}</h2>
              <span className="shrink-0 font-mono text-xs text-white/45 tabular-nums">{t.deckOf(index + 1, cards.length)}</span>
            </header>

            <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4">{card.body}</div>

            {onAsk && (
              <footer className="relative px-6 pb-5">
                <button
                  type="button"
                  onClick={() => {
                    track("deck_ask", { card: card.id });
                    onAsk(t.deckAskQuestion(card.title));
                  }}
                  className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/[0.08] text-sm font-semibold text-white backdrop-blur-xl transition-colors hover:bg-white/[0.16]"
                >
                  <Sparkles className="h-4 w-4 text-amber-200" />
                  {t.deckAsk}
                </button>
              </footer>
            )}
          </article>
        )}
      </div>

      {/* Controls */}
      <div className="mt-5 flex items-center justify-between gap-3 px-1">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label={t.deckPrev}
          className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white backdrop-blur-xl transition hover:bg-white/[0.14] disabled:cursor-default disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-center text-xs text-white/45">{t.deckHint}</p>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === cards.length - 1}
          aria-label={t.deckNext}
          className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white text-[#09090D] shadow-[0_8px_24px_-6px_rgba(255,255,255,0.35)] transition hover:bg-amber-50 disabled:cursor-default disabled:bg-white/[0.06] disabled:text-white disabled:opacity-30 disabled:shadow-none"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}
