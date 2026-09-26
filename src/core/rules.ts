import type { Mechanic } from './mechanic';
import { getHooks, getMechanics } from './mechanics';
import type { Dir, FixtureType, Level, Mover, SimEvent } from './types';
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
    for (const m of getMechanics()) for (const t of m.fixtures) ownerTable.set(t, m);
  }
  return ownerTable.get(type);
}

type Bound<K extends keyof Mechanic> = NonNullable<Mechanic[K]> | null;

/** Таблицы хуков по клеткам уровня: без поиска владельца и полиморфных обращений на горячем пути. */
interface CellHooks {
  blocksEntry: Bound<'blocksEntry'>[];
  isHole: Bound<'isHole'>[];
  fillHole: Bound<'fillHole'>[];
  floorHeight: Bound<'floorHeight'>[];
  isRamp: Bound<'isRamp'>[];
  blocksSight: Bound<'blocksSight'>[];
  interact: Bound<'interact'>[];
  canArrive: Bound<'canArrive'>[];
  onEnter: Bound<'onEnter'>[];
  onLeave: Bound<'onLeave'>[];
}

const CELL_KEYS = ['blocksEntry', 'isHole', 'fillHole', 'floorHeight', 'isRamp', 'blocksSight', 'interact', 'canArrive', 'onEnter', 'onLeave'] as const;

let lastLevel: Level | null = null;
let lastHooks: CellHooks | null = null;
const hookCache = new WeakMap<Level, CellHooks>();

function cellHooks(level: Level): CellHooks {
  if (level === lastLevel) return lastHooks!;
  let h = hookCache.get(level);
  if (!h) {
    const n = level.fixtures.length;
    const table = Object.fromEntries(CELL_KEYS.map((k) => [k, new Array(n).fill(null)])) as unknown as CellHooks;
    level.fixtures.forEach((fx, c) => {
      const m = fx ? ownerOf(fx.type) : undefined;
      if (!m) return;
      for (const k of CELL_KEYS) {
        const fn = m[k];
        if (typeof fn === 'function') (table[k] as unknown[])[c] = (fn as (...a: unknown[]) => unknown).bind(m);
      }
    });
    hookCache.set(level, table);
    h = table;
  }
  lastLevel = level;
  lastHooks = h;
  return h;
}

export function floorZ(d: Draft, cell: number): number {
  const f = cellHooks(d.level).floorHeight[cell];
  const h = f ? f(d, cell) : null;
  return h ?? d.level.heights[cell] ?? 0;
}

export function isRamp(d: Draft, cell: number): boolean {
  const f = cellHooks(d.level).isRamp[cell];
  return f ? f(d, cell) : false;
}

export function isHole(d: Draft, cell: number): boolean {
  const f = cellHooks(d.level).isHole[cell];
  return f ? f(d, cell) : false;
}

export function blocksEntry(d: Draft, cell: number, mover: Mover): boolean {
  if (cell < 0) return true;
  if (d.level.terrain[cell] !== 'floor') return true;
  const f = cellHooks(d.level).blocksEntry[cell];
  return f ? f(d, cell, mover) : false;
}

/** Непрозрачна ли клетка для лазера и взгляда стражей (без учёта акторов). */
export function blocksSight(d: Draft, cell: number): boolean {
  if (cell < 0 || d.level.terrain[cell] !== 'floor') return true;
  if (boxAt(d, cell) >= 0) return true;
  const f = cellHooks(d.level).blocksSight[cell];
  return f ? f(d, cell) : false;
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
  /** Проход через портал: клетка парного портала и клетка выхода за ним (иначе −1). */
  readonly via: number;
  readonly dest: number;
}

const BLOCKED = null;

/** Может ли ящик въехать в клетку `to` из `from`. */
function boxEntry(d: Draft, box: number, from: number, to: number, dir: Dir): EntryPlan | null {
  const mover: Mover = { kind: 'box', index: box };
  if (blocksEntry(d, to, mover)) return BLOCKED;
  if (isRamp(d, to) || isRamp(d, from)) return BLOCKED;
  if (floorZ(d, to) !== floorZ(d, from)) return BLOCKED;
  if (anyActorAt(d, to) || boxAt(d, to) >= 0 || itemAt(d, to) >= 0 || guardAt(d, to) >= 0) return BLOCKED;
  if (isHole(d, to)) return { push: -1, riding: false, fill: true, via: -1, dest: -1 };
  const arriveOk = cellHooks(d.level).canArrive[to];
  if (arriveOk && !arriveOk(d, mover, to, dir)) return BLOCKED;
  return { push: -1, riding: false, fill: false, via: -1, dest: -1 };
}

