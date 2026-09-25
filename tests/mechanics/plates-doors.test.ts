import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run, withEchoes } from '../helpers';

describe('плиты и двери', () => {
  it('дверь открыта, пока плита нажата, и закрывается после ухода', () => {
    const lvl = mk(['#######', '#Sa.AX#', '#######']);
    const door = at(lvl, 4, 1);
    const r1 = run(createLoop(lvl, []), 'R');
    expect(r1.state.cells[door]).toBe(1);
    expect(r1.events.map((e) => e.type)).toEqual(expect.arrayContaining(['plateDown', 'doorOpen']));
    const r2 = run(r1.state, 'R');
    expect(r2.state.cells[door]).toBe(0);
    expect(r2.events.map((e) => e.type)).toEqual(expect.arrayContaining(['plateUp', 'doorClose']));
  });

  it('несколько плит одного цвета работают по ИЛИ', () => {
    const lvl = mk(['#######', '#Sa.a.#', '####A##', '####X##']);
    const door = at(lvl, 4, 2);
    expect(run(createLoop(lvl, []), 'R').state.cells[door]).toBe(1);
    expect(run(createLoop(lvl, []), 'RRR').state.cells[door]).toBe(1);
    expect(run(createLoop(lvl, []), 'RR').state.cells[door]).toBe(0);
  });

  it('дверь не закрывается, пока в проёме кто-то стоит', () => {
    const lvl = mk(['#######', '#SaA.X#', '#######']);
    const door = at(lvl, 3, 1);
    // Эхо встаёт на плиту на 1 тик и уходит; игрок стоит в проёме.
    const s = withEchoes(lvl, ['RD']);
    const r = run(s, 'RR');
    // Тик 2: игрок в проёме (3,1), эхо ушло с плиты — дверь остаётся открытой.
    expect(player(r.state).cell).toBe(door);
    expect(r.state.cells[door]).toBe(1);
  });
});

describe('инверсные двери', () => {
  it('закрываются, когда плита нажата', () => {
    const lvl = mk(['######', '#Sa1X#', '######']);
    const door = at(lvl, 3, 1);
    const s0 = createLoop(lvl, []);
    expect(s0.cells[door]).toBe(1);
    expect(run(s0, 'R').state.cells[door]).toBe(0);
  });
});

describe('плита эха и плита игрока', () => {
  const lvl = mk(['#######', '#Se.AX#', '#p.B..#', '#######'], {
    legend: {
      e: { type: 'plate', color: 'pink', filter: 'echo' },
      p: { type: 'plate', color: 'cyan', filter: 'player' },
    },
  });
  it('плита эха не реагирует на игрока', () => {
    expect(run(createLoop(lvl, []), 'R').state.cells[at(lvl, 4, 1)]).toBe(0);
    expect(run(withEchoes(lvl, ['R']), '.').state.cells[at(lvl, 4, 1)]).toBe(1);
  });
  it('плита игрока не реагирует на эхо', () => {
    expect(run(withEchoes(lvl, ['D']), '.').state.cells[at(lvl, 3, 2)]).toBe(0);
    expect(run(createLoop(lvl, []), 'D').state.cells[at(lvl, 3, 2)]).toBe(1);
  });
});
