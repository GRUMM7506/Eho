import { DIRS, decodeRec, encodeRec, invertRec } from './grid';
import { HOOKS } from './mechanics';
import { interact, moveMover, ownerOf } from './rules';
import type { Action, ActorState, EchoRecord, Level, RecChar, StepResult, WorldState } from './types';
import { emit, freeze, markParadox, playerIndex, solidEchoAt, toDraft, type Draft } from './world';

/** Начальный снимок петли: все эхо и игрок на старте (обратные эхо — там, где закончили запись). */
export function createLoop(level: Level, records: readonly EchoRecord[]): WorldState {
  const actors: ActorState[] = records.map((r, echo) => ({
    kind: 'echo',
    echo,
    cell: level.reverseEchoes ? r.endCell : level.start,
    facing: level.reverseEchoes ? r.endFacing : level.startFacing,
    carrying: -1,
    status: 'ok',
    riding: false,
    brokenAt: -1,
  }));
  actors.push({
    kind: 'player',
    echo: -1,
    cell: level.start,
    facing: level.startFacing,
    carrying: -1,
    status: 'ok',
    riding: false,
    brokenAt: -1,
  });
  const cells = level.fixtures.map((fx, cell) => (fx ? (ownerOf(fx.type)?.initCell?.(level, cell) ?? 0) : 0));
  const base: WorldState = {
    level,
    records,
    tick: 0,
    actors,
    boxes: level.boxes.slice(),
    items: level.items.map((it) => ({ kind: it.kind, color: it.color, cell: it.cell, carrier: -1, consumed: false })),
    cells,
    guards: level.guards.map((g) => ({ cell: g.cell, facing: g.facing, routeIdx: 0 })),
    signals: [false, false, false, false],
    beams: [],
    outcome: 'playing',
    deathCause: null,
    record: '',
    paradoxes: 0,
  };
  // Начальное состояние механизмов (плиты под стартом, двери, лучи) без событий.
  const d = toDraft(base);
  resolveSignals(d);
  d.events.length = 0;
  return { ...freeze(d, 'playing', ''), cells: d.cells };
}

/** Действие эхо на тике `t`: вперёд по записи или, в режиме обратного эхо, с конца к началу. */
export function echoAction(state: WorldState, echo: number, t: number): RecChar {
  const rec = state.records[echo];
  if (!rec || t >= rec.actions.length) return '.';
  if (state.level.reverseEchoes) return invertRec(rec.actions[rec.actions.length - 1 - t]);
  return decodeRec(rec.actions[t]).kind === 'none' ? '.' : (rec.actions[t] as RecChar);
}

function playerIntent(p: ActorState, action: Action): RecChar {
  switch (action) {
    case 'up':
      return 'U';
    case 'right':
      return 'R';
    case 'down':
      return 'D';
    case 'left':
      return 'L';
    case 'interact':
      return encodeRec('use', p.facing);
    default:
      return '.';
  }
}

/** Фаза 5: сигналы → двери и лифты, дважды (лучи зависят от дверей, приёмники — от лучей). */
function resolveSignals(d: Draft): void {
  for (let pass = 0; pass < 2; pass++) {
    const sig = [false, false, false, false];
    for (const f of HOOKS.emitSignals) f(d, sig);
    d.signals = sig;
    for (const f of HOOKS.applySignals) f(d, sig);
  }
  for (const f of HOOKS.finalize) f(d);
}

/** Стоящие на крыше твёрдого эхо спрыгивают, если эхо под ними ушло. */
function settleRiders(d: Draft): void {
  d.actors.forEach((a, i) => {
    if (a.riding && solidEchoAt(d, a.cell, i) < 0) {
      a.riding = false;
      emit(d, { type: 'drop-down', actor: i, cell: a.cell });
    }
  });
}

/**
 * Один тик симуляции. Чистая функция: исходный снимок не меняется.
 *
 * Порядок фаз тика (фиксирован):
 *  1. Собрать намерения всех акторов: эхо по возрасту (старшее первым), игрок последним.
 *  2–4. Разрешить действия акторов строго в этом порядке приоритета. Для каждого:
 *     2) проверка хода по состоянию мира на начало тика — двери, лифты, замки, пьедесталы,
 *        порталы (занятый выход), высоты, твёрдые эхо;
 *     3) толкание ящика и взаимодействие с предметами/рычагами (старшее эхо первым,
 *        поэтому при споре за предмет выигрывает оно);
 *     4) перемещение, уход с клетки (хрупкий пол), вход: телепорт, скольжение по льду, засыпание ямы.
 *     Невозможное записанное действие эхо — парадокс: эхо застывает, но продолжает занимать клетку.
 *     Хвост фазы 4: конвейеры сдвигают стоящих, затем ходят стражи, наездники спрыгивают с ушедших эхо.
 *  5. Пересчитать плиты, рычаги, гнёзда, лучи и приёмники → сигналы → двери, таймерные двери, лифты
 *     (дверь не закрывается, если в проёме кто-то стоит); рушится хрупкий пол.
 *  6. Проверить смерть игрока (лазер, страж), победу (игрок на выходе) и конец времени.
 */
