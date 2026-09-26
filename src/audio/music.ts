import { mtof, type Synth } from './synth';

/**
 * Процедурный эмбиент-секвенсор. У каждого мира свой лад, тональность и темп.
 * Слои добавляются с каждым записанным эхо: 0 — пэд, 1 — бас, 2 — арпеджио,
 * 3 — перкуссия, 4 — мелодия, 5 — «искры». Это фирменная фишка: команда из копий звучит громче.
 */

interface WorldMusic {
  root: number;
  mode: readonly number[];
  bpm: number;
  /** Ступени аккордов по тактам. */
  prog: readonly number[];
  pad: OscillatorType;
  arp: OscillatorType;
  brightness: number;
}

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
} as const;

const WORLDS: Record<number, WorldMusic> = {
  [-1]: { root: 50, mode: MODES.dorian, bpm: 66, prog: [0, 6, 3, 4], pad: 'triangle', arp: 'sine', brightness: 1400 },
  0: { root: 48, mode: MODES.lydian, bpm: 72, prog: [0, 1, 0, 4], pad: 'sine', arp: 'triangle', brightness: 1600 },
  1: { root: 45, mode: MODES.aeolian, bpm: 92, prog: [0, 5, 2, 6], pad: 'triangle', arp: 'square', brightness: 1800 },
  2: { root: 52, mode: MODES.dorian, bpm: 86, prog: [0, 3, 6, 4], pad: 'triangle', arp: 'square', brightness: 1500 },
  3: { root: 54, mode: MODES.phrygian, bpm: 78, prog: [0, 1, 6, 1], pad: 'sine', arp: 'triangle', brightness: 1300 },
  4: { root: 47, mode: MODES.harmonic, bpm: 98, prog: [0, 5, 3, 4], pad: 'sawtooth', arp: 'square', brightness: 1200 },
  5: { root: 49, mode: MODES.lydian, bpm: 70, prog: [0, 4, 5, 3], pad: 'sine', arp: 'triangle', brightness: 2000 },
};

const LAYERS = 6;

export class Music {
  private readonly synth: Synth;
  private readonly out: GainNode;
  private readonly layers: GainNode[] = [];
  private readonly reverbSend: AudioNode;
  private world: WorldMusic = WORLDS[-1]!;
  private worldId = -2;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private active = 0;
  private rng = 1;
  private melodyDeg = 4;

  constructor(synth: Synth, dest: AudioNode, reverb: AudioNode) {
    this.synth = synth;
    const ctx = synth.ctx as AudioContext;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(dest);
    this.reverbSend = reverb;
    for (let i = 0; i < LAYERS; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      this.layers.push(g);
    }
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return this.rng / 2147483647;
  }

  setWorld(id: number): void {
    const key = id in WORLDS ? id : 1;
    if (key === this.worldId) return;
    this.worldId = key;
    this.world = WORLDS[key]!;
    this.rng = 7 + key * 101;
    this.melodyDeg = 4;
  }

  /** Сколько слоёв звучит (0 — только пэд). */
  setLayers(n: number): void {
    this.active = Math.max(0, Math.min(LAYERS - 1, n));
    const ctx = this.synth.ctx;
    this.layers.forEach((g, i) => {
      const target = i <= this.active ? [0.55, 0.5, 0.32, 0.4, 0.3, 0.25][i]! : 0;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(target, ctx.currentTime, 0.8);
    });
  }

  start(): void {
    if (this.timer) return;
    this.nextTime = this.synth.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
  }

  private note(deg: number, octave: number): number {
    const m = this.world.mode;
    const n = ((deg % 7) + 7) % 7;
    const oct = Math.floor(deg / 7);
    return this.world.root + m[n]! + 12 * (octave + oct);
  }

