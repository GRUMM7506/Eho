/** Названия звуков. Реализация синтеза — `synth.ts` и `sfx.ts`. */
export type SfxName =
  | 'step'
  | 'push'
  | 'pickup'
  | 'drop'
  | 'plateDown'
  | 'plateUp'
  | 'doorOpen'
  | 'doorClose'
  | 'lever'
  | 'portal'
  | 'laser'
  | 'death'
  | 'paradox'
  | 'record'
  | 'loopStart'
  | 'tick'
  | 'win'
  | 'star'
  | 'click'
  | 'hover'
  | 'back'
  | 'bump'
  | 'crack'
  | 'break'
  | 'slide'
  | 'unlock'
  | 'socket'
  | 'rewind'
  | 'guard'
  | 'lift';

export interface AudioApi {
  unlock(): void;
  play(name: SfxName, pan?: number, gain?: number): void;
  setVolumes(master: number, music: number, sfx: number): void;
  /** Музыка мира (−1 — меню). */
  setWorld(world: number): void;
  /** Число записанных эхо — определяет слои музыки. */
  setLayers(echoes: number): void;
  /** Приглушить (пауза, фон). */
  setDucked(ducked: boolean): void;
  suspend(): void;
  resume(): void;
}
