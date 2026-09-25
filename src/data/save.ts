import type { RawLevel } from '../core/level';
import { BINDABLE, DEFAULT_KEYMAP, cloneKeymap, type KeyMap } from '../input/keymap';
import type { KV } from './storage';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type TickSpeedSetting = 'slow' | 'normal' | 'fast';

export interface Settings {
  volumeMaster: number;
  volumeMusic: number;
  volumeSfx: number;
  tickSpeed: TickSpeedSetting;
  quality: QualitySetting;
  vibration: boolean;
  screenShake: boolean;
  reducedMotion: boolean;
  colorblind: boolean;
  keymap: KeyMap;
  language: 'ru' | 'en';
  perspective: boolean;
  freeCamera: boolean;
  dpad: boolean;
  trails: boolean;
}

export interface LevelResult {
  completed: boolean;
  stars: number;
  bestEchoes: number;
  bestTicks: number;
  perfect: boolean;
}

export interface SaveData {
  version: number;
  levels: Record<string, LevelResult>;
  lastLevel: string | null;
  customLevels: RawLevel[];
  settings: Settings;
  /** Показанные обучающие подсказки и прочие флаги. */
  flags: Record<string, boolean>;
}

export const SAVE_VERSION = 3;
const KEY = 'echo-save';

export function defaultSettings(env: { reducedMotion: boolean; language: 'ru' | 'en'; touch: boolean }): Settings {
  return {
    volumeMaster: 0.8,
    volumeMusic: 0.6,
    volumeSfx: 0.8,
    tickSpeed: 'normal',
    quality: 'auto',
    vibration: true,
    screenShake: true,
    reducedMotion: env.reducedMotion,
    colorblind: false,
    keymap: cloneKeymap(DEFAULT_KEYMAP),
    language: env.language,
    perspective: false,
    freeCamera: false,
    dpad: false,
    trails: false,
  };
}

export function defaultSave(settings: Settings): SaveData {
  return { version: SAVE_VERSION, levels: {}, lastLevel: null, customLevels: [], settings, flags: {} };
}

type Loose = Record<string, unknown>;

function isObj(x: unknown): x is Loose {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Миграция сохранения со старых версий схемы.
 *  v1 (прототип `echo-progress`): { [индекс уровня]: звёзды } — переносится как пройденные уровни мира 1.
 *  v2: настройки без `keymap` и `trails`, результаты без `perfect`.
 *  v3: текущая.
 */
export function migrate(raw: unknown, defaults: Settings): SaveData {
  const base = defaultSave(defaults);
  if (!isObj(raw)) return base;
  let data: Loose = raw;
  const version0 = typeof data.version === 'number' ? data.version : 1;
  let version = version0;

  if (version === 1) {
    const levels: Record<string, LevelResult> = {};
    for (const [k, v] of Object.entries(data)) {
      const n = Number(k);
      if (Number.isInteger(n) && typeof v === 'number' && v > 0) {
        levels[`w1-${n + 1}`] = { completed: true, stars: Math.min(3, v), bestEchoes: 99, bestTicks: 999, perfect: false };
      }
    }
    data = { version: 2, levels, lastLevel: null, customLevels: [], settings: {} };
    version = 2;
  }

  if (version === 2) {
    const levels = isObj(data.levels) ? data.levels : {};
    for (const r of Object.values(levels)) if (isObj(r) && typeof r.perfect !== 'boolean') r.perfect = false;
    data = { ...data, levels, flags: {}, version: 3 };
  }

  const s = isObj(data.settings) ? data.settings : {};
  const settings: Settings = { ...defaults };
  for (const k of Object.keys(defaults) as (keyof Settings)[]) {
    if (k === 'keymap') continue;
    if (typeof s[k] === typeof defaults[k]) (settings as unknown as Loose)[k] = s[k];
  }
  const km = isObj(s.keymap) ? s.keymap : {};
  settings.keymap = cloneKeymap(DEFAULT_KEYMAP);
  for (const b of BINDABLE) {
    const v = km[b];
    if (Array.isArray(v) && v.every((c) => typeof c === 'string')) settings.keymap[b] = v as string[];
  }
  settings.volumeMaster = clamp01(settings.volumeMaster);
  settings.volumeMusic = clamp01(settings.volumeMusic);
  settings.volumeSfx = clamp01(settings.volumeSfx);

  const levels: Record<string, LevelResult> = {};
  if (isObj(data.levels)) {
    for (const [id, r] of Object.entries(data.levels)) {
      if (!isObj(r)) continue;
      levels[id] = {
        completed: r.completed === true,
        stars: typeof r.stars === 'number' ? Math.max(0, Math.min(3, r.stars)) : 0,
        bestEchoes: typeof r.bestEchoes === 'number' ? r.bestEchoes : 99,
        bestTicks: typeof r.bestTicks === 'number' ? r.bestTicks : 999,
        perfect: r.perfect === true,
      };
    }
  }
  return {
    version: SAVE_VERSION,
    levels,
    lastLevel: typeof data.lastLevel === 'string' ? data.lastLevel : null,
    customLevels: Array.isArray(data.customLevels) ? (data.customLevels as RawLevel[]) : [],
    settings,
    flags: isObj(data.flags) ? (Object.fromEntries(Object.entries(data.flags).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>) : {},
  };
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.8;
}

export function loadSave(kv: KV, defaults: Settings): SaveData {
  const raw = kv.get(KEY);
  if (raw) {
    try {
      return migrate(JSON.parse(raw), defaults);
    } catch {
      return defaultSave(defaults);
    }
  }
  // Прогресс из прототипа (echo-game.html).
  const legacy = kv.get('echo-progress');
  if (legacy) {
    try {
      return migrate(JSON.parse(legacy), defaults);
    } catch {
      // игнорируем
    }
  }
  return defaultSave(defaults);
}

export function writeSave(kv: KV, data: SaveData): void {
  kv.set(KEY, JSON.stringify(data));
}

/** Записать результат уровня, сохранив лучшие значения. Возвращает, был ли это новый рекорд. */
export function recordResult(data: SaveData, id: string, stars: number, echoes: number, ticks: number, perfect: boolean): boolean {
  const prev = data.levels[id];
  const better = !prev || !prev.completed || echoes < prev.bestEchoes || ticks < prev.bestTicks;
  data.levels[id] = {
    completed: true,
    stars: Math.max(prev?.stars ?? 0, stars),
    bestEchoes: Math.min(prev?.bestEchoes ?? 99, echoes),
    bestTicks: Math.min(prev?.bestTicks ?? 999, ticks),
    perfect: (prev?.perfect ?? false) || perfect,
  };
  data.lastLevel = id;
  return better;
}
