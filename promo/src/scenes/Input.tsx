import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Card, Entrance, SceneExit, SectionLabel, Sfx, clamp, useBeat } from "../components";
import { theme } from "../theme";

const IDEA = "Boda-boda deliveries for small shops in Dar es Salaam, booked over WhatsApp.";

export const Input: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = useBeat();
  const typeStart = Math.round(b * 1.2);
  const typeEnd = Math.round(b * 4.6);
  const chars = Math.floor(interpolate(frame, [typeStart, typeEnd], [0, IDEA.length], { ...clamp, easing: theme.ease.inOut }));
  const caretOn = Math.floor(frame / (fps / 4)) % 2 === 0 || (frame > typeStart && frame < typeEnd);
  const btnAt = typeEnd + 4;
  const btn = spring({ frame: frame - btnAt, fps, config: theme.spring.bouncy });
  const pressAt = Math.round(b * 6.4);
  const press = interpolate(frame, [pressAt, pressAt + 3, pressAt + 9], [1, 0.94, 1], { ...clamp, easing: theme.ease.out });
  const float = Math.sin(frame / 30) * 4;
  const keyFrames = Array.from({ length: 14 }, (_, i) => Math.round(typeStart + ((typeEnd - typeStart) * i) / 14));

  return (
    <SceneExit>
      <SectionLabel n="01" text="Validate" />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <Entrance delay={4}>
          <Card style={{ width: 1180, padding: "56px 64px", transform: `translateY(${float}px)` }}>
            <div style={{ fontFamily: theme.fonts.body, fontWeight: 600, fontSize: 30, color: theme.colors.ink }}>Paste your messy idea</div>
            <div style={{ fontFamily: theme.fonts.body, fontSize: 22, color: theme.colors.dim, marginTop: 8 }}>A sentence is enough. English or Kiswahili.</div>
            <div style={{ marginTop: 32, minHeight: 190, borderRadius: 18, border: `1.5px solid ${theme.colors.border}`, background: theme.colors.bg, padding: "28px 32px",
              fontFamily: theme.fonts.body, fontWeight: 500, fontSize: 44, lineHeight: 1.3, color: theme.colors.ink }}>
              {IDEA.slice(0, chars)}
              <span style={{ display: "inline-block", width: 4, height: 50, marginLeft: 4, verticalAlign: "-8px", background: theme.colors.ink, opacity: caretOn ? 1 : 0 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 32 }}>
              <div style={{ opacity: btn, transform: `scale(${interpolate(btn, [0, 1], [0.8, 1]) * press}) translateY(${interpolate(btn, [0, 1], [20, 0])}px)`,
                background: theme.colors.primary, color: theme.colors.surface, borderRadius: 18, padding: "22px 44px",
                fontFamily: theme.fonts.body, fontWeight: 600, fontSize: 30, boxShadow: `0 0 40px ${theme.colors.glow}` }}>
                Analyze idea →
              </div>
            </div>
          </Card>
        </Entrance>
      </AbsoluteFill>
      <Sfx at={4} src="whoosh" volume={0.35} />
      {keyFrames.map((f) => <Sfx key={f} at={f} src="key" volume={0.35} lead={0} />)}
      <Sfx at={btnAt} src="pop" volume={0.6} />
      <Sfx at={pressAt} src="tick" volume={0.8} lead={0} />
    </SceneExit>
  );
};
