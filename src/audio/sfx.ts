import type { SfxName } from './index';
import { mtof, type VoiceSpec } from './synth';

/**
 * Рецепты звуков: список голосов синтезатора. Параметр `v` (0…1) даёт небольшую вариацию
 * (высота шага, номер звезды), чтобы повторяющиеся звуки не звучали механически.
 */
type Recipe = (v: number) => VoiceSpec[];

const E = (a: number, d: number, s: number, r: number, hold = 0) => ({ a, d, s, r, hold });

export const RECIPES: Record<SfxName, Recipe> = {
  step: (v) => [
    {
      wave: 'noise',
      freq: 900 + v * 400,
      env: E(0.002, 0.03, 0, 0.03),
      gain: 0.35,
      filter: { type: 'bandpass', freq: 1800 + v * 600, q: 1.2 },
    },
    { wave: 'sine', freq: 140 + v * 30, freqEnd: 80, slide: 'exp', env: E(0.002, 0.05, 0, 0.04), gain: 0.4 },
  ],
  bump: () => [
    {
      wave: 'sine',
      freq: 110,
      freqEnd: 60,
      slide: 'exp',
      env: E(0.002, 0.06, 0, 0.05),
      gain: 0.5,
      filter: { type: 'lowpass', freq: 600 },
    },
  ],
  push: () => [
    {
      wave: 'noise',
      freq: 400,
      freqEnd: 250,
      env: E(0.01, 0.12, 0.3, 0.1),
      gain: 0.5,
      filter: { type: 'lowpass', freq: 900, freqEnd: 300, q: 2 },
    },
    {
      wave: 'sawtooth',
      freq: 70,
      freqEnd: 55,
      env: E(0.01, 0.1, 0.2, 0.08),
      gain: 0.18,
      filter: { type: 'lowpass', freq: 400 },
    },
  ],
  pickup: () => [
    {
      wave: 'square',
      freq: mtof(76),
      env: E(0.002, 0.05, 0.2, 0.05),
      gain: 0.18,
      filter: { type: 'lowpass', freq: 3000 },
    },
    {
      wave: 'square',
      freq: mtof(83),
      env: E(0.002, 0.06, 0.2, 0.08),
      gain: 0.18,
      delay: 0.06,
      filter: { type: 'lowpass', freq: 3000 },
    },
  ],
  drop: () => [
    {
      wave: 'square',
      freq: mtof(79),
      env: E(0.002, 0.05, 0.2, 0.05),
      gain: 0.16,
      filter: { type: 'lowpass', freq: 2500 },
    },
    {
      wave: 'square',
      freq: mtof(72),
      env: E(0.002, 0.06, 0.2, 0.08),
      gain: 0.16,
      delay: 0.06,
      filter: { type: 'lowpass', freq: 2500 },
    },
  ],
  plateDown: () => [
    {
      wave: 'noise',
      freq: 1500,
      env: E(0.001, 0.02, 0, 0.02),
      gain: 0.3,
      filter: { type: 'highpass', freq: 1500 },
    },
    { wave: 'sine', freq: 190, freqEnd: 120, slide: 'exp', env: E(0.003, 0.12, 0.1, 0.1), gain: 0.55 },
    { wave: 'triangle', freq: mtof(69), env: E(0.005, 0.1, 0.2, 0.2), gain: 0.12, delay: 0.02 },
  ],
  plateUp: () => [
    {
      wave: 'noise',
      freq: 2200,
      env: E(0.001, 0.015, 0, 0.02),
      gain: 0.2,
      filter: { type: 'highpass', freq: 2000 },
    },
    { wave: 'sine', freq: 150, freqEnd: 210, env: E(0.003, 0.08, 0, 0.05), gain: 0.35 },
  ],
  doorOpen: () => [
    {
      wave: 'sawtooth',
      freq: 90,
      freqEnd: 180,
      env: E(0.02, 0.2, 0.3, 0.15),
      gain: 0.2,
      filter: { type: 'lowpass', freq: 500, freqEnd: 2200, q: 4 },
    },
    {
      wave: 'noise',
      freq: 700,
      freqEnd: 1200,
      env: E(0.05, 0.2, 0.2, 0.15),
      gain: 0.18,
      filter: { type: 'bandpass', freq: 900, freqEnd: 2400, q: 1.5 },
    },
  ],
  doorClose: () => [
    {
      wave: 'sawtooth',
      freq: 180,
      freqEnd: 80,
      env: E(0.01, 0.15, 0.2, 0.1),
      gain: 0.2,
      filter: { type: 'lowpass', freq: 1800, freqEnd: 400, q: 4 },
    },
    {
      wave: 'sine',
      freq: 90,
      freqEnd: 50,
      slide: 'exp',
      env: E(0.001, 0.12, 0, 0.1),
      gain: 0.5,
      delay: 0.14,
    },
  ],
  lever: () => [
    {
      wave: 'noise',
      freq: 2500,
      env: E(0.001, 0.02, 0, 0.01),
      gain: 0.35,
      filter: { type: 'bandpass', freq: 3000, q: 3 },
    },
    {
      wave: 'noise',
      freq: 1800,
      env: E(0.001, 0.025, 0, 0.02),
      gain: 0.35,
      delay: 0.07,
      filter: { type: 'bandpass', freq: 2000, q: 3 },
    },
    {
      wave: 'square',
      freq: 220,
      env: E(0.001, 0.05, 0, 0.04),
      gain: 0.1,
      delay: 0.07,
      filter: { type: 'lowpass', freq: 1200 },
    },
  ],
  portal: () => [
    {
      wave: 'sine',
      freq: 300,
      freqEnd: 1400,
      slide: 'exp',
      env: E(0.01, 0.25, 0.1, 0.2),
      gain: 0.25,
      vibrato: { rate: 18, depth: 80 },
    },
    {
      wave: 'triangle',
      freq: 1400,
      freqEnd: 400,
      slide: 'exp',
      env: E(0.02, 0.25, 0.1, 0.25),
      gain: 0.15,
      delay: 0.1,
    },
  ],
  laser: () => [
    {
      wave: 'sawtooth',
      freq: 880,
      freqEnd: 820,
      env: E(0.005, 0.15, 0.3, 0.15),
      gain: 0.1,
      vibrato: { rate: 40, depth: 30 },
      filter: { type: 'bandpass', freq: 2200, q: 2 },
    },
  ],
  death: () => [
    {
      wave: 'noise',
      freq: 1200,
      freqEnd: 150,
      env: E(0.002, 0.4, 0.2, 0.3),
      gain: 0.6,
      filter: { type: 'lowpass', freq: 3000, freqEnd: 200 },
      distort: 0.6,
    },
    {
      wave: 'square',
      freq: 220,
      freqEnd: 40,
      slide: 'exp',
      env: E(0.002, 0.5, 0.1, 0.2),
      gain: 0.25,
      distort: 0.8,
    },
  ],
  paradox: () => {
    const out: VoiceSpec[] = [];
    const notes = [900, 240, 1300, 180, 700, 420];
    notes.forEach((f, i) =>
      out.push({
        wave: 'square',
        freq: f,
        env: E(0.001, 0.035, 0.4, 0.02),
        gain: 0.18,
        delay: i * 0.045,
        distort: 0.7,
        filter: { type: 'bandpass', freq: f * 1.5, q: 2 },
      }),
    );
    out.push({
      wave: 'noise',
      freq: 3000,
      freqEnd: 300,
      env: E(0.002, 0.3, 0.1, 0.15),
      gain: 0.3,
      filter: { type: 'highpass', freq: 400 },
      distort: 0.5,
    });
    return out;
  },
  record: () => [
    {
      wave: 'noise',
      freq: 400,
      freqEnd: 2600,
      env: { a: 0.35, d: 0.02, s: 1, r: 0.06 },
      gain: 0.4,
      filter: { type: 'bandpass', freq: 300, freqEnd: 5000, q: 1.2 },
    },
    { wave: 'sine', freq: mtof(72), env: E(0.005, 0.2, 0.3, 0.6), gain: 0.2, delay: 0.38 },
    { wave: 'sine', freq: mtof(79), env: E(0.005, 0.2, 0.3, 0.6), gain: 0.16, delay: 0.44 },
    { wave: 'sine', freq: mtof(84), env: E(0.005, 0.2, 0.3, 0.8), gain: 0.12, delay: 0.5 },
  ],
  rewind: () => [
    {
      wave: 'sawtooth',
      freq: 900,
      freqEnd: 200,
      slide: 'exp',
      env: E(0.005, 0.18, 0.3, 0.05),
      gain: 0.12,
      filter: { type: 'lowpass', freq: 2500, q: 3 },
    },
    {
      wave: 'noise',
      freq: 1500,
      freqEnd: 500,
      env: E(0.01, 0.15, 0.2, 0.05),
      gain: 0.15,
      filter: { type: 'bandpass', freq: 1200, q: 1 },
    },
  ],
  loopStart: () => [
    {
      wave: 'square',
      freq: 1800,
      env: E(0.001, 0.015, 0, 0.01),
      gain: 0.25,
      filter: { type: 'highpass', freq: 1200 },
    },
    {
      wave: 'square',
      freq: 1350,
      env: E(0.001, 0.015, 0, 0.01),
      gain: 0.2,
      delay: 0.1,
      filter: { type: 'highpass', freq: 900 },
    },
  ],
  tick: () => [
    {
      wave: 'square',
      freq: 2400,
      env: E(0.001, 0.012, 0, 0.01),
      gain: 0.2,
      filter: { type: 'highpass', freq: 1800 },
    },
  ],
  win: () => {
    const chord = [60, 64, 67, 71, 74, 79];
    return chord.map(
      (n, i) =>
        ({
          wave: i % 2 ? 'triangle' : 'sine',
          freq: mtof(n),
          env: E(0.01, 0.4, 0.4, 1.4),
          gain: 0.14,
          delay: i * 0.07,
        }) as VoiceSpec,
    );
  },
  star: (v) => [
    { wave: 'sine', freq: mtof(79 + Math.round(v * 10) * 2), env: E(0.002, 0.15, 0.3, 0.7), gain: 0.25 },
    { wave: 'triangle', freq: mtof(91 + Math.round(v * 10) * 2), env: E(0.002, 0.1, 0.2, 0.5), gain: 0.1 },
  ],
  click: () => [
    {
      wave: 'square',
      freq: 1200,
      env: E(0.001, 0.02, 0, 0.015),
      gain: 0.12,
      filter: { type: 'lowpass', freq: 4000 },
    },
  ],
  hover: () => [{ wave: 'sine', freq: 1600, env: E(0.001, 0.015, 0, 0.02), gain: 0.05 }],
  back: () => [
    {
      wave: 'square',
      freq: 700,
      freqEnd: 500,
      env: E(0.001, 0.03, 0, 0.02),
      gain: 0.12,
      filter: { type: 'lowpass', freq: 3000 },
    },
  ],
  crack: () => [
    {
      wave: 'noise',
      freq: 3000,
      env: E(0.001, 0.05, 0.1, 0.05),
      gain: 0.35,
      filter: { type: 'highpass', freq: 2500 },
    },
  ],
  break: () => [
    {
      wave: 'noise',
      freq: 800,
      freqEnd: 200,
      env: E(0.002, 0.3, 0.2, 0.2),
      gain: 0.5,
      filter: { type: 'lowpass', freq: 2500, freqEnd: 300 },
    },
    { wave: 'sine', freq: 80, freqEnd: 40, slide: 'exp', env: E(0.002, 0.3, 0, 0.1), gain: 0.4 },
  ],
  slide: () => [
    {
      wave: 'noise',
      freq: 1800,
      freqEnd: 900,
      env: E(0.02, 0.15, 0.2, 0.1),
      gain: 0.2,
      filter: { type: 'bandpass', freq: 3000, freqEnd: 1500, q: 2 },
    },
  ],
  unlock: () => [
    { wave: 'triangle', freq: mtof(88), env: E(0.001, 0.2, 0.2, 0.5), gain: 0.2 },
    {
      wave: 'noise',
      freq: 2000,
      env: E(0.001, 0.03, 0, 0.02),
      gain: 0.3,
      filter: { type: 'bandpass', freq: 2500, q: 4 },
    },
  ],
  socket: () => [
    {
      wave: 'sawtooth',
      freq: 110,
      env: E(0.01, 0.2, 0.4, 0.2),
      gain: 0.12,
      vibrato: { rate: 50, depth: 40 },
      filter: { type: 'lowpass', freq: 1200 },
    },
    {
      wave: 'noise',
      freq: 4000,
      env: E(0.001, 0.06, 0, 0.03),
      gain: 0.25,
      filter: { type: 'highpass', freq: 3000 },
    },
  ],
  guard: () => [
    {
      wave: 'sawtooth',
      freq: 160,
      freqEnd: 200,
      env: E(0.02, 0.08, 0.2, 0.05),
      gain: 0.06,
      filter: { type: 'lowpass', freq: 700 },
    },
  ],
  lift: () => [
    {
      wave: 'sawtooth',
      freq: 60,
      freqEnd: 90,
      env: E(0.05, 0.3, 0.4, 0.2),
      gain: 0.18,
      filter: { type: 'lowpass', freq: 400, q: 3 },
    },
  ],
};

/** Частые звуки заранее рендерятся в AudioBuffer. */
export const PRERENDER: readonly SfxName[] = [
  'step',
  'bump',
  'tick',
  'click',
  'hover',
  'back',
  'plateDown',
  'plateUp',
  'crack',
  'guard',
];

/** Какие звуки идут в реверб (и насколько). */
export const REVERB_SEND: Partial<Record<SfxName, number>> = {
  win: 0.6,
  star: 0.5,
  record: 0.5,
  portal: 0.5,
  paradox: 0.35,
  death: 0.3,
  doorOpen: 0.25,
  doorClose: 0.25,
  unlock: 0.4,
  plateDown: 0.2,
};
