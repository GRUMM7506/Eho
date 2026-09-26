import type { AudioApi, SfxName } from './index';
import { Music } from './music';
import { PRERENDER, RECIPES, REVERB_SEND } from './sfx';
import { makeImpulse, Synth } from './synth';

/**
 * Звуковой движок: шины master / music / sfx, лимитер, реверб на свёртке, панорама.
 * Аудиоконтекст создаётся только после первого жеста пользователя.
 */
export class WebAudioEngine implements AudioApi {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverbIn!: GainNode;
  private music: Music | null = null;
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  private readonly lastPlayed = new Map<SfxName, number>();
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  private ducked = false;
  private world = -1;
  private layers = 0;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.ctx = ctx;
    this.synth = new Synth(ctx);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(limiter).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.6, 2.8);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.5;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.6;
    this.reverbIn.connect(conv).connect(reverbOut).connect(this.master);
    const musicReverb = ctx.createGain();
    musicReverb.gain.value = 0.9;
    musicReverb.connect(this.reverbIn);
    const musicDry = ctx.createGain();
    musicDry.connect(this.musicBus);
    const musicWet = ctx.createGain();
    musicWet.connect(this.musicBus);
    musicWet.connect(musicReverb);
    this.music = new Music(this.synth, musicDry, musicWet);
    this.applyVolumes(true);
    this.music.setWorld(this.world);
    this.music.setLayers(this.layers);
    this.music.start();
    void ctx.resume().catch(() => undefined);
    void this.prerender();
  }

  /** Рендер частых звуков в буферы (дешевле при проигрывании). */
  private async prerender(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || typeof OfflineAudioContext === 'undefined') return;
    for (const name of PRERENDER) {
      try {
        const len = 0.4;
        const off = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
        const s = new Synth(off);
        for (const v of RECIPES[name](0.5)) s.voice(off.destination, 0, v);
        this.buffers.set(name, await off.startRendering());
      } catch {
        // останется живой синтез
      }
    }
  }

  play(name: SfxName, pan = 0, gain = 1): void {
    const ctx = this.ctx;
    const synth = this.synth;
    if (!ctx || !synth || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.035) return;
    this.lastPlayed.set(name, now);
    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan * 0.7));
    out.connect(panner).connect(this.sfxBus);
    const send = REVERB_SEND[name];
    if (send) {
      const g = ctx.createGain();
      g.gain.value = send;
      panner.connect(g).connect(this.reverbIn);
    }
    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = name === 'step' ? 0.92 + Math.random() * 0.16 : 1;
      src.connect(out);
      src.start(now);
      return;
    }
    const v = name === 'star' ? gain - 0.8 : Math.random();
    for (const spec of RECIPES[name](v)) synth.voice(out, now + 0.005, spec);
  }

  private applyVolumes(instant = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => (instant ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.08));
    set(this.master.gain, this.volumes.master * 0.9);
    set(this.musicBus.gain, this.volumes.music * (this.ducked ? 0.35 : 1) * 0.8);
    set(this.sfxBus.gain, this.volumes.sfx);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  setWorld(world: number): void {
    this.world = world;
    this.music?.setWorld(world);
  }

  setLayers(echoes: number): void {
    this.layers = echoes;
    this.music?.setLayers(echoes);
  }

  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.applyVolumes();
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }
}
