import { describe, expect, it } from 'vitest';
import { createLoop, playSolution, step } from '../src/core/sim';
import { advance, canRecord, current, newSession, recordEcho, resetRoom, rewind, undoEcho } from '../src/core/session';
import { at, mk, player, run, withEchoes } from './helpers';

const corridor = mk(['#######', '#Sa.AX#', '#######']);

describe('ядро симуляции', () => {
  it('игрок ходит, упирается в стену и пишет заблокированный ход как «ничего»', () => {
    const s0 = createLoop(corridor, []);
    const r = run(s0, 'UR');
    expect(r.state.record).toBe('.R');
    expect(player(r.state).cell).toBe(at(corridor, 2, 1));
    expect(r.events.some((e) => e.type === 'bump')).toBe(true);
    // Поворот при упоре всё равно происходит.
    expect(player(run(s0, 'U').state).facing).toBe(0);
  });

  it('step — чистая функция: исходный снимок не меняется', () => {
    const s0 = createLoop(corridor, []);
    const before = JSON.stringify({ a: s0.actors, c: s0.cells, t: s0.tick });
    step(s0, 'right');
    expect(JSON.stringify({ a: s0.actors, c: s0.cells, t: s0.tick })).toBe(before);
  });

  it('детерминирована: одинаковый ввод даёт одинаковый результат', () => {
    const a = run(withEchoes(corridor, ['R']), 'RRRR').state;
    const b = run(withEchoes(corridor, ['R']), 'RRRR').state;
    expect(JSON.stringify({ ...a, level: 0 })).toBe(JSON.stringify({ ...b, level: 0 }));
  });

  it('плита держит дверь, эхо стоит на плите за игрока — победа', () => {
    const alone = run(createLoop(corridor, []), 'RRRR').state;
    expect(alone.outcome).toBe('playing');
    const s = run(withEchoes(corridor, ['R']), 'RRRR');
    expect(s.state.outcome).toBe('won');
    expect(s.events.some((e) => e.type === 'win')).toBe(true);
  });

  it('эхо повторяет запись шаг в шаг, а после её конца стоит на месте', () => {
    const s = run(withEchoes(corridor, ['R.R']), '....');
    expect(s.state.actors[0]!.cell).toBe(at(corridor, 3, 1));
  });

  it('конец времени — исход timeout', () => {
    const lvl = mk(['#####', '#S.X#', '#####'], { tickLimit: 3 });
    expect(run(createLoop(lvl, []), '...').state.outcome).toBe('timeout');
  });

  it('акторы проходят сквозь друг друга', () => {
    const lvl = mk(['######', '#S..X#', '######']);
    // Эхо стоит на клетке рядом со стартом, игрок идёт сквозь него.
    const s = run(withEchoes(lvl, ['R']), 'RRR').state;
    expect(s.outcome).toBe('won');
  });

  it('парадокс: закрытая дверь сбивает эхо, оно застывает, но продолжает нажимать плиту', () => {
    const lvl = mk(['#########', '#S..1..X#', '#a#######']);
    const s0 = withEchoes(lvl, ['RRRR']);
    const r = run(s0, 'D...');
    const echo = r.state.actors[0]!;
    expect(echo.status).toBe('broken');
    expect(echo.cell).toBe(at(lvl, 3, 1));
    expect(r.events.filter((e) => e.type === 'paradox')).toHaveLength(1);
    expect(r.state.paradoxes).toBe(1);

    // Сбитое эхо продолжает держать плиту: оно застыло на плите a, и дверь A открыта.
    const lvl2 = mk(['########', '#S.a3..#', '#c.#####', '#.A..X##', '########']);
    const r2 = run(withEchoes(lvl2, ['RRR']), 'D..DRRRR');
    expect(r2.state.actors[0]!.status).toBe('broken');
    expect(r2.state.actors[0]!.cell).toBe(at(lvl2, 3, 1));
    expect(r2.state.outcome).toBe('won');
  });

  it('старшее эхо первым: спор за предмет выигрывает старшее, младшее сбивается', () => {
    const lvl = mk(['#####', '#Sk.#', '#..X#', '#####'], {
      legend: { S: { type: 'start', facing: 'E' }, k: { type: 'key', color: 'pink' } },
    });
    const records = [
      { actions: 'r', endCell: lvl.start, endFacing: 1 as const },
      { actions: 'r', endCell: lvl.start, endFacing: 1 as const },
    ];
    const r = step(createLoop(lvl, records), 'interact');
    expect(r.state.actors[0]!.carrying).toBe(0);
    expect(r.state.actors[1]!.status).toBe('broken');
    expect(r.performed).toBe('.');
    expect(r.events.find((e) => e.type === 'paradox')).toMatchObject({ actor: 1, reason: 'nothing-to-take' });
  });

  it('воспроизведение решения', () => {
    const { state } = playSolution(corridor, ['R', 'RRRR']);
    expect(state.outcome).toBe('won');
  });
});

describe('сессия', () => {
  it('перемотка, запись, отмена эхо и сброс', () => {
    let s = newSession(corridor);
    expect(canRecord(s)).toBe(false);
    s = advance(s, 'right').session;
    s = advance(s, 'right').session;
    expect(current(s).tick).toBe(2);
    s = rewind(s);
    expect(current(s).tick).toBe(1);
    expect(s.inputs).toBe('R');
    expect(canRecord(s)).toBe(true);
    s = recordEcho(s);
    expect(s.records).toHaveLength(1);
    expect(s.echoInputs).toEqual(['R']);
    expect(current(s).tick).toBe(0);
    for (const a of ['right', 'right', 'right', 'right'] as const) s = advance(s, a).session;
    expect(current(s).outcome).toBe('won');
    s = undoEcho(s);
    expect(s.records).toHaveLength(0);
    s = recordEcho(advance(s, 'right').session);
    s = resetRoom(s);
    expect(s.records).toHaveLength(0);
  });

  it('нельзя записать больше maxEchoes', () => {
    const lvl = mk(['#####', '#S.X#', '#####'], { maxEchoes: 1 });
    let s = newSession(lvl);
    s = recordEcho(advance(s, 'none').session);
    s = recordEcho(advance(s, 'none').session);
    expect(s.records).toHaveLength(1);
  });
});
