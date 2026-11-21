import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import "./fonts";
import { BgMesh, Grade, Grain, Vignette, useBeat } from "./components";
import { Hook } from "./scenes/Hook";
import { Input } from "./scenes/Input";
import { Score } from "./scenes/Score";
import { Decision } from "./scenes/Decision";
import { Sprint } from "./scenes/Sprint";
import { Swahili } from "./scenes/Swahili";
import { Cta } from "./scenes/Cta";

// Scene lengths in beats; every cut lands on a beat of the 120 BPM bed.
export const SCENES: [React.FC, number][] = [[Hook, 6], [Input, 8], [Score, 10], [Decision, 8], [Sprint, 9], [Swahili, 6], [Cta, 9]];
export const TOTAL_BEATS = SCENES.reduce((s, [, n]) => s + n, 0);

export const Promo: React.FC = () => {
  const b = useBeat();
  const { durationInFrames } = useVideoConfig();
  let from = 0;
  return (
    <AbsoluteFill>
      <BgMesh />
      {SCENES.map(([Scene, beats], i) => {
        const start = from;
        from += beats * b;
        return <Sequence key={i} from={start} durationInFrames={beats * b}><Scene /></Sequence>;
      })}
      <Grade />
      <Grain />
      <Vignette />
      <Audio src={staticFile("sfx/music.wav")} volume={(f) => interpolate(f, [0, durationInFrames - 30, durationInFrames], [0.32, 0.32, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};