  private schedule(): void {
    const ctx = this.synth.ctx;
    const sixteenth = 60 / this.world.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.step = (this.step + 1) % 64;
      this.nextTime += sixteenth;
    }
  }

  private playStep(s: number, t: number, dur: number): void {
    const w = this.world;
    const bar = Math.floor(s / 16);
    const inBar = s % 16;
    const chordDeg = w.prog[bar % w.prog.length]!;
    const chord = [chordDeg, chordDeg + 2, chordDeg + 4, chordDeg + 6];
    const sy = this.synth;
    const L = this.layers;

    // 0: пэд — аккорд на такт, медленная атака.
    if (inBar === 0) {
      for (const [i, d] of chord.slice(0, 3).entries()) {
        const f = mtof(this.note(d, 0));
        sy.voice(L[0]!, t, { wave: w.pad, freq: f, detune: i * 4 - 4, env: { a: 1.2, d: 0.8, s: 0.6, r: 1.6, hold: dur * 16 - 2 }, gain: 0.06, filter: { type: 'lowpass', freq: w.brightness * 0.6 } });
        sy.voice(this.reverbSend, t, { wave: 'sine', freq: f * 2, env: { a: 1.5, d: 0.5, s: 0.5, r: 1.5, hold: dur * 12 }, gain: 0.015 });
      }
    }
    if (this.active >= 1 && (inBar === 0 || inBar === 8 || inBar === 10)) {
      // 1: бас.
      const f = mtof(this.note(chordDeg, -1));
      sy.voice(L[1]!, t, { wave: 'triangle', freq: f, env: { a: 0.01, d: 0.25, s: 0.5, r: 0.3, hold: dur * 3 }, gain: 0.22, filter: { type: 'lowpass', freq: 500 } });
    }
    if (this.active >= 2 && inBar % 2 === 0) {
      // 2: арпеджио по тонам аккорда.
      const idx = [0, 1, 2, 3, 2, 1, 0, 2][(inBar / 2) % 8]!;
      const f = mtof(this.note(chord[idx]!, 1));
      sy.voice(L[2]!, t, { wave: w.arp, freq: f, env: { a: 0.005, d: 0.12, s: 0.2, r: 0.18 }, gain: 0.07, filter: { type: 'lowpass', freq: w.brightness } });
      sy.voice(this.reverbSend, t + dur * 3, { wave: 'sine', freq: f, env: { a: 0.005, d: 0.1, s: 0.1, r: 0.2 }, gain: 0.02 });
    }
    if (this.active >= 3) {
      // 3: перкуссия — мягкая бочка и хэт.
      if (inBar === 0 || inBar === 8) sy.voice(L[3]!, t, { wave: 'sine', freq: 110, freqEnd: 45, slide: 'exp', env: { a: 0.002, d: 0.18, s: 0, r: 0.08 }, gain: 0.35 });
      if (inBar % 4 === 2) sy.voice(L[3]!, t, { wave: 'noise', freq: 6000, env: { a: 0.001, d: 0.03, s: 0, r: 0.03 }, gain: 0.07, filter: { type: 'highpass', freq: 6000 } });
      if (inBar === 12) sy.voice(L[3]!, t, { wave: 'noise', freq: 2500, env: { a: 0.001, d: 0.08, s: 0, r: 0.06 }, gain: 0.08, filter: { type: 'bandpass', freq: 1800, q: 1 } });
    }
    if (this.active >= 4 && inBar % 4 === 0 && this.rand() < 0.55) {
      // 4: мелодия — случайное блуждание по ладу (детерминированное зерно).
      this.melodyDeg += Math.round((this.rand() - 0.5) * 4);
      this.melodyDeg = Math.max(0, Math.min(11, this.melodyDeg));
      const f = mtof(this.note(this.melodyDeg, 1));
      sy.voice(L[4]!, t, { wave: 'sine', freq: f, env: { a: 0.01, d: 0.3, s: 0.3, r: 0.6 }, gain: 0.09, vibrato: { rate: 5, depth: 12 } });
      sy.voice(this.reverbSend, t, { wave: 'triangle', freq: f * 2, env: { a: 0.01, d: 0.2, s: 0.1, r: 0.5 }, gain: 0.03 });
    }
    if (this.active >= 5 && (inBar === 6 || inBar === 14) && this.rand() < 0.7) {
      // 5: искры.
      const f = mtof(this.note(chord[Math.floor(this.rand() * 4)]!, 3));
      sy.voice(this.reverbSend, t, { wave: 'sine', freq: f, env: { a: 0.002, d: 0.2, s: 0.1, r: 0.8 }, gain: 0.05 });
      sy.voice(L[5]!, t, { wave: 'sine', freq: f, env: { a: 0.002, d: 0.15, s: 0, r: 0.3 }, gain: 0.04 });
    }
  }
}
