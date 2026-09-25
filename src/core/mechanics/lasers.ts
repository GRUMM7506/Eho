import type { Mechanic } from '../mechanic';
import { blocksSight } from '../rules';
import type { BeamPath, Dir } from '../types';
import { emit, next, playerIndex, type Draft } from '../world';

/** Отражение от зеркала `/` и `\` по направлению движения луча. */
const SLASH: readonly Dir[] = [1, 0, 3, 2];
const BACKSLASH: readonly Dir[] = [3, 2, 1, 0];

export function mirrorOrient(d: Draft, cell: number, sig: readonly boolean[]): '/' | '\\' {
  const fx = d.level.fixtures[cell];
  if (!fx || fx.type !== 'mirror') return '/';
  const flip = fx.color >= 0 && !!sig[fx.color];
  if (!flip) return fx.orient;
  return fx.orient === '/' ? '\\' : '/';
}

export function emitterActive(d: Draft, cell: number, sig: readonly boolean[]): boolean {
  const fx = d.level.fixtures[cell];
  if (!fx || fx.type !== 'emitter') return false;
  if (fx.color < 0) return true;
  return !!sig[fx.color] !== fx.invert;
}

/**
 * Трассировка лучей. Луч идёт от излучателя, отражается зеркалами и останавливается
 * на стене, закрытой двери, ящике, пьедестале, приёмнике, копии (эхо блокирует луч) или игроке.
 */
export function traceBeams(d: Draft, sig: readonly boolean[]): BeamPath[] {
  const out: BeamPath[] = [];
  const pi = playerIndex(d);
  const limit = d.level.width * d.level.height * 4;
  for (const emitter of d.level.byType.emitter) {
    const fx = d.level.fixtures[emitter];
    if (!fx || fx.type !== 'emitter' || !emitterActive(d, emitter, sig)) continue;
    let dir: Dir = fx.dir;
    let cur = emitter;
    const cells: number[] = [];
    let end: BeamPath['end'] = 'edge';
    const seen = new Set<number>();
    for (let n = 0; n < limit; n++) {
      cur = next(d.level, cur, dir);
      if (cur < 0) break;
      const key = cur * 4 + dir;
      if (seen.has(key)) break;
      seen.add(key);
      cells.push(cur);
      const f = d.level.fixtures[cur];
      if (d.level.terrain[cur] === 'floor' && f?.type === 'mirror') {
        dir = (mirrorOrient(d, cur, sig) === '/' ? SLASH : BACKSLASH)[dir]!;
        continue;
      }
      if (d.level.terrain[cur] === 'floor' && f?.type === 'receiver') {
        end = 'receiver';
        break;
      }
      if (blocksSight(d, cur)) {
        end = 'block';
        break;
      }
      let echo = false;
      for (let i = 0; i < pi; i++) if (d.actors[i]!.cell === cur) echo = true;
      if (echo) {
        end = 'echo';
        break;
      }
      if (d.actors[pi]!.cell === cur) {
        end = 'player';
        break;
      }
    }
    out.push({ emitter, cells, end });
  }
  return out;
}

/**
 * Лазеры, зеркала и приёмники. Луч убивает только настоящего игрока; копия луч блокирует
 * (служит щитом). Зеркало поворачивается, пока активен сигнал его цвета (обычно рычаг).
 * Приёмник, в который попадает луч, даёт сигнал своего цвета.
 */
export const lasers: Mechanic = {
  id: 'lasers',
  fixtures: ['emitter', 'mirror', 'receiver'],
  initCell: () => 0,
  blocksEntry: () => true,
  blocksSight: () => true,
  emitSignals(d, sig) {
    if (!d.level.byType.emitter.length) return;
    const beams = traceBeams(d, sig);
    d.beams = beams;
    for (const cell of d.level.byType.receiver) d.cells[cell] = 0;
    for (const b of beams) {
      if (b.end !== 'receiver') continue;
      const cell = b.cells[b.cells.length - 1]!;
      const fx = d.level.fixtures[cell];
      if (fx?.type !== 'receiver') continue;
      d.cells[cell] = 1;
      sig[fx.color] = true;
    }
  },
  finalize(d) {
    for (const cell of d.level.byType.receiver) {
      const was = d.prev.cells[cell] ?? 0;
      const now = d.cells[cell] ?? 0;
      if (was !== now) emit(d, { type: 'receiver', cell, on: now === 1 });
    }
  },
  check(d) {
    if (!d.level.byType.emitter.length) return;
    d.beams = traceBeams(d, d.signals);
    const p = d.actors[playerIndex(d)]!;
    if (p.status !== 'ok') return;
    if (d.beams.some((b) => b.end === 'player')) {
      p.status = 'dead';
      d.deathCause = 'laser';
      emit(d, { type: 'death', cause: 'laser', cell: p.cell });
    }
  },
};
