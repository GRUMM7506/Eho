import type { Action, Dir, RecChar } from './types';

/** Смещения по направлениям: север, восток, юг, запад. */
export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];

export const DIRS: readonly Dir[] = [0, 1, 2, 3];

export const MOVE_CHARS = ['U', 'R', 'D', 'L'] as const;
export const USE_CHARS = ['u', 'r', 'd', 'l'] as const;

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

export function actionToDir(a: Action): Dir | null {
  switch (a) {
    case 'up':
      return 0;
    case 'right':
      return 1;
    case 'down':
      return 2;
    case 'left':
      return 3;
    default:
      return null;
  }
}

export function dirToAction(d: Dir): Action {
  return (['up', 'right', 'down', 'left'] as const)[d];
}

/** Соседняя клетка или −1, если за краем поля. */
export function neighbor(width: number, height: number, cell: number, d: Dir): number {
  const x = (cell % width) + DX[d]!;
  const y = Math.floor(cell / width) + DY[d]!;
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  return y * width + x;
}

export function cellX(width: number, cell: number): number {
  return cell % width;
}

export function cellY(width: number, cell: number): number {
  return Math.floor(cell / width);
}

export interface DecodedRec {
  readonly kind: 'none' | 'move' | 'use';
  readonly dir: Dir;
}

export function decodeRec(c: string | undefined): DecodedRec {
  switch (c) {
    case 'U':
      return { kind: 'move', dir: 0 };
    case 'R':
      return { kind: 'move', dir: 1 };
    case 'D':
      return { kind: 'move', dir: 2 };
    case 'L':
      return { kind: 'move', dir: 3 };
    case 'u':
      return { kind: 'use', dir: 0 };
    case 'r':
      return { kind: 'use', dir: 1 };
    case 'd':
      return { kind: 'use', dir: 2 };
    case 'l':
      return { kind: 'use', dir: 3 };
    default:
      return { kind: 'none', dir: 0 };
  }
}

export function encodeRec(kind: 'none' | 'move' | 'use', dir: Dir): RecChar {
  if (kind === 'none') return '.';
  return kind === 'move' ? MOVE_CHARS[dir] : USE_CHARS[dir];
}

/** Обратное действие для обратного эхо: шаг — в противоположную сторону, взаимодействие — то же. */
export function invertRec(c: string | undefined): RecChar {
  const r = decodeRec(c);
  if (r.kind === 'move') return MOVE_CHARS[opposite(r.dir)];
  if (r.kind === 'use') return USE_CHARS[r.dir];
  return '.';
}
