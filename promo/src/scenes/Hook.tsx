import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneExit, Sfx, WordReveal, clamp, useBeat } from "../components";
import { theme } from "../theme";

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = useBeat();
  const line2 = Math.round(b * 2.5);
  const wordAt = line2 + 3 * 4;
  const word = spring({ frame: frame - wordAt, fps, config: theme.spring.bouncy });
  const pillAt = wordAt + 5; // pill lands 5 frames after the word
  const pill = spring({ frame: frame - pillAt, fps, config: theme.spring.snappy });
  const line1Dim = interpolate(frame, [line2 - 4, line2 + 8], [1, 0.35], { ...clamp, easing: theme.ease.out });
  const breathe = 1 + Math.sin(frame / 22) * 0.008;
  const big: React.CSSProperties = { fontFamily: theme.fonts.display, fontWeight: 800, fontSize: 150, letterSpacing: "-0.04em", lineHeight: 1.05, color: theme.colors.ink };

  return (
    <SceneExit>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 36, transform: `scale(${breathe})` }}>
        <div style={{ opacity: line1Dim }}>
          <WordReveal text="You don't need more encouragement." delay={3} per={3} gap={24}
            style={{ fontFamily: theme.fonts.display, fontWeight: 700, fontSize: 92, letterSpacing: "-0.03em", lineHeight: 1.05, color: theme.colors.ink }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <WordReveal text="You need a" delay={line2} per={4} gap={34} style={big} />
          <span style={{ position: "relative", display: "inline-block", padding: "0 30px 14px", opacity: word,
            transform: `translateY(${interpolate(word, [0, 1], [40, 0])}px) scale(${interpolate(word, [0, 1], [0.85, 1])})` }}>
            <span style={{ position: "absolute", inset: "8px 0 0 0", borderRadius: 30, background: theme.colors.primary, boxShadow: `0 0 60px ${theme.colors.glow}, 0 0 120px ${theme.colors.glow}`,
              transformOrigin: "left center", transform: `scaleX(${pill})` }} />
            <span style={{ ...big, position: "relative", color: pill > 0.5 ? theme.colors.surface : theme.colors.ink }}>verdict.</span>
          </span>
        </div>
      </AbsoluteFill>
      <Sfx at={3} src="whoosh" volume={0.35} />
      <Sfx at={line2} src="whoosh" volume={0.45} />
      <Sfx at={pillAt} src="hit" volume={0.7} />
    </SceneExit>
  );
};
