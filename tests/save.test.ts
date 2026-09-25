import { describe, expect, it } from 'vitest';
import { defaultSave, defaultSettings, loadSave, migrate, recordResult, writeSave } from '../src/data/save';
import { MemoryKV } from '../src/data/storage';

const defaults = defaultSettings({ reducedMotion: false, language: 'ru', touch: false });

describe('сохранения', () => {
  it('мусор и пустота дают сохранение по умолчанию', () => {
    expect(migrate(null, defaults)).toEqual(defaultSave(defaults));
    expect(migrate('x', defaults).version).toBe(3);
  });

  it('миграция прогресса прототипа (v1)', () => {
    const s = migrate({ 0: 3, 1: 2, 2: 0 }, defaults);
    expect(s.levels['w1-1']).toMatchObject({ completed: true, stars: 3 });
    expect(s.levels['w1-2']).toMatchObject({ completed: true, stars: 2 });
    expect(s.levels['w1-3']).toBeUndefined();
  });

  it('миграция v2: недостающие поля и клавиши добавляются', () => {
    const s = migrate(
      { version: 2, levels: { 'w0-1': { completed: true, stars: 2, bestEchoes: 0, bestTicks: 9 } }, settings: { volumeMusic: 0.3, keymap: { up: ['KeyI'] } } },
      defaults,
    );
    expect(s.levels['w0-1']!.perfect).toBe(false);
    expect(s.settings.volumeMusic).toBe(0.3);
    expect(s.settings.keymap.up).toEqual(['KeyI']);
    expect(s.settings.keymap.down).toEqual(defaults.keymap.down);
  });

  it('неверные типы значений отбрасываются', () => {
    const s = migrate({ version: 3, settings: { volumeMaster: 'loud', tickSpeed: 5, colorblind: true }, levels: { a: 5 } }, defaults);
    expect(s.settings.volumeMaster).toBe(defaults.volumeMaster);
    expect(s.settings.colorblind).toBe(true);
    expect(s.levels).toEqual({});
  });

  it('лучшие результаты сохраняются', () => {
    const d = defaultSave(defaults);
    expect(recordResult(d, 'x', 2, 3, 20, false)).toBe(true);
    expect(recordResult(d, 'x', 1, 4, 10, false)).toBe(true);
    expect(d.levels.x).toMatchObject({ stars: 2, bestEchoes: 3, bestTicks: 10 });
    expect(recordResult(d, 'x', 1, 5, 40, false)).toBe(false);
    expect(recordResult(d, 'x', 3, 2, 30, true)).toBe(true);
    expect(d.levels.x).toMatchObject({ stars: 3, bestEchoes: 2, bestTicks: 10, perfect: true });
  });

  it('запись и чтение через хранилище, повреждённые данные не ломают загрузку', () => {
    const kv = new MemoryKV();
    const d = defaultSave(defaults);
    recordResult(d, 'w0-1', 3, 0, 8, true);
    writeSave(kv, d);
    expect(loadSave(kv, defaults).levels['w0-1']!.stars).toBe(3);
    kv.set('echo-save', '{broken');
    expect(loadSave(kv, defaults).levels).toEqual({});
  });
});
