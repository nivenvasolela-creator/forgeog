import React from "react";
import { Composition } from "remotion";
import { Promo, TOTAL_BEATS } from "./Promo";
import { theme } from "./theme";

const FPS = 30;
export const Root: React.FC = () => (
  <Composition id="ForgePromo" component={Promo} fps={FPS} width={1920} height={1080} durationInFrames={Math.round((TOTAL_BEATS * FPS * 60) / theme.bpm)} />
);
