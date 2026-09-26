import { compileLevel } from '../core/level';
import { playSolution } from '../core/sim';
import type { Level } from '../core/types';

const levelFiles = import.meta.glob<{ default: unknown }>('../levels/world*/level*.json', { eager: true });

export interface SolutionFile {
  id: string;
  loops: string[];
  echoes: number;
  ticks: number;
  provenMinimal: boolean;
}

export interface BuiltinEntry {
  path: string;
  raw: unknown;
  solution: SolutionFile | null;
}

/** Все файлы уровней с их эталонными решениями (решения лежат рядом: levelM.solution.json). */
export function builtinEntries(): BuiltinEntry[] {
  const out: BuiltinEntry[] = [];
  for (const [path, mod] of Object.entries(levelFiles)) {
    if (path.endsWith('.solution.json')) continue;
    const solPath = path.replace(/\.json$/, '.solution.json');
    const sol = levelFiles[solPath]?.default as SolutionFile | undefined;
    out.push({ path, raw: mod.default, solution: sol ?? null });
  }
  return out;
}

/** Проходит ли эталонное решение уровень. */
export function verifySolution(level: Level, sol: SolutionFile | null): boolean {
  if (!sol || sol.id !== level.id) return false;
  if (sol.loops.length - 1 > level.maxEchoes) return false;
  try {
    return playSolution(level, sol.loops).state.outcome === 'won';
  } catch {
    return false;
  }
}

/**
 * Встроенные уровни, отсортированные по миру и номеру. Уровень без проходящего эталонного
 * решения в игру не попадает.
 */
export function loadBuiltinLevels(): Level[] {
  const out: Level[] = [];
  for (const e of builtinEntries()) {
    let level: Level;
    try {
      level = compileLevel(e.raw);
    } catch (err) {
      console.error(`Уровень ${e.path} не загружен:`, err);
      continue;
    }
    if (!verifySolution(level, e.solution)) {
      if (import.meta.env.DEV) console.warn(`Уровень ${level.id} пропущен: нет проходящего эталона`);
      continue;
    }
    out.push(level);
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
