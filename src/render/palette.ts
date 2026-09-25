import * as THREE from 'three';

/** Палитра игры (шестнадцатеричные значения из спецификации). */
export const PALETTE = {
  bg: 0x0d0b1e,
  wall: 0x221d45,
  wallTop: 0x342c69,
  floor: 0x3a3380,
  floorAlt: 0x40398c,
  pillar: 0x1e1947,
  player: 0xffe45e,
  echo: 0x8c9eff,
  paradox: 0xff4d5e,
  exit: 0x5cf2b5,
  pink: 0xff5d8f,
  cyan: 0x3ddcff,
  violet: 0xb388ff,
  orange: 0xff9f43,
  ink: 0xece8ff,
  muted: 0x9c95c9,
  box: 0x6b5a8e,
  ice: 0x9fe8ff,
} as const;

/** Цвета механизмов по индексу цвета ядра: розовый, циан, фиолетовый, оранжевый. */
export const MECH_COLORS: readonly number[] = [PALETTE.pink, PALETTE.cyan, PALETTE.violet, PALETTE.orange];

export function mechColor(id: number): THREE.Color {
  return new THREE.Color(id < 0 ? PALETTE.ink : (MECH_COLORS[id] ?? PALETTE.ink));
}

/** Высота одного этажа в мировых единицах. */
export const FLOOR_UNIT = 0.5;
/** Высота стены над полом её клетки. */
export const WALL_HEIGHT = 1.0;
