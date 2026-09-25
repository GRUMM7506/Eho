import { compileLevel } from '../core/level';
import type { Level } from '../core/types';

const levelFiles = import.meta.glob<{ default: unknown }>('../levels/world*/level*.json', { eager: true });

function isLevelFile(path: string): boolean {
  return /level\d+\.json$/.test(path);
}

/** Все встроенные уровни, отсортированные по миру и номеру. */
export function loadBuiltinLevels(): Level[] {
  const out: Level[] = [];
  for (const [path, mod] of Object.entries(levelFiles)) {
    if (!isLevelFile(path)) continue;
    out.push(compileLevel(mod.default));
  }
  out.sort((a, b) => a.world - b.world || Number(a.bonus) - Number(b.bonus) || a.index - b.index);
  return out;
}

/** Уровни из редактора: битые пропускаются, чтобы не ломать список. */
export function loadCustomLevels(raw: readonly unknown[]): Level[] {
  const out: Level[] = [];
  raw.forEach((r, i) => {
    try {
      const l = compileLevel(r);
      out.push({ ...l, world: -1, index: i + 1, bonus: false });
    } catch {
      // пропускаем
    }
  });
  return out;
}
