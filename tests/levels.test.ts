import { describe, expect, it } from 'vitest';
import { compileLevel } from '../src/core/level';
import { playSolution } from '../src/core/sim';
import { builtinEntries, loadBuiltinLevels } from '../src/data/levels';

/**
 * Каждый уровень должен иметь эталонное решение, которое проходит симуляцию.
 * Уровень без проходящего эталона в игру не попадает.
 */
describe('уровни и эталонные решения', () => {
  const entries = builtinEntries();

  it('уровни найдены', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries.map((e) => [e.path, e] as const))('%s', (_path, e) => {
    const level = compileLevel(e.raw);
    expect(e.solution, `нет файла решения для ${level.id}`).not.toBeNull();
    const sol = e.solution!;
    expect(sol.id).toBe(level.id);
    expect(sol.loops.length - 1).toBeLessThanOrEqual(level.maxEchoes);
    const { state } = playSolution(level, sol.loops);
    expect(state.outcome).toBe('won');
    // Эталон укладывается в par (иначе «идеально» было бы недостижимо).
    expect(sol.loops.length - 1).toBeLessThanOrEqual(level.par.echoes);
    expect(state.tick).toBeLessThanOrEqual(level.par.ticks);
  });

  it('идентификаторы уникальны, миры и номера согласованы с путём', () => {
    const ids = new Set<string>();
    for (const e of entries) {
      const level = compileLevel(e.raw);
      expect(ids.has(level.id), `повтор id ${level.id}`).toBe(false);
      ids.add(level.id);
      expect(e.path).toContain(`world${level.world}/`);
    }
  });

  it('в игру попадают все уровни с эталоном', () => {
    expect(loadBuiltinLevels().length).toBe(entries.length);
  });

  it('в каждом мире есть уровни и экзамен', () => {
    const levels = loadBuiltinLevels();
    const worlds = new Set(levels.map((l) => l.world));
    for (const w of worlds) expect(levels.filter((l) => l.world === w && !l.bonus).length).toBeGreaterThan(0);
  });
});
