import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run } from '../helpers';

const legend = { P: { type: 'portal' as const, color: 'cyan' as const } };

describe('порталы', () => {
  it('вход в портал переносит на парный, направление сохраняется', () => {
    const lvl = mk(['########', '#SP##P.#', '#####.X#', '########'], { legend });
    const r = run(createLoop(lvl, []), 'R');
    expect(player(r.state).cell).toBe(at(lvl, 5, 1));
    expect(player(r.state).facing).toBe(1);
    expect(r.events.some((e) => e.type === 'teleport')).toBe(true);
    expect(run(r.state, 'RD').state.outcome).toBe('won');
  });

  it('прибытие через портал не телепортирует обратно, шаг с него — обычный', () => {
    const lvl = mk(['########', '#SP##P.#', '#####.X#', '########'], { legend });
    const r = run(createLoop(lvl, []), 'RL');
    // С (5,1) шаг на запад упирается в стену.
    expect(player(r.state).cell).toBe(at(lvl, 5, 1));
  });

  it('работает для ящиков', () => {
    const lvl = mk(['#########', '#SoP##P.#', '#......X#', '#########'], { legend });
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.boxes[0]).toBe(at(lvl, 6, 1));
  });

  it('занятый выход блокирует вход', () => {
    // На выходном портале Q стоит ящик.
    const lvl = mk(['#########', '#S.P##Q.#', '#......X#', '#########'], {
      legend: { P: { type: 'portal', color: 'cyan' }, Q: [{ type: 'portal', color: 'cyan' }, { type: 'box' }] },
    });
    const r = run(createLoop(lvl, []), 'RR');
    expect(player(r.state).cell).toBe(at(lvl, 2, 1));
    expect(r.state.record).toBe('R.');
  });
});
