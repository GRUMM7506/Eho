import { compileLevel, type RawLevel } from '../src/core/level';
import { createLoop, inputToAction, playSolution, recordOf, step } from '../src/core/sim';
import type { EchoRecord, Level, SimEvent, WorldState } from '../src/core/types';

export function mk(map: string[], extra: Partial<RawLevel> = {}): Level {
  return compileLevel({
    id: 'test',
    world: 0,
    index: 0,
    name: { ru: 'тест', en: 'test' },
    map,
    tickLimit: 40,
    maxEchoes: 6,
    par: { echoes: 0, ticks: 0 },
    ...extra,
  });
}

export function at(level: Level, x: number, y: number): number {
  return y * level.width + x;
}

export function xy(level: Level, cell: number): [number, number] {
  return [cell % level.width, Math.floor(cell / level.width)];
}

/** Прогнать ввод по снимку, собирая события. */
export function run(state: WorldState, inputs: string): { state: WorldState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let s = state;
  for (const c of inputs) {
    const r = step(s, inputToAction(c));
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Записать петли как эхо и вернуть начальный снимок следующей петли. */
export function withEchoes(level: Level, loops: string[]): WorldState {
  const { records } = playSolution(level, [...loops, '']);
  return createLoop(level, records);
}

export function recordsFrom(level: Level, loops: string[]): EchoRecord[] {
  const records: EchoRecord[] = [];
  for (const l of loops) {
    const s = run(createLoop(level, records), l).state;
    records.push(recordOf(s));
  }
  return records;
}

export function player(s: WorldState) {
  return s.actors[s.actors.length - 1]!;
}