/** Может ли актор войти в клетку `to` (с толканием ящика или без). */
function actorEntry(d: Draft, actor: number, from: number, to: number, dir: Dir, allowPush: boolean, fromZ = actorZ(d, actor)): EntryPlan | null {
  const mover: Mover = { kind: 'actor', index: actor };
  if (blocksEntry(d, to, mover)) return BLOCKED;
  if (isHole(d, to)) return BLOCKED;
  const solid = solidEchoAt(d, to, actor);
  const toZ = floorZ(d, to) + (solid >= 0 ? 1 : 0);
  if (!heightOk(d, from, fromZ, to, toZ)) return BLOCKED;
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
  const arriveOk = cellHooks(d.level).canArrive[to];
  if (arriveOk && !arriveOk(d, mover, to, dir)) return BLOCKED;
  return { push, riding, fill: false, via: -1, dest: -1 };
}

function entry(d: Draft, m: Mover, from: number, to: number, dir: Dir, allowPush: boolean): EntryPlan | null {
  if (to < 0) return BLOCKED;
  const plan = m.kind === 'actor' ? actorEntry(d, m.index, from, to, dir, allowPush) : boxEntry(d, m.index, from, to, dir);
  if (!plan || plan.fill) return plan;
  const fx = d.level.fixtures[to];
  if (fx?.type !== 'portal') return plan;
  // Проходной портал: выход — клетка за парным порталом в том же направлении. Занята — войти нельзя.
  const q = fx.pair;
  const dest = next(d.level, q, dir);
  if (dest < 0 || d.level.fixtures[dest]?.type === 'portal') return BLOCKED;
  const tail =
    m.kind === 'actor'
      ? actorEntry(d, m.index, q, dest, dir, false, floorZ(d, q))
      : boxEntry(d, m.index, q, dest, dir);
  if (!tail) return BLOCKED;
  return { push: plan.push, riding: tail.riding, fill: tail.fill, via: q, dest };
}

/**
 * Применить вход: толкание, уход с клетки, перемещение (с проходом через портал), засыпание ямы.
 * Возвращает клетку, где сущность оказалась, или −1, если ящик ушёл в яму.
 */
function applyEntry(d: Draft, m: Mover, from: number, to: number, plan: EntryPlan, dir: Dir, cause: MoveCause): number {
  const hooks = cellHooks(d.level);
  if (plan.push >= 0) moveMover(d, { kind: 'box', index: plan.push }, dir, false, 'push');
  hooks.onLeave[from]?.(d, m, from);
  setCell(d, m, to);
  emit(d, moveEvent(m, from, to, cause));
  let cell = to;
  if (plan.via >= 0) {
    emit(d, { type: 'teleport', mover: m, from: to, to: plan.via });
    setCell(d, m, plan.dest);
    emit(d, { type: 'slide', mover: m, from: plan.via, to: plan.dest });
    cell = plan.dest;
  }
  if (m.kind === 'actor') {
    const a = d.actors[m.index]!;
    if (plan.riding && !a.riding) emit(d, { type: 'ride', actor: m.index, cell });
    a.riding = plan.riding;
  }
  if (plan.fill && m.kind === 'box') {
    hooks.fillHole[cell]?.(d, cell);
    d.boxes[m.index] = -1;
    emit(d, { type: 'boxFill', box: m.index, cell });
    return -1;
  }
  return cell;
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
  const cell = applyEntry(d, m, from, to, plan, dir, cause);
  if (cell >= 0) arrive(d, m, cell, dir);
  return true;
}

/** Эффекты прибытия: лёд — скольжение дальше, пока следующая клетка свободна (ящики не толкаются). */
function arrive(d: Draft, m: Mover, cell: number, dir: Dir): void {
  let cur = cell;
  for (let guard = 0; guard < d.level.width * d.level.height; guard++) {
    const eff = cellHooks(d.level).onEnter[cur]?.(d, m, cur, dir);
    if (!eff || !('slide' in eff)) return;
    const nxt = next(d.level, cur, dir);
    const plan = entry(d, m, cur, nxt, dir, false);
    if (!plan) return;
    const landed = applyEntry(d, m, cur, nxt, plan, dir, 'slide');
    if (landed < 0) return;
    cur = landed;
  }
}

/** Взаимодействие актора с клеткой перед собой. */
export function interact(d: Draft, actor: number): boolean {
  const a = d.actors[actor]!;
  const front = next(d.level, a.cell, a.facing);
  if (front < 0) return false;
  const own = cellHooks(d.level).interact[front];
  if (own) {
    const r = own(d, actor, front);
    if (r !== 'skip') return r === 'done';
  }
  for (const fn of getHooks().looseInteract) {
    const r = fn(d, actor, front);
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
