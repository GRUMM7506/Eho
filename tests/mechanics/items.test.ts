import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run, withEchoes } from '../helpers';

describe('перенос предметов: ключи и замки', () => {
  const lvl = mk(['#######', '#Sk.LX#', '#.....#', '#######'], {
    legend: {
      S: { type: 'start', facing: 'E' },
      k: { type: 'key', color: 'pink' },
      L: { type: 'lock', color: 'pink' },
    },
  });

  it('ключ поднимается, открывает замок и расходуется', () => {
    const r = run(createLoop(lvl, []), 'ERRE');
    expect(r.state.items[0]!.consumed).toBe(true);
    expect(r.state.cells[at(lvl, 4, 1)]).toBe(1);
    expect(run(r.state, 'RR').state.outcome).toBe('won');
  });

  it('замок без ключа не открыть', () => {
    const r = run(createLoop(lvl, []), 'DRRRUE');
    expect(r.state.cells[at(lvl, 4, 1)]).toBe(0);
    expect(r.state.record.endsWith('.')).toBe(true);
  });

  it('предмет кладётся перед собой, а в стену — нельзя', () => {
    const r = run(createLoop(lvl, []), 'EDRE');
    expect(r.state.items[0]!.cell).toBe(at(lvl, 3, 2));
    expect(player(r.state).carrying).toBe(-1);
    const blocked = run(createLoop(lvl, []), 'EDE');
    expect(player(blocked.state).carrying).toBe(0);
    expect(blocked.state.record).toBe('rD.');
  });

  it('эхо передаёт предмет игроку: кладёт, игрок подбирает', () => {
    const s2 = withEchoes(lvl, ['EDRE']);
    // Эхо: берёт ключ, D → (1,2), R → (2,2), E — кладёт на (3,2).
    const r = run(s2, '....');
    expect(r.state.items[0]!.cell).toBe(at(lvl, 3, 2));
    const r2 = run(r.state, 'DRE');
    // Игрок: D → (1,2), R → (2,2) (сквозь эхо), E — подбирает (3,2).
    expect(player(r2.state).carrying).toBe(0);
  });

  it('эхо, которому нечего поднять, сбивается', () => {
    const s = withEchoes(lvl, ['.E']);
    const r = run(s, 'EE');
    expect(r.state.actors[0]!.status).toBe('broken');
    expect(r.events.find((e) => e.type === 'paradox')).toMatchObject({ reason: 'nothing-to-take' });
  });
});

describe('батарейки и гнёзда', () => {
  const lvl = mk(
    ['#######', '#Sq.PA#', '#....X#', '#######'].map((r) => r),
    {
      legend: {
        S: { type: 'start', facing: 'E' },
        q: { type: 'battery' },
        P: { type: 'socket', color: 'pink' },
        A: { type: 'door', color: 'pink' },
      },
    },
  );

  it('батарейка питает гнездо, пока лежит в нём', () => {
    const r = run(createLoop(lvl, []), 'ERRE');
    expect(r.state.cells[at(lvl, 4, 1)]).toBe(1);
    expect(r.state.signals[0]).toBe(true);
    const r2 = run(r.state, 'E');
    expect(r2.state.signals[0]).toBe(false);
    expect(player(r2.state).carrying).toBe(0);
  });
});

describe('взаимодействие игрока с соседними клетками', () => {
  const lvl = mk(['######', '#S.l.#', '#...X#', '######'], {
    legend: { l: { type: 'lever', color: 'pink' } },
  });
  it('если впереди пусто, срабатывает соседний рычаг, а в запись идёт его направление', () => {
    // Игрок на (2,1) смотрит на восток после шага — рычаг прямо перед ним.
    expect(run(createLoop(lvl, []), 'RE').state.record).toBe('Rr');
    // Шаг вниз: игрок на (1,2) смотрит на юг; рычаг не рядом — ничего.
    expect(run(createLoop(lvl, []), 'DE').state.record).toBe('D.');
    // Игрок на (3,2) смотрит на восток, рычаг сверху — сработает он.
    const r = run(createLoop(lvl, []), 'DRRE');
    expect(r.state.record).toBe('DRRu');
    expect(r.state.cells[at(lvl, 3, 1)]).toBe(1);
  });
  it('копия повторяет взаимодействие строго в записанном направлении', () => {
    const s = run(withEchoes(lvl, ['DRRE']), '....').state;
    expect(s.cells[at(lvl, 3, 1)]).toBe(1);
  });
});
