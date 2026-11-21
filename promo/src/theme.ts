// Single source of truth. Palette and fonts come from the FORGE app itself (src/index.css, components).
import { Easing } from "remotion";

export const theme = {
  colors: {
    bg: "#F7F7F5",
    surface: "#FFFFFF",
    border: "#E5E4DF",
    ink: "#18181B",
    inkSoft: "#3F3F46",
    dim: "#6B6B65",
    faint: "#9B9B94",
    primary: "#F97316", // THE hero color: max one element per frame
    primaryDeep: "#C2410C",
    glow: "rgba(249, 115, 22, 0.35)",
    meshA: "rgba(249, 115, 22, 0.16)",
    meshB: "rgba(24, 24, 27, 0.07)",
    go: { bg: "#F0FDF4", border: "#86EFAC", text: "#15803D" },
    pivot: { bg: "#FFF7ED", border: "#FDBA74", text: "#C2410C" },
    kill: { bg: "#FEF2F2", border: "#FCA5A5", text: "#B91C1C" },
  },
  fonts: {
    display: "'Bricolage Grotesque', sans-serif",
    body: "'DM Sans', sans-serif",
    mono: "'IBM Plex Mono', monospace",
  },
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.83, 0, 0.17, 1),
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },
  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
    count: { damping: 30, stiffness: 50, mass: 1 },
  },
  bpm: 120,
  shadow: "0 30px 60px -24px rgba(24,24,27,0.22), 0 2px 6px rgba(24,24,27,0.05)",
} as const;
