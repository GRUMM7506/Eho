import type { Mechanic } from '../mechanic';
import { blocksEntry, blocksSight, floorZ, isHole, isRamp } from '../rules';
import type { Dir } from '../types';
import { boxAt, emit, guardAt, next, playerIndex, type Draft } from '../world';

function guardCanEnter(d: Draft, gi: number, from: number, to: number): boolean {
  if (to < 0) return false;
  if (blocksEntry(d, to, { kind: 'box', index: -1 })) return false;
  if (isHole(d, to) || isRamp(d, to) || floorZ(d, to) !== floorZ(d, from)) return false;
  if (boxAt(d, to) >= 0) return false;
  const other = guardAt(d, to);
  return other < 0 || other === gi;
}

/** Первый шаг кратчайшего пути от стража к ближайшей несбитой копии (поиск в ширину, порядок С-В-Ю-З). */
function stepTowardEcho(d: Draft, gi: number): Dir | null | 'here' {
  const start = d.guards[gi]!.cell;
  const targets = new Set<number>();
  for (const a of d.actors) if (a.kind === 'echo' && a.status === 'ok') targets.add(a.cell);
  if (!targets.size) return null;
  if (targets.has(start)) return 'here';
  const first = new Map<number, Dir>();
  const queue: number[] = [start];
  const seen = new Set<number>([start]);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    for (const dir of [0, 1, 2, 3] as const) {
      const n = next(d.level, cur, dir);
      if (n < 0 || seen.has(n) || !guardCanEnter(d, gi, cur, n)) continue;
      seen.add(n);
      const f = cur === start ? dir : first.get(cur)!;
      first.set(n, f);
      if (targets.has(n)) return f;
      queue.push(n);
    }
  }
  return null;
}

/** Клетки, которые видит страж: своя клетка и прямая линия по направлению взгляда. */
export function guardSight(d: Draft, gi: number): number[] {
  const g = d.guards[gi]!;
  const spec = d.level.guards[gi]!;
  const out = [g.cell];
  let cur = g.cell;
  const pi = playerIndex(d);
  for (let k = 0; k < spec.range; k++) {
    cur = next(d.level, cur, g.facing);
    if (cur < 0 || blocksSight(d, cur)) break;
    out.push(cur);
    let echo = false;
    for (let i = 0; i < pi; i++) if (d.actors[i]!.cell === cur) echo = true;
    if (echo) break;
  }
  return out;
}

/**
 * Стражи. Ходят по детерминированному маршруту (по кругу), ждут, если путь закрыт.
 * Видят только настоящего игрока: по прямой перед собой на `range` клеток; копии заслоняют обзор.
 * Режим `lure`: страж идёт к ближайшей несбитой копии, а без копий — по маршруту.
 */
export const guards: Mechanic = {
  id: 'guards',
  fixtures: [],
  afterMoves(d) {
    for (let gi = 0; gi < d.guards.length; gi++) {
      const g = d.guards[gi]!;
      const spec = d.level.guards[gi]!;
      let dir: Dir | null = null;
      let onRoute = false;
      if (spec.mode === 'lure') {
        const s = stepTowardEcho(d, gi);
        if (s === 'here') continue;
        dir = s;
      }
      if (dir === null && spec.route.length) {
        dir = spec.route[g.routeIdx % spec.route.length]!;
        onRoute = true;
      }
      if (dir === null) continue;
      g.facing = dir;
      const to = next(d.level, g.cell, dir);
      if (!guardCanEnter(d, gi, g.cell, to)) continue;
      const from = g.cell;
      g.cell = to;
      if (onRoute) g.routeIdx = (g.routeIdx + 1) % spec.route.length;
      emit(d, { type: 'guardMove', guard: gi, from, to });
    }
  },
  check(d) {
    if (!d.guards.length) return;
    const pi = playerIndex(d);
    const p = d.actors[pi]!;
    if (p.status !== 'ok') return;
    const prevP = d.prev.actors[pi]!.cell;
    for (let gi = 0; gi < d.guards.length; gi++) {
      const g = d.guards[gi]!;
      const prevG = d.prev.guards[gi]!.cell;
      const swapped = prevP === g.cell && prevG === p.cell;
      if (swapped || guardSight(d, gi).includes(p.cell)) {
        p.status = 'dead';
        d.deathCause = 'guard';
        emit(d, { type: 'death', cause: 'guard', cell: p.cell });
        return;
      }
    }
  },
};
