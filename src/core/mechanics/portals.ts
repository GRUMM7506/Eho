import type { Mechanic } from '../mechanic';
import type { Level } from '../types';

/** Парный портал клетки или −1. */
export function pairOf(level: Level, cell: number): number {
  const fx = level.fixtures[cell];
  return fx && fx.type === 'portal' ? fx.pair : -1;
}

/**
 * Порталы — проходные. Пара одного цвета. Вошедший в клетку портала (шагом, толчком, скольжением,
 * конвейером) выходит из парного портала на следующую клетку в том же направлении движения.
 * Если клетка выхода занята или непроходима — войти в портал нельзя. Работает для акторов и ящиков
 * (ящик может так упасть в яму или въехать на лёд). Логика прохода — в rules.ts (функция entry).
 */
export const portals: Mechanic = {
  id: 'portals',
  fixtures: ['portal'],
};
