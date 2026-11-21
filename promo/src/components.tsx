import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Frames per musical beat, derived from fps. */
export const useBeat = () => {
  const { fps } = useVideoConfig();
  return (fps * 60) / theme.bpm;
};

export const BgMesh: React.FC = () => {
  const frame = useCurrentFrame();
  const d1 = Math.sin(frame / 55) * 60;
  const d2 = Math.cos(frame / 70) * 50;
  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      <div style={{ position: "absolute", width: 1400, height: 1400, borderRadius: "50%", top: -700, right: -420 + d1, filter: "blur(60px)", background: `radial-gradient(circle, ${theme.colors.meshA}, transparent 62%)` }} />
      <div style={{ position: "absolute", width: 1100, height: 1100, borderRadius: "50%", bottom: -620, left: -300 - d2, filter: "blur(70px)", background: `radial-gradient(circle, ${theme.colors.meshB}, transparent 65%)` }} />
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${theme.colors.border} 1.4px, transparent 1.4px)`, backgroundSize: "36px 36px", opacity: 0.55, transform: `translateY(${-(frame * 0.25) % 36}px)` }} />
    </AbsoluteFill>
  );
};

export const Grade: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ backgroundColor: theme.colors.primary, mixBlendMode: "soft-light", opacity: 0.1 }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.04), transparent 25%, transparent 75%, rgba(0,0,0,0.07))" }} />
  </AbsoluteFill>
);

export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
  return <AbsoluteFill style={{ pointerEvents: "none", backgroundImage: noise, backgroundSize: "220px", backgroundPosition: `${(frame * 7) % 220}px ${(frame * 13) % 220}px`, opacity: 0.06, mixBlendMode: "multiply" }} />;
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 58%, rgba(24,24,27,0.14) 100%)" }} />
);

/** Fade + rise + scale entrance. */
export const Entrance: React.FC<{ delay?: number; rise?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, rise = 40, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
  return (
    <div style={{ opacity: p, transform: `translateY(${interpolate(p, [0, 1], [rise, 0])}px) scale(${interpolate(p, [0, 1], [0.94, 1])})`, ...style }}>{children}</div>
  );
};

export const WordReveal: React.FC<{ text: string; delay?: number; per?: number; gap?: number; style?: React.CSSProperties; highlight?: string; highlightStyle?: React.CSSProperties }> = ({ text, delay = 0, per = 3, gap = 22, style, highlight, highlightStyle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: gap, ...style }}>
      {text.split(" ").map((word, i) => {
        const p = spring({ frame: frame - delay - i * per, fps, config: theme.spring.snappy });
        const hit = highlight && word.replace(/[.,]/g, "") === highlight;
        return (
          <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${interpolate(p, [0, 1], [34, 0])}px) scale(${interpolate(p, [0, 1], [0.92, 1])})`, ...(hit ? highlightStyle : {}) }}>
            {word}
          </span>
        );
      })}
    </div>
  );
};

/** Wraps a scene: fast exit over the last frames (scale up + lift + fade). */
export const SceneExit: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const len = Math.round(fps / 3);
  const p = interpolate(frame, [durationInFrames - len, durationInFrames], [0, 1], { ...clamp, easing: theme.ease.in });
  return (
    <AbsoluteFill style={{ opacity: 1 - p, transform: `translateY(${-36 * p}px) scale(${1 + 0.05 * p})`, filter: `blur(${p * 6}px)` }}>{children}</AbsoluteFill>
  );
};

export const SectionLabel: React.FC<{ n: string; text: string }> = ({ n, text }) => (
  <div style={{ position: "absolute", top: 92, left: 120 }}>
    <Entrance delay={2} rise={20}>
      <div style={{ fontFamily: theme.fonts.mono, fontWeight: 500, fontSize: 24, letterSpacing: "0.14em", color: theme.colors.dim, textTransform: "uppercase" }}>
        <span style={{ color: theme.colors.ink }}>{n}</span> · {text}
      </div>
    </Entrance>
  </div>
);

/** Plays a sound starting `lead` frames before the visual it belongs to. */
export const Sfx: React.FC<{ at: number; src: string; volume?: number; lead?: number }> = ({ at, src, volume = 0.6, lead = 2 }) => (
  <Sequence from={Math.max(0, at - lead)} layout="none">
    <Audio src={staticFile(`sfx/${src}.wav`)} volume={volume} />
  </Sequence>
);

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: theme.colors.surface, border: `1.5px solid ${theme.colors.border}`, borderRadius: 28, boxShadow: theme.shadow, ...style }}>{children}</div>
);

export { clamp };
