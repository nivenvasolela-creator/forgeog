import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Entrance, Sfx, WordReveal, clamp, useBeat } from "../components";
import { theme } from "../theme";

/** Spark mark: staggered rays in the hero color. */
const Spark: React.FC<{ size: number; delay: number }> = ({ size, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rays = 10;
  const s = spring({ frame: frame - delay, fps, config: theme.spring.bouncy });
  const rot = interpolate(spring({ frame: frame - delay, fps, config: theme.spring.smooth }), [0, 1], [-120, 0]) + frame * 0.15;
  return (
    <div style={{ position: "relative", width: size, height: size, transform: `scale(${s}) rotate(${rot}deg)`, filter: `drop-shadow(0 0 ${size * 0.2}px ${theme.colors.glow})` }}>
      {Array.from({ length: rays }).map((_, i) => {
        const p = spring({ frame: frame - delay - i * 1.2, fps, config: theme.spring.snappy });
        return <div key={i} style={{ position: "absolute", left: "50%", top: "50%", width: size * 0.09, height: size * 0.42 * p, background: theme.colors.primary,
          borderRadius: size, transformOrigin: "50% 0%", transform: `translateX(-50%) rotate(${(360 / rays) * i}deg) translateY(${size * 0.08}px)` }} />;
      })}
    </div>
  );
};

export const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const b = useBeat();
  const wordAt = 8;
  const tagAt = Math.round(b * 2);
  const breathe = 1 + Math.sin(frame / 24) * 0.012;
  const fadeLen = Math.round(fps / 2);
  const out = interpolate(frame, [durationInFrames - fadeLen, durationInFrames], [1, 0], { ...clamp, easing: theme.ease.in });

  return (
    <AbsoluteFill style={{ opacity: out }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44, transform: `scale(${breathe})` }}>
          <Spark size={190} delay={2} />
          <div style={{ display: "flex" }}>
            {"FORGE".split("").map((ch, i) => {
              const p = spring({ frame: frame - wordAt - i * 3, fps, config: theme.spring.bouncy });
              return <span key={i} style={{ display: "inline-block", fontFamily: theme.fonts.display, fontWeight: 800, fontSize: 230, letterSpacing: "-0.04em", lineHeight: 1,
                color: theme.colors.ink, opacity: p, transform: `translateY(${interpolate(p, [0, 1], [60, 0])}px) scale(${interpolate(p, [0, 1], [0.8, 1])})` }}>{ch}</span>;
            })}
          </div>
        </div>
        <WordReveal text="Test an idea. Get a clear call. Start this week." delay={tagAt} per={3} gap={16}
          style={{ fontFamily: theme.fonts.body, fontWeight: 600, fontSize: 54, letterSpacing: "-0.01em", color: theme.colors.ink }} />
        <Entrance delay={tagAt + 30} rise={16}>
          <div style={{ fontFamily: theme.fonts.mono, fontWeight: 500, fontSize: 26, letterSpacing: "0.12em", color: theme.colors.dim, textTransform: "uppercase" }}>
            The founder operating system · English & Kiswahili
          </div>
        </Entrance>
      </AbsoluteFill>
      <Sfx at={2} src="hit" volume={0.7} />
      <Sfx at={wordAt} src="shimmer" volume={0.5} />
      <Sfx at={tagAt} src="whoosh" volume={0.3} />
    </AbsoluteFill>
  );
};
