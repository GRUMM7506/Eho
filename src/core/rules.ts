import type { Mechanic } from './mechanic';
import { MECHANICS } from './mechanics';
import type { Dir, FixtureType, Mover, SimEvent } from './types';
import {
  anyActorAt,
  boxAt,
  emit,
  fixtureAt,
  guardAt,
  itemAt,
  next,
  solidEchoAt,
  type Draft,
} from './world';

let ownerTable: Map<FixtureType, Mechanic> | null = null;

/** Механика, владеющая приспособлением данного типа. */
export function ownerOf(type: FixtureType): Mechanic | undefined {
  if (!ownerTable) {
    ownerTable = new Map();
    for (const m of MECHANICS) for (const t of m.fixtures) ownerTable.set(t, m);
  }
  return ownerTable.get(type);
}

function owner(d: Draft, cell: number): Mechanic | undefined {
  const fx = fixtureAt(d, cell);
  return fx ? ownerOf(fx.type) : undefined;
}

export function floorZ(d: Draft, cell: number): number {
  const h = owner(d, cell)?.floorHeight?.(d, cell);
  return h ?? d.level.heights[cell] ?? 0;
}

export function isRamp(d: Draft, cell: number): boolean {
  return owner(d, cell)?.isRamp?.(d, cell) ?? false;
}

export function isHole(d: Draft, cell: number): boolean {
  return owner(d, cell)?.isHole?.(d, cell) ?? false;
}

export function blocksEntry(d: Draft, cell: number, mover: Mover): boolean {
  if (cell < 0) return true;
  if (d.level.terrain[cell] !== 'floor') return true;
  return owner(d, cell)?.blocksEntry?.(d, cell, mover) ?? false;
}

/** Непрозрачна ли клетка для лазера и взгляда стражей (без учёта акторов). */
export function blocksSight(d: Draft, cell: number): boolean {
  if (cell < 0 || d.level.terrain[cell] !== 'floor') return true;
  if (boxAt(d, cell) >= 0) return true;
  return owner(d, cell)?.blocksSight?.(d, cell) ?? false;
}

export function actorZ(d: Draft, index: number): number {
  const a = d.actors[index]!;
  return floorZ(d, a.cell) + (a.riding ? 1 : 0);
}

function heightOk(d: Draft, from: number, fromZ: number, to: number, toZ: number): boolean {
  if (fromZ === toZ) return true;
  return Math.abs(fromZ - toZ) === 1 && (isRamp(d, from) || isRamp(d, to));
}

export function moverCell(d: Draft, m: Mover): number {
  return m.kind === 'actor' ? d.actors[m.index]!.cell : d.boxes[m.index]!;
}

function setCell(d: Draft, m: Mover, cell: number): void {
  if (m.kind === 'actor') d.actors[m.index]!.cell = cell;
  else d.boxes[m.index] = cell;
}

interface EntryPlan {
  readonly push: number;
  readonly riding: boolean;
  readonly fill: boolean;
}

const BLOCKED = null;

/** Может ли ящик въехать в клетку `to` из `from`. */
function boxEntry(d: Draft, box: number, from: number, to: number, dir: Dir): EntryPlan | null {
  const mover: Mover = { kind: 'box', index: box };
  if (blocksEntry(d, to, mover)) return BLOCKED;
  if (isRamp(d, to) || isRamp(d, from)) return BLOCKED;
  if (floorZ(d, to) !== floorZ(d, from)) return BLOCKED;
  if (anyActorAt(d, to) || boxAt(d, to) >= 0 || itemAt(d, to) >= 0 || guardAt(d, to) >= 0) return BLOCKED;
  if (isHole(d, to)) return { push: -1, riding: false, fill: true };
  const o = owner(d, to);
  if (o?.canArrive && !o.canArrive(d, mover, to, dir)) return BLOCKED;
  return { push: -1, riding: false, fill: false };
}

/** Может ли актор войти в клетку `to` (с толканием ящика или без). */
function actorEntry(d: Draft, actor: number, from: number, to: number, dir: Dir, allowPush: boolean): EntryPlan | null {
  const mover: Mover = { kind: 'actor', index: actor };
  if (blocksEntry(d, to, mover)) return BLOCKED;
  if (isHole(d, to)) return BLOCKED;
  const solid = solidEchoAt(d, to, actor);
  const toZ = floorZ(d, to) + (solid >= 0 ? 1 : 0);
  if (!heightOk(d, from, actorZ(d, actor), to, toZ)) return BLOCKED;
  const riding = solid >= 0;
  let push = -1;
  if (!riding) {
    const b = boxAt(d, to);
    if (b >= 0) {
      if (!allowPush) return BLOCKED;
      const beyond = next(d.level, to, dir);
      if (beyond < 0 || !boxEntry(d, b, to, beyond, dir)) return BLOCKED;
      push = b;
    }
  }
  const o = owner(d, to);
  if (o?.canArrive && !o.canArrive(d, mover, to, dir)) return BLOCKED;
  return { push, riding, fill: false };
}

