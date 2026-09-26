import { createLoop, INPUT_CHARS, recordOf, step } from './sim';
import type { Action, EchoRecord, Level, SimEvent, WorldState } from './types';

/**
 * Сессия прохождения комнаты: записанные эхо и история текущей петли.
 * Неизменяемая: каждое действие возвращает новую сессию. Перемотка — просто отбросить снимок.
 */
export interface Session {
  readonly level: Level;
  readonly records: readonly EchoRecord[];
  /** Ввод каждой записанной петли (для повторов и эталонных решений). */
  readonly echoInputs: readonly string[];
  /** Снимки текущей петли: [начальный, после тика 1, …]. */
  readonly history: readonly WorldState[];
  /** Ввод текущей петли. */
  readonly inputs: string;
  readonly paradoxes: number;
  readonly loops: number;
}

export function newSession(
  level: Level,
  records: readonly EchoRecord[] = [],
  echoInputs: readonly string[] = [],
): Session {
  return {
    level,
    records,
    echoInputs,
    history: [createLoop(level, records)],
    inputs: '',
    paradoxes: 0,
    loops: 1,
  };
}

export function current(s: Session): WorldState {
  return s.history[s.history.length - 1]!;
}

export interface AdvanceResult {
  readonly session: Session;
  readonly events: readonly SimEvent[];
}

export function advance(s: Session, action: Action): AdvanceResult {
  const cur = current(s);
  if (cur.outcome !== 'playing') return { session: s, events: [] };
  const r = step(cur, action);
  const newParadoxes = r.events.filter((e) => e.type === 'paradox').length;
  return {
    session: {
      ...s,
      history: [...s.history, r.state],
      inputs: s.inputs + INPUT_CHARS[action],
      paradoxes: s.paradoxes + newParadoxes,
    },
    events: r.events,
  };
}

/** Шаг назад в текущей петле. */
export function rewind(s: Session): Session {
  if (s.history.length <= 1) return s;
  return { ...s, history: s.history.slice(0, -1), inputs: s.inputs.slice(0, -1) };
}

export function canRecord(s: Session): boolean {
  const cur = current(s);
  return s.records.length < s.level.maxEchoes && cur.tick > 0 && cur.outcome !== 'won';
}

/** Превратить текущую попытку в эхо и начать новую петлю. */
export function recordEcho(s: Session): Session {
  if (!canRecord(s)) return s;
  const records = [...s.records, recordOf(current(s))];
  const echoInputs = [...s.echoInputs, s.inputs];
  return {
    ...s,
    records,
    echoInputs,
    history: [createLoop(s.level, records)],
    inputs: '',
    loops: s.loops + 1,
  };
}

/** Начать петлю заново с теми же эхо. */
export function restartLoop(s: Session): Session {
  return { ...s, history: [createLoop(s.level, s.records)], inputs: '', loops: s.loops + 1 };
}

/** Убрать последнее эхо. */
export function undoEcho(s: Session): Session {
  if (!s.records.length) return restartLoop(s);
  const records = s.records.slice(0, -1);
  return {
    ...s,
    records,
    echoInputs: s.echoInputs.slice(0, -1),
    history: [createLoop(s.level, records)],
    inputs: '',
    loops: s.loops + 1,
  };
}

/** Сбросить комнату: без эхо. */
export function resetRoom(s: Session): Session {
  return { ...newSession(s.level), paradoxes: s.paradoxes, loops: s.loops + 1 };
}

/** Звёзды: 1 за прохождение, +1 если копий не больше par, +1 если финальная петля уложилась в par по тикам. */
export function starsFor(level: Level, echoes: number, ticks: number): number {
  return 1 + (echoes <= level.par.echoes ? 1 : 0) + (ticks <= level.par.ticks ? 1 : 0);
}

export function isPerfect(level: Level, echoes: number, ticks: number): boolean {
  return echoes <= level.par.echoes && ticks <= level.par.ticks;
}
