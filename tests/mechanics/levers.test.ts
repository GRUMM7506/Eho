import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run, withEchoes } from '../helpers';

const lvl = mk(['######', '#Sl.A#', '#...X#', '######'], {
  legend: { l: { type: 'lever', color: 'pink' }, S: { type: 'start', facing: 'E' } },
});

describe('рычаги', () => {
  it('переключаются взаимодействием и держат состояние', () => {
    const lever = at(lvl, 2, 1);
    const door = at(lvl, 4, 1);
    const r = run(createLoop(lvl, []), 'E...');
    expect(r.state.cells[lever]).toBe(1);
    expect(r.state.cells[door]).toBe(1);
    expect(r.events.some((e) => e.type === 'lever')).toBe(true);
    expect(run(r.state, 'E').state.cells[lever]).toBe(0);
  });

  it('рычаг непроходим, а в начале петли сбрасывается', () => {
    expect(player(run(createLoop(lvl, []), 'R').state).cell).toBe(lvl.start);
    const s = withEchoes(lvl, ['E']);
    expect(s.cells[at(lvl, 2, 1)]).toBe(0);
  });

  it('поворот упором в рычаг, затем взаимодействие', () => {
    const r = run(createLoop(lvl, []), 'DRUE');
    // D → (1,2), R → (2,2), U → упор в рычаг (2,1): поворот на север, E — переключение.
    expect(r.state.record).toBe('DR.u');
    expect(r.state.cells[at(lvl, 2, 1)]).toBe(1);
  });

  it('эхо повторяет переключение рычага', () => {
    const s = run(withEchoes(lvl, ['E']), '.').state;
    expect(s.cells[at(lvl, 2, 1)]).toBe(1);
  });
});
