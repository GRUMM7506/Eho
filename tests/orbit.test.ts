import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OrbitCamera } from '../src/camera/orbit';

const box = new THREE.Box3(new THREE.Vector3(-4, 0, -3), new THREE.Vector3(4, 1, 3));

function settle(o: OrbitCamera): void {
  for (let i = 0; i < 300; i++) o.update(1 / 60);
}

describe('орбитальная камера', () => {
  it('по умолчанию смотрит прямо вдоль сетки, а не под 45°', () => {
    const o = new OrbitCamera();
    o.setBounds(box, 45);
    expect(o.inputYaw).toBe(0);
  });

  it('изометрия включается настройкой', () => {
    const o = new OrbitCamera();
    o.opts = { ...o.opts, diagonal: true };
    o.setBounds(box, 45);
    expect(o.inputYaw).toBe(45);
    o.setDiagonal(false);
    settle(o);
    expect(o.inputYaw % 90).toBe(0);
  });

  it('в прямом виде поворот идёт на 90°', () => {
    const o = new OrbitCamera();
    o.setBounds(box, 45);
    o.turn(1);
    settle(o);
    expect(o.inputYaw).toBe(90);
  });

  it('вид сверху поднимает камеру и выравнивает её по сетке, повторное нажатие возвращает', () => {
    const o = new OrbitCamera();
    o.opts = { ...o.opts, diagonal: true };
    o.setBounds(box, 45);
    o.toggleTopView();
    settle(o);
    expect(o.topView).toBe(true);
    expect(o.pitch).toBeGreaterThan(75);
    expect(o.inputYaw % 90).toBe(0);
    o.toggleTopView();
    settle(o);
    expect(o.topView).toBe(false);
    expect(o.pitch).toBeCloseTo(35, 1);
    expect(o.inputYaw).toBe(45);
  });
});
