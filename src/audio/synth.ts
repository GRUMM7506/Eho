/**
 * Мини-синтезатор на Web Audio API в духе sfxr: осцилляторы, огибающие ADSR, шум, фильтры,
 * дисторшн и реверб на свёртке со сгенерированным импульсом. Внешних файлов нет.
 */

export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
  /** Длительность удержания до отпускания (с). */
  hold?: number;
  peak?: number;
}

export type Wave = OscillatorType | 'noise';

export interface VoiceSpec {
  wave: Wave;
  freq: number;
  /** Частота в конце (скольжение), по умолчанию = freq. */
  freqEnd?: number;
  /** Кривая скольжения: exp — экспоненциальная. */
  slide?: 'lin' | 'exp';
  env: Env;
  gain?: number;
  filter?: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number };
  /** Вибрато: частота (Гц) и глубина (центы). */
  vibrato?: { rate: number; depth: number };
  detune?: number;
  delay?: number;
  distort?: number;
}

/** Нелинейная кривая для дисторшна. */
function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount * 100;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export class Synth {
  readonly ctx: BaseAudioContext;
  private noiseBuf: AudioBuffer | null = null;
  private readonly curves = new Map<number, Float32Array<ArrayBuffer>>();

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
  }

  noise(): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Детерминированный шум: звук не влияет на игру, но так проще сравнивать и кешировать.
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.noiseBuf = buf;
    return buf;
  }

  private curve(amount: number): Float32Array<ArrayBuffer> {
    const key = Math.round(amount * 20);
    let c = this.curves.get(key);
    if (!c) {
      c = distortionCurve(key / 20);
      this.curves.set(key, c);
    }
    return c;
  }

  /** Сыграть один голос в узел назначения; возвращает момент окончания. */
  voice(dest: AudioNode, t0: number, v: VoiceSpec): number {
    const ctx = this.ctx;
    const t = t0 + (v.delay ?? 0);
    const e = v.env;
    const peak = (v.env.peak ?? 1) * (v.gain ?? 1);
    const hold = e.hold ?? 0;
    const end = t + e.a + e.d + hold + e.r;
    let src: AudioScheduledSourceNode;
    let freqParam: AudioParam | null = null;
    if (v.wave === 'noise') {
      const b = ctx.createBufferSource();
      b.buffer = this.noise();
      b.loop = true;
      b.playbackRate.value = Math.max(0.05, v.freq / 1000);
      if (v.freqEnd !== undefined) b.playbackRate.linearRampToValueAtTime(Math.max(0.05, v.freqEnd / 1000), end);
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.type = v.wave;
      o.frequency.setValueAtTime(v.freq, t);
      if (v.detune) o.detune.value = v.detune;
      if (v.freqEnd !== undefined) {
        if (v.slide === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, v.freqEnd), end);
        else o.frequency.linearRampToValueAtTime(v.freqEnd, end);
      }
      freqParam = o.frequency;
      src = o;
    }
    let node: AudioNode = src;
    if (v.vibrato && freqParam) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = v.vibrato.rate;
      const lg = ctx.createGain();
      lg.gain.value = v.freq * (Math.pow(2, v.vibrato.depth / 1200) - 1);
      lfo.connect(lg).connect(freqParam);
      lfo.start(t);
      lfo.stop(end + 0.05);
    }
    if (v.filter) {
      const f = ctx.createBiquadFilter();
      f.type = v.filter.type;
      f.frequency.setValueAtTime(v.filter.freq, t);
      if (v.filter.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, v.filter.freqEnd), end);
      f.Q.value = v.filter.q ?? 0.8;
      node.connect(f);
      node = f;
    }
    if (v.distort) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.curve(v.distort);
      ws.oversample = '2x';
      node.connect(ws);
      node = ws;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, e.a));
    g.gain.linearRampToValueAtTime(peak * e.s + 0.0001, t + e.a + e.d);
    g.gain.setValueAtTime(peak * e.s + 0.0001, t + e.a + e.d + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    node.connect(g).connect(dest);
    src.start(t);
    src.stop(end + 0.05);
    return end;
  }
}

/** Сгенерированный импульс для реверба: затухающий шум со стерео-декорреляцией. */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = ch ? 98765 : 43219;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed / 0x7fffffff) * 2 - 1;
      d[i] = n * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** Нота MIDI → частота. */
export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