export function step(state: WorldState, playerAction: Action): StepResult {
  if (state.outcome !== 'playing') return { state, events: [], performed: '.' };
  const d = toDraft(state);
  const t = state.tick;
  d.tick = t + 1;
  const pi = playerIndex(d);

  // Фаза 1.
  const intents: RecChar[] = d.actors.map((a, i) =>
    i === pi ? playerIntent(a, playerAction) : a.status === 'ok' ? echoAction(state, i, t) : '.',
  );

  // Фазы 2–4.
  let performed: RecChar = '.';
  for (let i = 0; i < d.actors.length; i++) {
    const a = d.actors[i]!;
    if (a.status !== 'ok') continue;
    const intent = intents[i]!;
    const r = decodeRec(intent);
    if (r.kind === 'none') continue;
    a.facing = r.dir;
    let ok: boolean;
    let done: RecChar = intent;
    if (r.kind === 'move') ok = moveMover(d, { kind: 'actor', index: i }, r.dir, true, 'step');
    else if (i === pi) {
      // Игрок: цель взаимодействия ищется вокруг. Порядок: клетка перед собой, затем соседние.
      // С предметом в руках сперва пробуем «использовать» (гнездо, замок) во всех направлениях,
      // и только если некуда — кладём перед собой. В запись идёт фактическое направление.
      const carrying = a.carrying >= 0;
      ok = false;
      d.noDrop = carrying;
      for (const dir of [r.dir, ...DIRS.filter((x) => x !== r.dir)]) {
        a.facing = dir;
        if (interact(d, i)) {
          ok = true;
          done = encodeRec('use', dir);
          break;
        }
      }
      d.noDrop = false;
      if (!ok && carrying) {
        a.facing = r.dir;
        ok = interact(d, i);
        done = intent;
      }
      if (!ok) a.facing = r.dir;
    } else ok = interact(d, i);
    if (i === pi) {
      performed = ok ? done : '.';
      if (!ok && r.kind === 'move') emit(d, { type: 'bump', actor: i, cell: a.cell });
    } else if (!ok) {
      const reason = r.kind === 'move' ? 'blocked' : a.carrying >= 0 ? 'cannot-place' : 'nothing-to-take';
      markParadox(d, i, reason);
    }
  }
  for (const f of HOOKS.afterMoves) f(d);
  settleRiders(d);

  // Фаза 5.
  resolveSignals(d);

  // Фаза 6.
  for (const f of HOOKS.check) f(d);
  const p = d.actors[pi]!;
  let outcome: WorldState['outcome'] = 'playing';
  if (p.status === 'dead') outcome = 'dead';
  else if (p.cell === d.level.exit && !p.riding) {
    outcome = 'won';
    emit(d, { type: 'win', cell: p.cell });
  } else if (d.tick >= d.level.tickLimit) {
    outcome = 'timeout';
    emit(d, { type: 'timeout' });
  }
  return { state: freeze(d, outcome, state.record + performed), events: d.events, performed };
}

/** Запись текущей попытки игрока как нового эхо. */
export function recordOf(state: WorldState): EchoRecord {
  const p = state.actors[state.actors.length - 1]!;
  return { actions: state.record, endCell: p.cell, endFacing: p.facing };
}

/**
 * Ввод игрока в компактной форме (для решений и повторов): `.` — ждать, `U R D L` — ход, `E` — взаимодействие.
 * В отличие от записи эхо, здесь хранится именно нажатое, а не выполненное.
 */
export const INPUT_CHARS: Readonly<Record<Action, string>> = {
  none: '.',
  up: 'U',
  right: 'R',
  down: 'D',
  left: 'L',
  interact: 'E',
};

export function inputToAction(c: string): Action {
  switch (c) {
    case 'U':
      return 'up';
    case 'R':
      return 'right';
    case 'D':
      return 'down';
    case 'L':
      return 'left';
    case 'E':
      return 'interact';
    default:
      return 'none';
  }
}

/** Прогнать строку ввода с начала петли. */
export function runInputs(level: Level, records: readonly EchoRecord[], inputs: string): WorldState {
  let s = createLoop(level, records);
  for (const c of inputs) {
    if (s.outcome !== 'playing') break;
    s = step(s, inputToAction(c)).state;
  }
  return s;
}

/**
 * Проиграть решение целиком: каждая строка, кроме последней, — петля, записанная как эхо;
 * последняя — финальный проход игрока.
 */
export function playSolution(level: Level, loops: readonly string[]): { state: WorldState; records: EchoRecord[] } {
  const records: EchoRecord[] = [];
  let state = createLoop(level, records);
  loops.forEach((inputs, i) => {
    state = runInputs(level, records, inputs);
    if (i < loops.length - 1) records.push(recordOf(state));
  });
  return { state, records };
}
