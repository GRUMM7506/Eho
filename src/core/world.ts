import { neighbor } from './grid';
import type {
  ActorState,
  BeamPath,
  Dir,
  Fixture,
  GuardState,
  ItemState,
  Level,
  SimEvent,
  WorldState,
} from './types';

export type Mut<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Черновик тика: изменяемая копия снимка, живёт только внутри `step()`.
 * Наружу всегда отдаётся замороженный `WorldState`.
 */
export interface Draft {
  readonly level: Level;
  readonly prev: WorldState;
  tick: number;
  actors: Mut<ActorState>[];
  boxes: number[];
  items: Mut<ItemState>[];
  cells: number[];
  guards: Mut<GuardState>[];
  signals: boolean[];
  beams: BeamPath[];
  events: SimEvent[];
  paradoxes: number;
  deathCause: 'laser' | 'guard' | null;
  /** Запрет «положить предмет» при поиске цели взаимодействия вокруг игрока. */
  noDrop: boolean;
  /** Игрок явно выбрал поднять предмет, на который уже наступил. */
  pickUnderfoot: boolean;
}

export function toDraft(s: WorldState): Draft {
  return {
    level: s.level,
    prev: s,
    tick: s.tick,
    actors: s.actors.map((a) => ({ ...a })),
    boxes: s.boxes.slice(),
    items: s.items.map((i) => ({ ...i })),
    cells: s.cells.slice(),
    guards: s.guards.map((g) => ({ ...g })),
    signals: s.signals.slice(),
    beams: s.beams.slice(),
    events: [],
    paradoxes: s.paradoxes,
    deathCause: s.deathCause,
    noDrop: false,
    pickUnderfoot: false,
  };
}

export function fixtureAt(d: { level: Level }, cell: number): Fixture | null {
  return cell < 0 ? null : (d.level.fixtures[cell] ?? null);
}

export function next(level: Level, cell: number, dir: Dir): number {
  return neighbor(level.width, level.height, cell, dir);
}

export function playerIndex(d: { actors: readonly ActorState[] }): number {
  return d.actors.length - 1;
}

export function boxAt(d: Draft, cell: number): number {
  for (let i = 0; i < d.boxes.length; i++) if (d.boxes[i] === cell) return i;
  return -1;
}

/** Предмет, лежащий на полу клетки (не в гнезде, не в руках). */
export function itemAt(d: Draft, cell: number): number {
  const fx = fixtureAt(d, cell);
  if (fx && fx.type === 'socket') return -1;
  for (let i = 0; i < d.items.length; i++) {
    const it = d.items[i]!;
    if (it.cell === cell && it.carrier < 0 && !it.consumed) return i;
  }
  return -1;
}

export function guardAt(d: Draft, cell: number): number {
  for (let i = 0; i < d.guards.length; i++) if (d.guards[i]!.cell === cell) return i;
  return -1;
}

export function anyActorAt(d: Draft, cell: number, exclude = -1): boolean {
  for (let i = 0; i < d.actors.length; i++) if (i !== exclude && d.actors[i]!.cell === cell) return true;
  return false;
}

/** Твёрдое эхо: копия в особой зоне, стоящая на полу, — препятствие для остальных. */
export function solidEchoAt(d: Draft, cell: number, exclude = -1): number {
  if (!d.level.solidZone[cell]) return -1;
  for (let i = 0; i < d.actors.length; i++) {
    const a = d.actors[i]!;
    if (i !== exclude && a.kind === 'echo' && a.cell === cell && !a.riding) return i;
  }
  return -1;
}

/** Есть ли в клетке кто-то или что-то, что не даёт двери закрыться. */
export function isOccupied(d: Draft, cell: number): boolean {
  return anyActorAt(d, cell) || boxAt(d, cell) >= 0 || itemAt(d, cell) >= 0 || guardAt(d, cell) >= 0;
}

export function emit(d: Draft, e: SimEvent): void {
  d.events.push(e);
}

export function markParadox(
  d: Draft,
  actor: number,
  reason: 'blocked' | 'nothing-to-take' | 'cannot-place' | 'nothing-to-use',
): void {
  const a = d.actors[actor]!;
  if (a.kind !== 'echo' || a.status !== 'ok') return;
  a.status = 'broken';
  a.brokenAt = d.tick;
  d.paradoxes++;
  emit(d, { type: 'paradox', actor, cell: a.cell, reason });
}

export function freeze(d: Draft, outcome: WorldState['outcome'], record: string): WorldState {
  return {
    level: d.level,
    records: d.prev.records,
    tick: d.tick,
    actors: d.actors,
    boxes: d.boxes,
    items: d.items,
    cells: d.cells,
    guards: d.guards,
    signals: d.signals,
    beams: d.beams,
    outcome,
    deathCause: d.deathCause,
    record,
    paradoxes: d.paradoxes,
  };
}