function entry(d: Draft, m: Mover, from: number, to: number, dir: Dir, allowPush: boolean): EntryPlan | null {
  if (to < 0) return BLOCKED;
  return m.kind === 'actor' ? actorEntry(d, m.index, from, to, dir, allowPush) : boxEntry(d, m.index, from, to, dir);
}

/** Проверка без побочных эффектов: может ли сущность сдвинуться в направлении. */
export function canMove(d: Draft, m: Mover, dir: Dir, allowPush: boolean): boolean {
  const from = moverCell(d, m);
  return entry(d, m, from, next(d.level, from, dir), dir, allowPush) !== BLOCKED;
}

type MoveCause = 'step' | 'push' | 'slide' | 'conveyor';

function moveEvent(m: Mover, from: number, to: number, cause: MoveCause): SimEvent {
  if (cause === 'step' && m.kind === 'actor') return { type: 'step', actor: m.index, from, to };
  if (cause === 'push' && m.kind === 'box') return { type: 'push', box: m.index, from, to };
  if (cause === 'conveyor') return { type: 'conveyor', mover: m, from, to };
  return { type: 'slide', mover: m, from, to };
}

/**
 * Сдвиг сущности на одну клетку со всеми последствиями:
 * толкание ящика, уход с клетки (хрупкий пол), вход (портал, лёд), засыпание ямы.
 */
export function moveMover(d: Draft, m: Mover, dir: Dir, allowPush: boolean, cause: MoveCause): boolean {
  const from = moverCell(d, m);
  const to = next(d.level, from, dir);
  const plan = entry(d, m, from, to, dir, allowPush);
  if (!plan) return false;
  if (plan.push >= 0) moveMover(d, { kind: 'box', index: plan.push }, dir, false, 'push');
  owner(d, from)?.onLeave?.(d, m, from);
  setCell(d, m, to);
  if (m.kind === 'actor') {
    const a = d.actors[m.index]!;
    if (a.riding !== plan.riding && plan.riding) emit(d, { type: 'ride', actor: m.index, cell: to });
    a.riding = plan.riding;
  }
  emit(d, moveEvent(m, from, to, cause));
  if (plan.fill && m.kind === 'box') {
    owner(d, to)?.fillHole?.(d, to);
    d.boxes[m.index] = -1;
    emit(d, { type: 'boxFill', box: m.index, cell: to });
    return true;
  }
  arrive(d, m, to, dir);
  return true;
}

function arrive(d: Draft, m: Mover, cell: number, dir: Dir): void {
  let cur = cell;
  for (let guard = 0; guard < d.level.width * d.level.height; guard++) {
    const eff = owner(d, cur)?.onEnter?.(d, m, cur, dir);
    if (!eff) return;
    if ('teleport' in eff) {
      setCell(d, m, eff.teleport);
      if (m.kind === 'actor') d.actors[m.index]!.riding = false;
      emit(d, { type: 'teleport', mover: m, from: cur, to: eff.teleport });
      return;
    }
    // Лёд: скольжение, пока следующая клетка свободна. Ящики по пути не толкаются.
    const nxt = next(d.level, cur, dir);
    const plan = entry(d, m, cur, nxt, dir, false);
    if (!plan) return;
    owner(d, cur)?.onLeave?.(d, m, cur);
    setCell(d, m, nxt);
    if (m.kind === 'actor') d.actors[m.index]!.riding = plan.riding;
    emit(d, { type: 'slide', mover: m, from: cur, to: nxt });
    if (plan.fill && m.kind === 'box') {
      owner(d, nxt)?.fillHole?.(d, nxt);
      d.boxes[m.index] = -1;
      emit(d, { type: 'boxFill', box: m.index, cell: nxt });
      return;
    }
    cur = nxt;
  }
}

/** Взаимодействие актора с клеткой перед собой. */
export function interact(d: Draft, actor: number): boolean {
  const a = d.actors[actor]!;
  const front = next(d.level, a.cell, a.facing);
  if (front < 0) return false;
  const o = owner(d, front);
  if (o?.interact) {
    const r = o.interact(d, actor, front);
    if (r !== 'skip') return r === 'done';
  }
  for (const m of MECHANICS) {
    if (m.fixtures.length || !m.interact) continue;
    const r = m.interact(d, actor, front);
    if (r !== 'skip') return r === 'done';
  }
  return false;
}

/** Можно ли положить предмет на клетку. */
export function canPlaceItem(d: Draft, actor: number, cell: number): boolean {
  if (blocksEntry(d, cell, { kind: 'actor', index: actor })) return false;
  if (isHole(d, cell)) return false;
  const fx = fixtureAt(d, cell);
  if (fx && (fx.type === 'portal' || fx.type === 'ice' || fx.type === 'conveyor')) return false;
  if (boxAt(d, cell) >= 0 || itemAt(d, cell) >= 0 || guardAt(d, cell) >= 0) return false;
  return Math.abs(floorZ(d, cell) - actorZ(d, actor)) <= 1;
}
