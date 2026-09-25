import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, run, withEchoes } from '../helpers';

const mirrorLevel = mk(['#########', '#S.....X#', '#.l.....#', '#e..m...#', '#.......#', '#########'], {
  legend: {
    e: { type: 'emitter', dir: 'E' },
    m: { type: 'mirror', orient: '/', color: 'pink' },
    l: { type: 'lever', color: 'pink' },
  },
});

describe('лазеры и зеркала', () => {
  it('луч отражается зеркалом и убивает настоящего игрока', () => {
    const s0 = createLoop(mirrorLevel, []);
    expect(s0.beams[0]!.cells).toEqual([
      at(mirrorLevel, 2, 3),
      at(mirrorLevel, 3, 3),
      at(mirrorLevel, 4, 3),
      at(mirrorLevel, 4, 2),
      at(mirrorLevel, 4, 1),
      at(mirrorLevel, 4, 0),
    ]);
    const r = run(s0, 'RRR');
    expect(r.state.outcome).toBe('dead');
    expect(r.state.deathCause).toBe('laser');
    expect(r.events.some((e) => e.type === 'death')).toBe(true);
  });

  it('рычаг поворачивает зеркало', () => {
    const r = run(createLoop(mirrorLevel, []), 'RDERRRRR');
    expect(r.state.outcome).toBe('won');
  });

  it('копия блокирует луч и не погибает', () => {
    const s = withEchoes(mirrorLevel, ['RRRD']);
    const r = run(s, 'RRRRRR');
    expect(r.state.outcome).toBe('won');
    expect(r.state.actors[0]!.status).toBe('ok');
  });

  it('приёмник под лучом даёт сигнал, копия может его заслонить', () => {
    const lvl = mk(['########', '#S...AX#', '#......#', '#e....r#', '########'], {
      legend: { e: { type: 'emitter', dir: 'E' }, r: { type: 'receiver', color: 'pink' } },
    });
    const door = at(lvl, 5, 1);
    expect(createLoop(lvl, []).cells[door]).toBe(1);
    expect(run(createLoop(lvl, []), 'RRRRR').state.outcome).toBe('won');
    const blocked = run(withEchoes(lvl, ['RRDD']), '....').state;
    expect(blocked.cells[door]).toBe(0);
    expect(blocked.beams[0]!.end).toBe('echo');
  });
});
