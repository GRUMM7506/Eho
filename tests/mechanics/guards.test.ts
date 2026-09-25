import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, run, withEchoes } from '../helpers';

describe('стражи', () => {
  const watch = mk(['##########', '#S......X#', '#........#', '#....g...#', '##########'], {
    legend: { g: { type: 'guard', facing: 'N', range: 4 } },
  });

  it('видят игрока по прямой и ловят его', () => {
    const r = run(createLoop(watch, []), 'RRRR');
    expect(r.state.outcome).toBe('dead');
    expect(r.state.deathCause).toBe('guard');
  });

  it('не замечают эхо, а эхо заслоняет обзор', () => {
    // Записавший эхо погиб на (5,2), но его копия там и стоит — между стражем и коридором.
    const s = withEchoes(watch, ['DRRRR']);
    expect(s.actors[0]!.status).toBe('ok');
    const r = run(s, '.....RRRRRRR');
    expect(r.state.outcome).toBe('won');
  });

  it('ходят по маршруту по кругу', () => {
    const lvl = mk(['#######', '#S...X#', '#g....#', '#######'], {
      legend: { g: { type: 'guard', route: 'RRLL', facing: 'E', range: 0 } },
    });
    const cells = [1, 2, 3, 4, 5].map((n) => run(createLoop(lvl, []), '.'.repeat(n)).state.guards[0]!.cell);
    expect(cells).toEqual([at(lvl, 2, 2), at(lvl, 3, 2), at(lvl, 2, 2), at(lvl, 1, 2), at(lvl, 2, 2)]);
  });

  it('страж-приманка идёт к ближайшему эхо', () => {
    const lvl = mk(['#########', '#S......#', '#.......#', '#......gX', '#########'].map((r) => r.padEnd(9, '#')), {
      legend: { g: { type: 'guard', mode: 'lure', facing: 'W', range: 2 } },
    });
    const s = withEchoes(lvl, ['DD']);
    const r = run(s, '...');
    expect(r.state.guards[0]!.cell).toBeLessThan(at(lvl, 7, 3));
  });

  it('ловит при встречном обмене клетками', () => {
    const lvl = mk(['######', '#S.gX#', '######'], {
      legend: { g: { type: 'guard', route: 'L', facing: 'W', range: 0 } },
    });
    // Страж шагает на (2,1), игрок — на (2,1): страж стоит в клетке игрока.
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.outcome).toBe('dead');
  });
});
