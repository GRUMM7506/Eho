import type { Level } from '../core/types';
import type { SaveData } from './save';

export const WORLD_COUNT = 6;

export interface WorldInfo {
  world: number;
  levels: Level[];
  /** Обычные уровни по порядку; последний — «экзамен». */
  main: Level[];
  bonus: Level[];
  unlocked: boolean;
  completed: number;
  stars: number;
  maxStars: number;
}

export function totalStars(save: SaveData): number {
  return Object.values(save.levels).reduce((s, r) => s + (r.completed ? r.stars : 0), 0);
}

export function isCompleted(save: SaveData, id: string): boolean {
  return save.levels[id]?.completed === true;
}

/**
 * Правила открытия: мир 0 открыт; мир N открывается прохождением экзамена (последнего
 * обычного уровня) мира N−1. Внутри мира уровни открываются по порядку. Бонусные уровни —
 * за общее число звёзд.
 */
export function worlds(levels: readonly Level[], save: SaveData): WorldInfo[] {
  const out: WorldInfo[] = [];
  for (let w = 0; w < WORLD_COUNT; w++) {
    const list = levels.filter((l) => l.world === w);
    const main = list.filter((l) => !l.bonus).sort((a, b) => a.index - b.index);
    const bonus = list.filter((l) => l.bonus).sort((a, b) => a.index - b.index);
    const prevExam = w === 0 ? null : out[w - 1]?.main[out[w - 1]!.main.length - 1];
    const unlocked = w === 0 || (prevExam ? isCompleted(save, prevExam.id) : false);
    out.push({
      world: w,
      levels: list,
      main,
      bonus,
      unlocked,
      completed: list.filter((l) => isCompleted(save, l.id)).length,
      stars: list.reduce((s, l) => s + (save.levels[l.id]?.stars ?? 0), 0),
      maxStars: list.length * 3,
    });
  }
  return out;
}

export function isLevelUnlocked(levels: readonly Level[], save: SaveData, level: Level): boolean {
  const info = worlds(levels, save).find((w) => w.world === level.world);
  if (!info) return true;
  if (!info.unlocked) return false;
  if (level.bonus) return totalStars(save) >= level.starsRequired;
  const i = info.main.findIndex((l) => l.id === level.id);
  return i <= 0 || isCompleted(save, info.main[i - 1]!.id);
}

/** Следующий уровень после пройденного (для «Дальше»). */
export function nextLevel(levels: readonly Level[], save: SaveData, current: Level): Level | null {
  const info = worlds(levels, save);
  const w = info.find((x) => x.world === current.world);
  if (!w) return null;
  if (!current.bonus) {
    const i = w.main.findIndex((l) => l.id === current.id);
    if (i >= 0 && i < w.main.length - 1) return w.main[i + 1]!;
  }
  const nextWorld = info.find((x) => x.world === current.world + 1);
  if (nextWorld?.unlocked && nextWorld.main.length) return nextWorld.main[0]!;
  return null;
}

/** Уровень для кнопки «Продолжить»: первый непройденный открытый, иначе последний сыгранный. */
export function continueLevel(levels: readonly Level[], save: SaveData): Level | null {
  for (const w of worlds(levels, save)) {
    if (!w.unlocked) continue;
    for (const l of w.main) if (!isCompleted(save, l.id)) return l;
  }
  return levels.find((l) => l.id === save.lastLevel) ?? levels[0] ?? null;
}
