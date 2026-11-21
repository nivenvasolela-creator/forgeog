// Synthesizes the promo's music bed and SFX as 16-bit mono WAVs. Deterministic, no downloads.
import { writeFileSync } from "node:fs";
const SR = 44100;
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function wav(path, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples.length * 2, 40);
  let peak = 0; for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const g = peak > 0.98 ? 0.98 / peak : 1;
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(s * g * 32767), 44 + i * 2));
  writeFileSync(path, buf);
}
const make = (sec, fn) => Array.from({ length: Math.floor(sec * SR) }, (_, i) => fn(i / SR, i));

// One-pole low-pass for noise shaping.
function lowpassed(sec, cutoffAt, env) {
  let y = 0;
  return make(sec, (t) => {
    const a = Math.min(1, (2 * Math.PI * cutoffAt(t)) / SR);
    y += a * (rand() - y);
    return y * env(t);
  });
}

// Whoosh: filtered noise sweeping up then down.
wav("public/sfx/whoosh.wav", lowpassed(0.45, (t) => 400 + 5000 * Math.sin(Math.PI * (t / 0.45)), (t) => Math.sin(Math.PI * (t / 0.45)) ** 2 * 0.9));
// Pop: pitch-dropping sine.
wav("public/sfx/pop.wav", make(0.18, (t) => Math.sin(2 * Math.PI * (900 * Math.exp(-t * 18) + 180) * t) * Math.exp(-t * 22) * 0.8));
// Tick: short bright click.
wav("public/sfx/tick.wav", make(0.04, (t) => (Math.sin(2 * Math.PI * 3200 * t) * 0.5 + rand() * 0.3) * Math.exp(-t * 160)));
// Key: soft keyboard tap.
wav("public/sfx/key.wav", lowpassed(0.05, () => 2500, (t) => Math.exp(-t * 120) * 0.6));
// Hit: sub thump + noise transient, for the big moments.
wav("public/sfx/hit.wav", make(0.9, (t) => Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 25)) * t) * Math.exp(-t * 4.5) + rand() * Math.exp(-t * 60) * 0.35));
// Shimmer: detuned high sines, for the CTA.
wav("public/sfx/shimmer.wav", make(1.6, (t) => [1318.5, 1567.98, 1975.5, 2637].reduce((s, f, k) => s + Math.sin(2 * Math.PI * f * (1 + k * 0.002) * t + k), 0) * 0.18 * Math.min(1, t * 20) * Math.exp(-t * 2.2)));

// Music bed: 120 BPM, 28s. Kick on beats, offbeat hats, A-minor-ish pad, bass on root.
const BPM = 120, beat = 60 / BPM, LEN = 28;
const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 207.65, 246.94]];
const roots = [55, 43.65, 49, 41.2];
wav("public/sfx/music.wav", make(LEN, (t) => {
  const b = t / beat, inBeat = (b % 1) * beat, bar = Math.floor(b / 4) % 4;
  const fadeIn = Math.min(1, t / 1.5), fadeOut = Math.min(1, (LEN - t) / 2);
  const kick = Math.sin(2 * Math.PI * (48 + 110 * Math.exp(-inBeat * 30)) * inBeat) * Math.exp(-inBeat * 9) * 0.55;
  const off = ((b + 0.5) % 1) * beat;
  const hat = rand() * Math.exp(-off * 70) * 0.08;
  const pad = chords[bar].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.004 * t), 0) * 0.045;
  const bass = Math.sin(2 * Math.PI * roots[bar] * t) * 0.22 * (0.6 + 0.4 * Math.exp(-inBeat * 4));
  return (kick + hat + pad + bass) * fadeIn * fadeOut;
}));
console.log("sfx written");
