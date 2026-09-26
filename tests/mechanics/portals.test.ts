import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run } from '../helpers';

const legend = { P: { type: 'portal' as const, color: 'cyan' as const } };

describe('порталы (проходные)', () => {
  it('вошедший выходит на клетку за парным порталом, направление сохраняется', () => {
    const lvl = mk(['#########', '#SP##P..#', '######.X#', '#########'], { legend });
    const r = run(createLoop(lvl, []), 'R');
    expect(player(r.state).cell).toBe(at(lvl, 6, 1));
    expect(player(r.state).facing).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['step', 'teleport', 'slide']));
    expect(run(r.state, 'RD').state.outcome).toBe('won');
  });

  it('работает в обе стороны', () => {
    const lvl = mk(['#########', '#.SP##P.#', '#.....#X#', '#########'], { legend });
    // Вход в левый портал слева направо — выход справа от правого.
    expect(player(run(createLoop(lvl, []), 'R').state).cell).toBe(at(lvl, 7, 1));
    // Обратно: вход в правый портал справа налево — выход слева от левого.
    expect(player(run(createLoop(lvl, []), 'RL').state).cell).toBe(at(lvl, 2, 1));
  });

  it('ящик проходит через портал и может засыпать яму на выходе', () => {
    const lvl = mk(['##########', '#SoP##P_.#', '#.......X#', '##########'], { legend });
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.boxes[0]).toBe(-1);
    expect(r.events.some((e) => e.type === 'boxFill')).toBe(true);
    // Засыпанная яма — пол: теперь проходим сами.
    expect(player(run(r.state, 'R').state).cell).toBe(at(lvl, 7, 1));
  });

  it('занятый выход блокирует вход', () => {
    const lvl = mk(['#########', '#S.P##Po#', '#......X#', '#########'], { legend });
    const r = run(createLoop(lvl, []), 'RR');
    expect(player(r.state).cell).toBe(at(lvl, 2, 1));
    expect(r.state.record).toBe('R.');
  });

  it('копия на выходе не мешает (акторы проходят сквозь друг друга)', () => {
    const lvl = mk(['##########', '#S.P##P..#', '#.......X#', '##########'], { legend });
    const s = run(createLoop(lvl, []), 'RR').state;
    expect(player(s).cell).toBe(at(lvl, 7, 1));
  });
});
