import type { Mechanic } from '../mechanic';
import { isHole } from '../rules';
import type { Mover } from '../types';
import { anyActorAt, boxAt, guardAt, itemAt, solidEchoAt, type Draft } from '../world';

function pairOf(d: Draft, cell: number): number {
  const fx = d.level.fixtures[cell];
  return fx && fx.type === 'portal' ? fx.pair : -1;
}

function exitFree(d: Draft, mover: Mover, exit: number): boolean {
  if (exit < 0 || isHole(d, exit)) return false;
  if (boxAt(d, exit) >= 0 || guardAt(d, exit) >= 0) return false;
  if (mover.kind === 'box') return !anyActorAt(d, exit) && itemAt(d, exit) < 0;
  return solidEchoAt(d, exit, mover.index) < 0;
}

/**
 * Порталы. Пара одного цвета. Вход в клетку портала переносит на клетку парного портала,
 * направление взгляда сохраняется. Если выход занят (ящик, страж, твёрдое эхо), войти нельзя.
 * Работает для акторов и ящиков. Прибытие через портал повторно не телепортирует.
 */
export const portals: Mechanic = {
  id: 'portals',
  fixtures: ['portal'],
  canArrive: (d, mover, cell) => exitFree(d, mover, pairOf(d, cell)),
  onEnter: (d, _mover, cell) => ({ teleport: pairOf(d, cell) }),
};
