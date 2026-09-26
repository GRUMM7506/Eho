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

const SCREEN_DIRS: readonly ScreenDir[] = ['up', 'right', 'down', 'left'];

/** Сеточное направление → экранное при данном рыскании (обратно к `screenToGrid`). */
export function gridToScreen(d: Dir, yawDeg: number): ScreenDir {
  return SCREEN_DIRS[(d - screenUpDir(yawDeg) + 4) % 4]!;
}

/**
 * Как сеточное направление выглядит на экране: [x вправо, y вверх], без нормировки.
 * Ортографическая проекция: глубина сжата наклоном камеры (sin pitch).
 */
export function gridScreenVec(d: Dir, yawDeg: number, pitchDeg: number): [number, number] {
  const r = (yawDeg * Math.PI) / 180;
  const gx = [0, 1, 0, -1][d]!;
  const gz = [-1, 0, 1, 0][d]!;
  const x = gx * Math.cos(r) - gz * Math.sin(r);
  const depth = -gx * Math.sin(r) - gz * Math.cos(r);
  return [x, depth * Math.sin((pitchDeg * Math.PI) / 180)];
}

/**
 * Свайп → сеточное направление, которое на экране ближе всего к движению пальца.
 * `dy` — в координатах экрана (вниз положительно). Так при диагональной камере
 * свайп вдоль линий плиток идёт туда, куда смотрит палец, а не «на 45° мимо».
 */
export function swipeToGrid(dx: number, dy: number, yawDeg: number, pitchDeg: number): Dir {
  const len = Math.hypot(dx, dy) || 1;
  let best: Dir = 0;
  let bestCos = -Infinity;
  for (const d of [0, 1, 2, 3] as Dir[]) {
    const [vx, vy] = gridScreenVec(d, yawDeg, pitchDeg);
    const c = (vx * dx - vy * dy) / (len * (Math.hypot(vx, vy) || 1));
    if (c > bestCos) {
      bestCos = c;
      best = d;
    }
  }
  return best;
}

/** Свайп → экранное направление для буфера ввода (игровой цикл переведёт его обратно в сеточное). */
export function swipeToScreenDir(dx: number, dy: number, yawDeg: number, pitchDeg: number): ScreenDir {
  return gridToScreen(swipeToGrid(dx, dy, yawDeg, pitchDeg), yawDeg);
}

/** Поворот экранного D-pad (в градусах), чтобы его стрелки шли вдоль плиток: 0 или 45. */
export function dpadRotation(yawDeg: number): number {
  const y = normDeg(yawDeg);
  return y - Math.round(y / 90 - 1e-6) * 90;
}
