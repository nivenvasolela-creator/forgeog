import React from "react";
import { AbsoluteFill, spring, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Entrance, SceneExit, Sfx, useBeat } from "../components";
import { theme } from "../theme";

// Lines adapted from the app's own Kiswahili tagline (src/lib/i18n.tsx).
const LINES = [["Pima wazo.", "Test the idea."], ["Pata uamuzi.", "Get a decision."], ["Anza kutekeleza.", "Start executing."]];

export const Swahili: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = useBeat();
  const per = Math.round(b * 0.8);
  return (
    <SceneExit>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 44 }}>
        <Entrance delay={2} rise={20}>
          <div style={{ fontFamily: theme.fonts.mono, fontWeight: 500, fontSize: 26, letterSpacing: "0.14em", color: theme.colors.dim, textTransform: "uppercase" }}>
            In English or Kiswahili
          </div>
        </Entrance>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }}>
          {LINES.map(([sw, en], i) => {
            const p = spring({ frame: frame - 8 - i * per, fps, config: theme.spring.snappy });
            const float = Math.sin((frame + i * 20) / 26) * 3;
            return (
              <div key={sw} style={{ display: "flex", alignItems: "baseline", gap: 36, whiteSpace: "nowrap", opacity: p, transform: `translateY(${interpolate(p, [0, 1], [50, 0]) + float}px) scale(${interpolate(p, [0, 1], [0.9, 1])})` }}>
                <div style={{ fontFamily: theme.fonts.display, fontWeight: 800, fontSize: 120, letterSpacing: "-0.035em", lineHeight: 1.05, color: theme.colors.ink }}>{sw}</div>
                <div style={{ fontFamily: theme.fonts.body, fontWeight: 500, fontSize: 36, color: theme.colors.faint }}>{en}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {LINES.map((_, i) => <Sfx key={i} at={8 + i * per} src="whoosh" volume={0.35} />)}
    </SceneExit>
  );
};
