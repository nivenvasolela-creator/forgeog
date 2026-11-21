import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Card, Entrance, SceneExit, SectionLabel, Sfx, useBeat } from "../components";
import { theme } from "../theme";

const SCORE = 58;
const BARS: [string, number][] = [
  ["Problem pain", 74],
  ["Demand evidence", 52],
  ["Competition", 41],
  ["Founder fit", 68],
  ["Economics", 47],
];
const CHIPS = ["SWOT", "Competitors with sources", "Blueprint", "Business plan", "What we couldn't verify"];

export const Score: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = useBeat();
  const countAt = Math.round(b * 1);
  const c = spring({ frame: frame - countAt, fps, config: theme.spring.count });
  const value = Math.round(interpolate(c, [0, 1], [0, SCORE]));
  const R = 190, C = 2 * Math.PI * R;
  const barsAt = Math.round(b * 2);
  const chipsAt = Math.round(b * 5.5);
  const breathe = 1 + Math.sin(frame / 22) * 0.01;

  return (
    <SceneExit>
      <SectionLabel n="02" text="The honest report" />
      <AbsoluteFill style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 90, paddingBottom: 110 }}>
        <Entrance delay={3}>
          <div style={{ position: "relative", width: 460, height: 460, transform: `scale(${breathe})` }}>
            <svg width={460} height={460} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
              <circle cx={230} cy={230} r={R} stroke={theme.colors.border} strokeWidth={26} fill="none" />
              <circle cx={230} cy={230} r={R} stroke={theme.colors.primary} strokeWidth={26} fill="none" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - (c * SCORE) / 100)} style={{ filter: `drop-shadow(0 0 18px ${theme.colors.glow})` }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: theme.fonts.display, fontWeight: 800, fontSize: 170, letterSpacing: "-0.04em", lineHeight: 1, color: theme.colors.ink, fontVariantNumeric: "tabular-nums" }}>{value}</div>
              <div style={{ fontFamily: theme.fonts.mono, fontWeight: 500, fontSize: 28, color: theme.colors.dim, marginTop: 4 }}>/ 100</div>
            </div>
          </div>
        </Entrance>
        <Entrance delay={6}>
          <Card style={{ width: 760, padding: "44px 52px" }}>
            {BARS.map(([label, v], i) => {
              const p = spring({ frame: frame - barsAt - i * 5, fps, config: theme.spring.smooth });
              return (
                <div key={label} style={{ marginTop: i === 0 ? 0 : 26, opacity: p, transform: `translateX(${interpolate(p, [0, 1], [30, 0])}px)` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: theme.fonts.body, fontWeight: 500, fontSize: 28, color: theme.colors.inkSoft }}>
                    <span>{label}</span>
                    <span style={{ fontFamily: theme.fonts.mono, color: theme.colors.ink, fontVariantNumeric: "tabular-nums" }}>{Math.round(v * p)}</span>
                  </div>
                  <div style={{ marginTop: 10, height: 14, borderRadius: 7, background: theme.colors.bg, border: `1px solid ${theme.colors.border}` }}>
                    <div style={{ height: "100%", width: `${v * p}%`, borderRadius: 7, background: theme.colors.ink }} />
                  </div>
                </div>
              );
            })}
          </Card>
        </Entrance>
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 150, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
        {CHIPS.map((chip, i) => (
          <Entrance key={chip} delay={chipsAt + i * 4} rise={24}>
            <div style={{ fontFamily: theme.fonts.body, fontWeight: 500, fontSize: 24, color: theme.colors.inkSoft, background: theme.colors.surface,
              border: `1.5px solid ${theme.colors.border}`, borderRadius: 999, padding: "12px 24px" }}>{chip}</div>
          </Entrance>
        ))}
      </div>
      <div style={{ position: "absolute", bottom: 82, left: 0, right: 0, textAlign: "center" }}>
        <Entrance delay={chipsAt + 24} rise={16}>
          <div style={{ fontFamily: theme.fonts.mono, fontWeight: 500, fontSize: 20, color: theme.colors.faint }}>
            Example report · competitors are kept only if they link to a page the search returned
          </div>
        </Entrance>
      </div>
      <Sfx at={3} src="whoosh" volume={0.35} />
      {Array.from({ length: 10 }, (_, i) => <Sfx key={i} at={countAt + i * 3} src="tick" volume={0.25} lead={0} />)}
      {BARS.map((_, i) => <Sfx key={`b${i}`} at={barsAt + i * 5} src="tick" volume={0.2} lead={0} />)}
      {CHIPS.map((_, i) => <Sfx key={`c${i}`} at={chipsAt + i * 4} src="pop" volume={0.18} />)}
    </SceneExit>
  );
};
