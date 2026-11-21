import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Card, Entrance, SceneExit, SectionLabel, Sfx, WordReveal, useBeat } from "../components";
import { theme } from "../theme";

const DAYS = ["Talk to 5 shop owners", "Price 10 test runs", "Sign 2 riders", "Run 3 deliveries", "Collect feedback", "Fix the top issue", "Decide: scale or stop"];
const DONE = 4;

export const Sprint: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = useBeat();
  const tilesAt = Math.round(b * 1.4);
  const tickAt = Math.round(b * 4);
  const tickEvery = Math.round(b * 0.6);
  const doneCount = (i: number) => spring({ frame: frame - tickAt - i * tickEvery, fps, config: theme.spring.bouncy });
  const progress = DAYS.reduce((s, _, i) => s + (i < DONE ? Math.min(1, doneCount(i)) : 0), 0);

  return (
    <SceneExit>
      <SectionLabel n="04" text="Execute" />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 64 }}>
        <WordReveal text="A 7-day launch sprint. Start today." delay={4} per={3} gap={22}
          style={{ fontFamily: theme.fonts.display, fontWeight: 700, fontSize: 92, letterSpacing: "-0.03em", color: theme.colors.ink }} />
        <div style={{ display: "flex", gap: 18 }}>
          {DAYS.map((task, i) => {
            const d = i < DONE ? doneCount(i) : 0;
            return (
              <Entrance key={task} delay={tilesAt + i * 4}>
                <Card style={{ width: 222, height: 250, padding: "26px 24px", borderRadius: 22, display: "flex", flexDirection: "column", justifyContent: "space-between",
                  background: d > 0.5 ? theme.colors.bg : theme.colors.surface }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: theme.fonts.mono, fontWeight: 500, fontSize: 20, letterSpacing: "0.1em", color: theme.colors.dim }}>DAY {i + 1}</span>
                    <span style={{ width: 40, height: 40, borderRadius: 12, border: `2.5px solid ${d > 0.05 ? theme.colors.ink : theme.colors.border}`,
                      background: d > 0.05 ? theme.colors.ink : "transparent", color: theme.colors.surface, display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: theme.fonts.body, fontWeight: 600, fontSize: 24 }}>
                      <span style={{ transform: `scale(${d})`, display: "inline-block" }}>✓</span>
                    </span>
                  </div>
                  <div style={{ fontFamily: theme.fonts.body, fontWeight: 500, fontSize: 27, lineHeight: 1.25, color: d > 0.5 ? theme.colors.faint : theme.colors.ink,
                    textDecoration: d > 0.5 ? "line-through" : "none" }}>{task}</div>
                </Card>
              </Entrance>
            );
          })}
        </div>
        <Entrance delay={tilesAt + 30} rise={20}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <div style={{ width: 900, height: 16, borderRadius: 8, background: theme.colors.surface, border: `1.5px solid ${theme.colors.border}`, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(progress / DAYS.length) * 100}%`, background: theme.colors.primary, borderRadius: 8, boxShadow: `0 0 24px ${theme.colors.glow}` }} />
            </div>
            <div style={{ fontFamily: theme.fonts.mono, fontWeight: 500, fontSize: 26, color: theme.colors.ink, fontVariantNumeric: "tabular-nums", width: 200 }}>
              {Math.round(progress)} / 7 done
            </div>
          </div>
        </Entrance>
      </AbsoluteFill>
      <Sfx at={4} src="whoosh" volume={0.35} />
      {DAYS.map((_, i) => <Sfx key={i} at={tilesAt + i * 4} src="tick" volume={0.22} lead={0} />)}
      {Array.from({ length: DONE }, (_, i) => <Sfx key={`d${i}`} at={tickAt + i * tickEvery} src="pop" volume={0.5} />)}
    </SceneExit>
  );
};
