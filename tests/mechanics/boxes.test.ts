import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/sim';
import { at, mk, player, run } from '../helpers';

describe('ящики', () => {
  it('толкается один ящик, если за ним свободно', () => {
    const lvl = mk(['#######', '#So..X#', '#######']);
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.boxes[0]).toBe(at(lvl, 3, 1));
    expect(player(r.state).cell).toBe(at(lvl, 2, 1));
    expect(r.events.some((e) => e.type === 'push')).toBe(true);
  });

  it('два ящика подряд не толкаются', () => {
    const lvl = mk(['#######', '#Soo.X#', '#######']);
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.boxes).toEqual([at(lvl, 2, 1), at(lvl, 3, 1)]);
    expect(r.state.record).toBe('.');
  });

  it('ящик в стену не толкается', () => {
    const lvl = mk(['#####', '#So#', '#X.#', '####'].map((r) => r.padEnd(5, '#')));
    const r = run(createLoop(lvl, []), 'R');
    expect(r.state.boxes[0]).toBe(at(lvl, 2, 1));
  });

  it('ящик на плите держит её', () => {
    const lvl = mk(['########', '#Soa.AX#', '########']);
    const r = run(createLoop(lvl, []), 'RR');
    expect(r.state.cells[at(lvl, 5, 1)]).toBe(1);
  });

  it('ящик в проёме не даёт двери закрыться', () => {
    const lvl = mk(['########', '#SaoA.X#', '########']);
    // Игрок на плите → дверь открыта; толкаем ящик в проём и уходим с плиты — дверь остаётся открытой.
    const r = run(createLoop(lvl, []), 'RR');
    expect(r.state.boxes[0]).toBe(at(lvl, 4, 1));
    expect(r.state.cells[at(lvl, 4, 1)]).toBe(1);
  });

  it('ящик засыпает яму и становится полом', () => {
    const lvl = mk(['#######', '#So_.X#', '#######']);
    const r = run(createLoop(lvl, []), 'RRRR');
    expect(r.state.boxes[0]).toBe(-1);
    expect(r.events.some((e) => e.type === 'boxFill')).toBe(true);
    expect(r.state.outcome).toBe('won');
  });

  it('в яму актор не входит', () => {
    const lvl = mk(['######', '#S_.X#', '######']);
    expect(player(run(createLoop(lvl, []), 'R').state).cell).toBe(lvl.start);
  });
});
