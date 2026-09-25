import { describe, expect, it } from 'vitest';
import { continueLevel, isLevelUnlocked, nextLevel, worlds } from '../src/data/progress';
import { defaultSave, defaultSettings, recordResult } from '../src/data/save';
import { mk } from './helpers';

function lvl(world: number, index: number, bonus = false, starsRequired = 0) {
  return { ...mk(['#####', '#S.X#', '#####']), id: `w${world}-${bonus ? 'b' : ''}${index}`, world, index, bonus, starsRequired };
}

const levels = [lvl(0, 1), lvl(0, 2), lvl(1, 1), lvl(1, 2), lvl(1, 1, true, 5)];
const fresh = () => defaultSave(defaultSettings({ reducedMotion: false, language: 'ru', touch: false }));

describe('прогресс', () => {
  it('мир 0 открыт, следующий — после экзамена', () => {
    const s = fresh();
    expect(worlds(levels, s).map((w) => w.unlocked)).toEqual([true, false, false, false, false, false]);
    recordResult(s, 'w0-1', 3, 0, 5, true);
    expect(worlds(levels, s)[1]!.unlocked).toBe(false);
    recordResult(s, 'w0-2', 3, 0, 5, true);
    expect(worlds(levels, s)[1]!.unlocked).toBe(true);
  });

  it('уровни внутри мира открываются последовательно', () => {
    const s = fresh();
    expect(isLevelUnlocked(levels, s, levels[0]!)).toBe(true);
    expect(isLevelUnlocked(levels, s, levels[1]!)).toBe(false);
    recordResult(s, 'w0-1', 1, 0, 5, false);
    expect(isLevelUnlocked(levels, s, levels[1]!)).toBe(true);
  });

  it('бонусные уровни открываются за звёзды', () => {
    const s = fresh();
    recordResult(s, 'w0-1', 3, 0, 5, true);
    recordResult(s, 'w0-2', 1, 0, 5, false);
    expect(isLevelUnlocked(levels, s, levels[4]!)).toBe(false);
    recordResult(s, 'w1-1', 1, 0, 5, false);
    expect(isLevelUnlocked(levels, s, levels[4]!)).toBe(true);
  });

  it('«Дальше» и «Продолжить»', () => {
    const s = fresh();
    expect(continueLevel(levels, s)!.id).toBe('w0-1');
    recordResult(s, 'w0-1', 1, 0, 5, false);
    expect(nextLevel(levels, s, levels[0]!)!.id).toBe('w0-2');
    recordResult(s, 'w0-2', 1, 0, 5, false);
    expect(nextLevel(levels, s, levels[1]!)!.id).toBe('w1-1');
    expect(continueLevel(levels, s)!.id).toBe('w1-1');
  });
});
