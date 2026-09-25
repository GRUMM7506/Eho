import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run, withEchoes } from '../helpers';

describe('конвейеры', () => {
  it('сдвигают стоящего актора на 1 клетку в конце тика', () => {
    const lvl = mk(['#######', '#S>..X#', '#######']);
    const r = run(createLoop(lvl, []), 'R');
    expect(player(r.state).cell).toBe(at(lvl, 3, 1));
    expect(r.events.some((e) => e.type === 'conveyor')).toBe(true);
  });

  it('сдвигают ящики', () => {
    const lvl = mk(['#######', '#So>..#', '#....X#', '#######']);
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.boxes[0]).toBe(at(lvl, 4, 1));
  });

  it('не сдвигают в стену', () => {
    const lvl = mk(['#####', '#S>#', '#.X#', '####'].map((r) => r.padEnd(5, '#')));
    const r = run(createLoop(lvl, []), 'R.');
    expect(player(r.state).cell).toBe(at(lvl, 2, 1));
  });

  it('эхо на конвейере: запись действий, а не позиций', () => {
    const lvl = mk(['########', '#S>...X#', '########']);
    const s = run(withEchoes(lvl, ['R']), '..').state;
    expect(s.actors[0]!.cell).toBe(at(lvl, 3, 1));
  });
});

describe('лёд', () => {
  it('скольжение до препятствия одним действием', () => {
    const lvl = mk(['########', '#S~~~.#', '#....X#', '########'].map((r) => r.padEnd(8, '#')));
    const r = run(createLoop(lvl, []), 'R');
    expect(player(r.state).cell).toBe(at(lvl, 5, 1));
    expect(r.state.record).toBe('R');
    expect(r.events.filter((e) => e.type === 'slide')).toHaveLength(3);
  });

  it('скольжение останавливается перед ящиком', () => {
    const lvl = mk(['########', '#S~~o.#', '#....X#', '########'].map((r) => r.padEnd(8, '#')));
    const r = run(createLoop(lvl, []), 'R');
    expect(player(r.state).cell).toBe(at(lvl, 3, 1));
    expect(r.state.boxes[0]).toBe(at(lvl, 4, 1));
  });

  it('ящик скользит по льду', () => {
    const lvl = mk(['########', '#So~~.#', '#....X#', '########'].map((r) => r.padEnd(8, '#')));
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.boxes[0]).toBe(at(lvl, 5, 1));
  });
});

describe('хрупкий пол', () => {
  it('после N уходов становится ямой', () => {
    const lvl = mk(['######', '#S%.X#', '######'], { legend: { '%': { type: 'fragile', durability: 2 } } });
    const f = at(lvl, 2, 1);
    let r = run(createLoop(lvl, []), 'RR');
    expect(r.state.cells[f]).toBe(1);
    r = run(r.state, 'LL');
    // Второй уход — плитка рухнула.
    expect(r.state.cells[f]).toBe(100);
    expect(r.events.some((e) => e.type === 'break')).toBe(true);
    const back = run(r.state, 'R');
    expect(player(back.state).cell).toBe(lvl.start);
  });

  it('не рушится, пока на ней кто-то стоит', () => {
    const lvl = mk(['######', '#S%.X#', '######']);
    const s = run(withEchoes(lvl, ['R']), 'RR').state;
    // Эхо стоит на хрупкой клетке; игрок ушёл с неё — плитка ждёт.
    expect(s.cells[at(lvl, 2, 1)]).toBe(1);
  });

  it('эхо, чей путь провалился, сбивается', () => {
    const lvl = mk(['#######', '#S%..X#', '#.....#', '#######']);
    const s = withEchoes(lvl, ['..RR']);
    const r = run(s, 'RD..');
    expect(r.state.actors[0]!.status).toBe('broken');
  });
});
