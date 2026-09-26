import { describe, expect, it } from 'vitest';
import {
  dpadRotation,
  gridScreenVec,
  gridToScreen,
  screenActionToGrid,
  screenToGrid,
  screenUpDir,
  swipeToGrid,
  swipeToScreenDir,
} from '../src/camera/relative';

/**
 * Проверка через геометрию: сеточное направление, выбранное для «вверх», должно иметь
 * максимальную проекцию на вектор «от камеры» (−sin yaw, −cos yaw), а для «вправо» —
 * на правый вектор экрана (cos yaw, −sin yaw). На диагоналях допускается ничья.
 */
const GRID_VEC: Record<number, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

function best(vec: [number, number]): number {
  return Math.max(...[0, 1, 2, 3].map((d) => GRID_VEC[d]![0] * vec[0] + GRID_VEC[d]![1] * vec[1]));
}

describe('ввод относительно камеры', () => {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];

  it.each(angles)('yaw %i°: «вверх» — от экрана, «вправо» — вправо', (yaw) => {
    const r = (yaw * Math.PI) / 180;
    const fwd: [number, number] = [-Math.sin(r), -Math.cos(r)];
    const right: [number, number] = [Math.cos(r), -Math.sin(r)];
    const up = GRID_VEC[screenToGrid('up', yaw)]!;
    const rt = GRID_VEC[screenToGrid('right', yaw)]!;
    expect(up[0] * fwd[0] + up[1] * fwd[1]).toBeCloseTo(best(fwd), 6);
    expect(rt[0] * right[0] + rt[1] * right[1]).toBeCloseTo(best(right), 6);
  });

  it('таблица для всех 8 углов доводки', () => {
    // [вверх, вправо, вниз, влево] в сеточных направлениях 0=С 1=В 2=Ю 3=З
    const table: Record<number, number[]> = {
      0: [0, 1, 2, 3],
      45: [0, 1, 2, 3],
      90: [3, 0, 1, 2],
      135: [3, 0, 1, 2],
      180: [2, 3, 0, 1],
      225: [2, 3, 0, 1],
      270: [1, 2, 3, 0],
      315: [1, 2, 3, 0],
    };
    for (const yaw of angles) {
      expect((['up', 'right', 'down', 'left'] as const).map((d) => screenToGrid(d, yaw))).toEqual(table[yaw]);
    }
  });

  it('противоположные экранные направления дают противоположные сеточные', () => {
    for (const yaw of angles) {
      expect((screenToGrid('up', yaw) + 2) % 4).toBe(screenToGrid('down', yaw));
      expect((screenToGrid('left', yaw) + 2) % 4).toBe(screenToGrid('right', yaw));
    }
  });

  it('отрицательные и большие углы нормализуются', () => {
    expect(screenUpDir(-90)).toBe(screenUpDir(270));
    expect(screenUpDir(720 + 45)).toBe(screenUpDir(45));
  });

  it('взаимодействие и ожидание не зависят от камеры', () => {
    expect(screenActionToGrid('interact', 135)).toBe('interact');
    expect(screenActionToGrid('none', 135)).toBe('none');
    expect(screenActionToGrid('up', 90)).toBe('left');
  });
});

describe('свайпы вдоль плиток', () => {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const pitches = [20, 35, 75];

  it('при yaw 0° свайп вверх — на север, вправо — на восток', () => {
    expect(swipeToGrid(0, -50, 0, 35)).toBe(0);
    expect(swipeToGrid(50, 0, 0, 35)).toBe(1);
    expect(swipeToGrid(0, 50, 0, 35)).toBe(2);
    expect(swipeToGrid(-50, 0, 0, 35)).toBe(3);
  });

  it.each(angles)('yaw %i°: свайп точно по экранному образу направления даёт это направление', (yaw) => {
    for (const pitch of pitches)
      for (const d of [0, 1, 2, 3] as const) {
        const [x, y] = gridScreenVec(d, yaw, pitch);
        // Экранный y направлен вниз.
        expect(swipeToGrid(x * 60, -y * 60, yaw, pitch)).toBe(d);
      }
  });

  it('при yaw 45° свайп вверх-вправо идёт на север, а не «вверх экрана» мимо плиток', () => {
    // Изометрия: север виден вверх-вправо, запад — вверх-влево.
    expect(swipeToGrid(50, -30, 45, 35)).toBe(0);
    expect(swipeToGrid(-50, -30, 45, 35)).toBe(3);
    expect(swipeToGrid(50, 30, 45, 35)).toBe(1);
    expect(swipeToGrid(-50, 30, 45, 35)).toBe(2);
  });

  it('экранное направление из свайпа переводится обратно в то же сеточное', () => {
    for (const yaw of angles)
      for (const d of [0, 1, 2, 3] as const) {
        const [x, y] = gridScreenVec(d, yaw, 35);
        expect(screenToGrid(swipeToScreenDir(x, -y, yaw, 35), yaw)).toBe(d);
        expect(screenToGrid(gridToScreen(d, yaw), yaw)).toBe(d);
      }
  });

  it('D-pad поворачивается на 45° только на диагоналях', () => {
    expect(dpadRotation(0)).toBe(0);
    expect(dpadRotation(90)).toBe(0);
    expect(dpadRotation(45)).toBe(45);
    expect(dpadRotation(135)).toBe(45);
    expect(dpadRotation(315)).toBe(45);
  });
});
