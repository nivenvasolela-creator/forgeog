import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Entrance, SceneExit, SectionLabel, Sfx, WordReveal, clamp, useBeat } from "../components";
import { theme } from "../theme";

const CALLS = [
  { key: "go", title: "Go", sub: "Start executing", glyph: "✓" },
  { key: "pivot", title: "Pivot", sub: "Change the angle", glyph: "↻" },
  { key: "kill", title: "Kill", sub: "Move on", glyph: "✕" },
] as const;

export const Decision: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = useBeat();
  const cardsAt = Math.round(b * 1.4);
  const pickAt = Math.round(b * 4);
  const pick = spring({ frame: frame - pickAt, fps, config: theme.spring.bouncy });
  const dim = interpolate(frame, [pickAt, pickAt + 10], [1, 0.32], { ...clamp, easing: theme.ease.out });
  const subAt = pickAt + 12;
  const float = Math.sin(frame / 28) * 4;

  return (
    <SceneExit>
      <SectionLabel n="03" text="Decide" />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 70 }}>
        <WordReveal text="Every report ends in one call." delay={4} per={3} gap={22}
          style={{ fontFamily: theme.fonts.display, fontWeight: 700, fontSize: 96, letterSpacing: "-0.03em", color: theme.colors.ink }} />
        <div style={{ display: "flex", gap: 40 }}>
          {CALLS.map((call, i) => {
            const c = theme.colors[call.key];
            const chosen = call.key === "pivot";
            return (
              <Entrance key={call.key} delay={cardsAt + i * 5}>
                <div style={{ width: 420, padding: "44px 44px 40px", borderRadius: 30, background: c.bg, border: `2.5px solid ${c.border}`,
                  opacity: chosen ? 1 : dim, boxShadow: chosen ? theme.shadow : "none",
                  transform: chosen ? `scale(${1 + 0.07 * pick}) translateY(${-14 * pick + float * pick}px)` : `scale(${interpolate(dim, [0.32, 1], [0.96, 1])})` }}>
                  <div style={{ width: 72, height: 72, borderRadius: 36, border: `3px solid ${c.text}`, color: c.text, display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: theme.fonts.body, fontWeight: 600, fontSize: 38 }}>{call.glyph}</div>
                  <div style={{ marginTop: 26, fontFamily: theme.fonts.display, fontWeight: 800, fontSize: 84, letterSpacing: "-0.03em", lineHeight: 1, color: c.text }}>{call.title}</div>
                  <div style={{ marginTop: 12, fontFamily: theme.fonts.body, fontWeight: 500, fontSize: 30, color: theme.colors.inkSoft }}>{call.sub}</div>
                </div>
              </Entrance>
            );
          })}
        </div>
        <div style={{ height: 40 }}>
          <Entrance delay={subAt} rise={20}>
            <div style={{ fontFamily: theme.fonts.body, fontWeight: 500, fontSize: 32, color: theme.colors.dim }}>
              …plus sharper alternative ideas you can test in one click.
            </div>
          </Entrance>
        </div>
      </AbsoluteFill>
      <Sfx at={4} src="whoosh" volume={0.35} />
      {CALLS.map((_, i) => <Sfx key={i} at={cardsAt + i * 5} src="pop" volume={0.35} />)}
      <Sfx at={pickAt} src="hit" volume={0.65} />
    </SceneExit>
  );
};
