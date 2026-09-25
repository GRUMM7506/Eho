import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run, withEchoes } from '../helpers';

describe('таймерные двери', () => {
  const lvl = mk(['######', '#S.TX#', '######'], { legend: { T: { type: 'timerDoor', from: 3, to: 4 } } });
  const door = at(lvl, 3, 1);
  it('открыты только в своём окне тиков', () => {
    expect(run(createLoop(lvl, []), '.').state.cells[door]).toBe(0);
    expect(run(createLoop(lvl, []), '...').state.cells[door]).toBe(1);
    expect(run(createLoop(lvl, []), '.....').state.cells[door]).toBe(0);
    expect(run(createLoop(lvl, []), 'R..RR').state.outcome).toBe('won');
    expect(player(run(createLoop(lvl, []), 'RR').state).cell).toBe(at(lvl, 2, 1));
    expect(run(createLoop(lvl, []), 'R....RR').state.outcome).toBe('playing');
  });
});

describe('твёрдое эхо', () => {
  const flat = mk(['#######', '#S.::X#', '#.....#', '#######']);

  it('в особой зоне копия — препятствие', () => {
    const s = withEchoes(flat, ['RR']);
    const r = run(s, '..RR');
    expect(player(r.state).cell).toBe(at(flat, 2, 1));
  });

  it('вне зоны копия проходима', () => {
    const s = withEchoes(flat, ['R']);
    expect(run(s, '.RR').state.actors[1]!.cell).toBe(at(flat, 3, 1));
  });

  it('заблокированная твёрдой копией младшая копия получает парадокс', () => {
    const end = at(flat, 3, 1);
    const s = createLoop(flat, [
      { actions: 'RR', endCell: end, endFacing: 1 },
      { actions: '..RR', endCell: end, endFacing: 1 },
    ]);
    const r = run(s, '....');
    expect(r.state.actors[1]!.status).toBe('broken');
  });

  it('на твёрдое эхо можно встать', () => {
    const lvl = mk(['#######', '#S.:.X#', '#.=.###', '#######'], {
      heights: ['0000000', '0110110', '0110000', '0000000'],
    });
    expect(run(createLoop(lvl, []), 'RRRR').state.outcome).toBe('playing');
    const s = withEchoes(lvl, ['DRRU']);
    const r = run(s, '....RRRR');
    expect(r.events.some((e) => e.type === 'ride')).toBe(true);
    expect(r.state.outcome).toBe('won');
  });
});

describe('высота', () => {
  it('шаг на соседний этаж — только по лестнице', () => {
    const lvl = mk(['#######', '#S.=.X#', '#.....#', '#######'], {
      heights: ['0000000', '0001110', '0111110', '0000000'],
    });
    expect(run(createLoop(lvl, []), 'RRRR').state.outcome).toBe('won');
    // Мимо лестницы по нижнему ряду: (1,2) выше на этаж — нельзя.
    expect(player(run(createLoop(lvl, []), 'D').state).cell).toBe(lvl.start);
  });

  it('лифт поднимается, пока нажата плита', () => {
    const lvl = mk(['#######', '#S.LX##', '#a#####', '#######'], {
      legend: { L: { type: 'lift', color: 'pink', low: 0, high: 1 } },
      heights: ['0000000', '0000100', '0000000', '0000000'],
    });
    // Без эхо: лифт внизу, на выход (этаж 1) не подняться.
    expect(run(createLoop(lvl, []), 'RRRR').state.outcome).toBe('playing');
    const s = withEchoes(lvl, ['..D']);
    const r = run(s, 'RR.R');
    expect(r.events.some((e) => e.type === 'liftMove')).toBe(true);
    expect(r.state.outcome).toBe('won');
  });
});

describe('обратное эхо', () => {
  it('стартует там, где закончило, и идёт к началу', () => {
    const lvl = mk(['#######', '#S...X#', '#######'], { reverseEchoes: true });
    const s = withEchoes(lvl, ['RR']);
    expect(s.actors[0]!.cell).toBe(at(lvl, 3, 1));
    const r1 = run(s, '.');
    expect(r1.state.actors[0]!.cell).toBe(at(lvl, 2, 1));
    const r2 = run(r1.state, '..');
    expect(r2.state.actors[0]!.cell).toBe(at(lvl, 1, 1));
  });
});
