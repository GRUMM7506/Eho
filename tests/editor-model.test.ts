import { describe, expect, it } from 'vitest';
import { compileLevel } from '../src/core/level';
import { builtinEntries } from '../src/data/levels';
import { applyTool, fromRaw, newDoc, resize, toRaw } from '../src/editor/model';

/** Уровень после круга «JSON → редактор → JSON» должен компилироваться в то же самое. */
function same(a: unknown, b: unknown): void {
  const A = compileLevel(a);
  const B = compileLevel(b);
  expect(B.width).toBe(A.width);
  expect(B.terrain).toEqual(A.terrain);
  expect(B.heights).toEqual(A.heights);
  expect(B.fixtures).toEqual(A.fixtures);
  expect(B.solidZone).toEqual(A.solidZone);
  expect(B.start).toBe(A.start);
  expect(B.startFacing).toBe(A.startFacing);
  expect(B.exit).toBe(A.exit);
  expect(B.boxes).toEqual(A.boxes);
  expect(B.items).toEqual(A.items);
  expect(B.guards).toEqual(A.guards);
  expect(B.reverseEchoes).toBe(A.reverseEchoes);
}

describe('модель редактора', () => {
  it('новый уровень компилируется', () => {
    expect(() => compileLevel(toRaw(newDoc()))).not.toThrow();
  });

  it.each(builtinEntries().map((e) => [e.path, e.raw] as const))(
    'круг сериализации без потерь: %s',
    (_p, raw) => {
      same(raw, toRaw(fromRaw(raw)));
    },
  );

  it('инструменты: единственный старт и выход, пьедестал вытесняет предмет', () => {
    const d = newDoc(7, 5);
    applyTool(d, 2 * 7 + 2, { kind: 'entity', entity: { type: 'start', facing: 'E' } });
    expect(d.cells.filter((c) => c.entity?.type === 'start')).toHaveLength(1);
    applyTool(d, 2 * 7 + 4, { kind: 'fixture', fx: { type: 'exit' } });
    expect(d.cells.filter((c) => c.fx?.type === 'exit')).toHaveLength(1);
    applyTool(d, 1 * 7 + 3, { kind: 'entity', entity: { type: 'key', color: 'pink' } });
    applyTool(d, 1 * 7 + 3, { kind: 'fixture', fx: { type: 'lever', color: 'pink' } });
    expect(d.cells[1 * 7 + 3]!.entity).toBeNull();
    expect(applyTool(d, 1 * 7 + 3, { kind: 'erase' })).toBe(true);
    expect(d.cells[1 * 7 + 3]!.fx).toBeNull();
  });

  it('изменение размера сохраняет содержимое', () => {
    const d = resize(newDoc(7, 5), 9, 6);
    expect(d.width).toBe(9);
    expect(d.cells).toHaveLength(54);
    expect(d.cells[1 * 9 + 1]!.entity?.type).toBe('start');
  });
});
