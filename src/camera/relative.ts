import type { Action, Dir } from '../core/types';

/** Экранное направление ввода: «вверх» — всегда «от экрана», вглубь сцены. */
export type ScreenDir = 'up' | 'right' | 'down' | 'left';

const SCREEN_OFFSET: Readonly<Record<ScreenDir, number>> = { up: 0, right: 1, down: 2, left: 3 };

/** Нормализация угла в градусах к [0, 360). */
export function normDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

/**
 * Какое сеточное направление видно на экране как «вверх» при данном рыскании камеры.
 *
 * Мир: сетка x → +X, y → +Z (север — −Z). Камера смотрит на цель с азимута `yaw`:
 * при yaw = 0 она стоит на юге и смотрит на север. С ростом yaw на 90° «вверх» экрана
 * проходит С → З → Ю → В. На диагоналях (45°, 135°…) выбирается направление, которое
 * видно «вверх-вправо», — так правило однозначно для всех 8 углов доводки.
 */
export function screenUpDir(yawDeg: number): Dir {
  const k = Math.round(normDeg(yawDeg) / 90 - 1e-6) % 4;
  return ((4 - k) % 4) as Dir;
}

/** Перевод экранного направления в сеточное по текущему рысканию камеры. */
export function screenToGrid(dir: ScreenDir, yawDeg: number): Dir {
  return ((screenUpDir(yawDeg) + SCREEN_OFFSET[dir]) % 4) as Dir;
}

const GRID_ACTION: readonly Action[] = ['up', 'right', 'down', 'left'];

/** Экранное действие → сеточное действие для симуляции (взаимодействие и ожидание не меняются). */
export function screenActionToGrid(a: Action, yawDeg: number): Action {
  if (a === 'none' || a === 'interact') return a;
  return GRID_ACTION[screenToGrid(a, yawDeg)]!;
}
