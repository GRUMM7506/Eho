import * as THREE from 'three';
import { normDeg } from './relative';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface OrbitOptions {
  perspective: boolean;
  freeCamera: boolean;
  reducedMotion: boolean;
  /** Изометрия под 45°. Выключено — камера смотрит прямо вдоль сетки (свайпы и стрелки однозначны). */
  diagonal: boolean;
}

const PITCH_MIN = 20;
const PITCH_MAX = 75;
const DEFAULT_PITCH = 35;
/** Вид сверху: почти отвесно, видно всё, что прячется за стенами. */
const TOP_PITCH = 82;
const FOV = 32;

/**
 * Орбитальная камера вокруг центра уровня: ортографическая изометрия по умолчанию
 * (yaw 45°, pitch ≈35°), вращение с инерцией, доводка к углу, кратному 45°, зум, сдвиг.
 * Ничего не знает о симуляции.
 */
export class OrbitCamera {
  readonly ortho: THREE.OrthographicCamera;
  readonly persp: THREE.PerspectiveCamera;
  yaw = 45;
  pitch = DEFAULT_PITCH;
  /** Множитель зума пользователя (1 — уровень целиком). */
  userZoom = 1;
  private fitZoom = 6;
  private yawVel = 0;
  private pitchVel = 0;
  private yawTarget: number | null = null;
  private dragging = false;
  private readonly target = new THREE.Vector3();
  private readonly pan = new THREE.Vector3();
  private readonly bounds = new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 2, 4));
  private defaultYaw = 45;
  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private shakeAmp = 0;
  private shakeTime = 0;
  /** Облёт: плавное вращение для экрана победы и меню. */
  orbitSpeed = 0;
  opts: OrbitOptions = { perspective: false, freeCamera: false, reducedMotion: false, diagonal: false };
  /** Включён вид сверху. */
  topView = false;
  private pitchTarget: number | null = null;

  constructor() {
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.persp = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
  }

  get camera(): THREE.Camera {
    return this.opts.perspective ? this.persp : this.ortho;
  }

  /** Уровень задаёт границы и начальный угол. */
  setBounds(box: THREE.Box3, defaultYaw: number): void {
    this.bounds.copy(box);
    this.bounds.getCenter(this.target);
    this.levelYaw = defaultYaw;
    this.defaultYaw = this.straighten(defaultYaw);
    this.reset(true);
  }

  private levelYaw = 45;

  /** Шаг доводки: 45° в изометрии, 90° в прямом виде и сверху. */
  private get snapStep(): number {
    return this.opts.diagonal && !this.topView ? 45 : 90;
  }

  /** Угол уровня без диагонали, если изометрия выключена (45° → 0°). */
  private straighten(yaw: number): number {
    return this.opts.diagonal ? yaw : Math.floor(normDeg(yaw) / 90 + 1e-6) * 90;
  }

  /** Сменить режим (настройка): пересчитать угол по умолчанию и довернуть камеру. */
  setDiagonal(on: boolean): void {
    if (this.opts.diagonal === on) return;
    this.opts = { ...this.opts, diagonal: on };
    this.defaultYaw = this.straighten(this.levelYaw);
    if (!this.topView) this.yawTarget = this.nearestEquivalent(this.defaultYaw);
  }

  /** Вид сверху ↔ обычный вид. */
  toggleTopView(): void {
    this.setTopView(!this.topView);
  }

  setTopView(on: boolean): void {
    this.topView = on;
    this.pitchVel = 0;
    this.yawVel = 0;
    this.pitchTarget = on ? TOP_PITCH : DEFAULT_PITCH;
    const step = this.snapStep;
    this.yawTarget = on
      ? Math.round(this.inputYaw / 90) * 90
      : this.nearestEquivalent(Math.round(this.defaultYaw / step) * step);
  }

  reset(instant = false): void {
    this.pan.set(0, 0, 0);
    this.userZoom = 1;
    this.pitch = DEFAULT_PITCH;
    this.pitchVel = 0;
    this.yawVel = 0;
    this.topView = false;
    this.pitchTarget = null;
    if (instant) {
      this.yaw = this.defaultYaw;
      this.yawTarget = null;
    } else {
      this.yawTarget = this.nearestEquivalent(this.defaultYaw);
    }
    this.refit();
  }

  setViewport(width: number, height: number, insets: Insets): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = insets;
    this.refit();
  }

  beginDrag(): void {
    this.dragging = true;
    this.yawTarget = null;
    this.pitchTarget = null;
    this.yawVel = 0;
    this.pitchVel = 0;
  }

  endDrag(): void {
    this.dragging = false;
  }

  /** Вращение от жеста (в градусах за событие); dt нужен для оценки скорости инерции. */
  rotateBy(dYaw: number, dPitch: number, dt: number): void {
    this.yaw = normDeg(this.yaw + dYaw);
    // Ручной наклон выводит из вида сверху.
    if (this.topView && dPitch < 0) this.topView = false;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, PITCH_MIN, this.topView ? TOP_PITCH : PITCH_MAX);
    if (dt > 0) {
      this.yawVel = THREE.MathUtils.lerp(this.yawVel, dYaw / dt, 0.5);
      this.pitchVel = THREE.MathUtils.lerp(this.pitchVel, dPitch / dt, 0.5);
    }
    this.refit();
  }

  /** Поворот на 90° с анимацией (Q/E, бамперы). */
  turn(steps: number): void {
    const step = this.snapStep;
    const base = this.yawTarget ?? Math.round(this.yaw / step) * step;
    this.yawTarget = base + 90 * steps;
    this.yawVel = 0;
  }

  zoomBy(factor: number): void {
    this.userZoom = THREE.MathUtils.clamp(this.userZoom * factor, 0.35, 2.2);
  }

  /** Сдвиг в экранных пикселях. */
  panBy(dxPx: number, dyPx: number): void {
    const worldPerPx = (2 * this.zoom) / this.height;
    const yawR = THREE.MathUtils.degToRad(this.yaw);
    const right = new THREE.Vector3(Math.cos(yawR), 0, -Math.sin(yawR));
    const fwd = new THREE.Vector3(-Math.sin(yawR), 0, -Math.cos(yawR));
    const pitchR = THREE.MathUtils.degToRad(this.pitch);
    this.pan.addScaledVector(right, -dxPx * worldPerPx);
    this.pan.addScaledVector(fwd, (dyPx * worldPerPx) / Math.max(0.3, Math.sin(pitchR)));
    const size = this.bounds.getSize(new THREE.Vector3());
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -size.x / 2, size.x / 2);
    this.pan.z = THREE.MathUtils.clamp(this.pan.z, -size.z / 2, size.z / 2);
  }

  shake(amount: number): void {
    if (this.opts.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeTime = 0;
  }

  get zoom(): number {
    return this.fitZoom * this.userZoom;
  }

  private nearestEquivalent(targetDeg: number): number {
    // Ближайший к текущему yaw угол, эквивалентный целевому (чтобы крутить короткой дорогой).
    const diff = ((targetDeg - this.yaw + 540) % 360) - 180;
    return this.yaw + diff;
  }

  /** Подобрать зум так, чтобы уровень целиком влез в видимую область за вычетом HUD. */
  refit(): void {
    const yawR = THREE.MathUtils.degToRad(this.yaw);
    const pitchR = THREE.MathUtils.degToRad(this.pitch);
    const right = new THREE.Vector3(Math.cos(yawR), 0, -Math.sin(yawR));
    const back = new THREE.Vector3(
      Math.sin(yawR) * Math.cos(pitchR),
      Math.sin(pitchR),
      Math.cos(yawR) * Math.cos(pitchR),
    );
    const up = new THREE.Vector3().crossVectors(back, right).normalize();
    const c = this.bounds.getCenter(new THREE.Vector3());
    let ex = 0;
    let ey = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(
        i & 1 ? this.bounds.max.x : this.bounds.min.x,
        i & 2 ? this.bounds.max.y : this.bounds.min.y,
        i & 4 ? this.bounds.max.z : this.bounds.min.z,
      ).sub(c);
      ex = Math.max(ex, Math.abs(p.dot(right)));
      ey = Math.max(ey, Math.abs(p.dot(up)));
    }
    const fw = Math.max(0.2, (this.width - this.insets.left - this.insets.right) / this.width);
    const fh = Math.max(0.2, (this.height - this.insets.top - this.insets.bottom) / this.height);
    const aspect = this.width / this.height;
    this.fitZoom = Math.max(ey / fh, ex / (aspect * fw)) * 1.08 + 0.3;
  }

  update(dt: number): void {
    if (!this.dragging) {
      if (this.orbitSpeed) {
        this.yaw = normDeg(this.yaw + this.orbitSpeed * dt);
        this.refit();
      } else if (Math.abs(this.yawVel) > 20 && this.yawTarget === null) {
        this.yaw = normDeg(this.yaw + this.yawVel * dt);
        this.yawVel *= Math.exp(-dt * 5);
        this.refit();
      } else {
        this.yawVel = 0;
        if (this.yawTarget === null && !this.opts.freeCamera) {
          const step = this.snapStep;
          const snap = Math.round(this.yaw / step) * step;
          if (Math.abs(snap - this.yaw) > 0.01) this.yawTarget = snap;
        }
        if (this.yawTarget !== null) {
          const k = this.opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
          this.yaw += (this.yawTarget - this.yaw) * k;
          if (Math.abs(this.yawTarget - this.yaw) < 0.02) {
            this.yaw = normDeg(this.yawTarget);
            this.yawTarget = null;
          }
          this.refit();
        }
      }
      if (this.pitchTarget !== null) {
        const k = this.opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
        this.pitch += (this.pitchTarget - this.pitch) * k;
        if (Math.abs(this.pitchTarget - this.pitch) < 0.02) {
          this.pitch = this.pitchTarget;
          this.pitchTarget = null;
        }
        this.refit();
      } else if (Math.abs(this.pitchVel) > 10) {
        this.pitch = THREE.MathUtils.clamp(
          this.pitch + this.pitchVel * dt,
          PITCH_MIN,
          this.topView ? TOP_PITCH : PITCH_MAX,
        );
        this.pitchVel *= Math.exp(-dt * 6);
        this.refit();
      }
    }
    this.apply(dt);
  }

  /** Угол, по которому переводится ввод: цель доводки, если камера сейчас доворачивается. */
  get inputYaw(): number {
    return normDeg(this.yawTarget ?? this.yaw);
  }

  private apply(dt: number): void {
    const yawR = THREE.MathUtils.degToRad(this.yaw);
    const pitchR = THREE.MathUtils.degToRad(this.pitch);
    const dir = new THREE.Vector3(
      Math.sin(yawR) * Math.cos(pitchR),
      Math.sin(pitchR),
      Math.cos(yawR) * Math.cos(pitchR),
    );
    const target = this.target.clone().add(this.pan);
    if (this.shakeAmp > 0.001) {
      this.shakeTime += dt;
      const a = this.shakeAmp * Math.exp(-this.shakeTime * 9);
      target.x += Math.sin(this.shakeTime * 71) * a;
      target.z += Math.cos(this.shakeTime * 53) * a;
      target.y += Math.sin(this.shakeTime * 97) * a * 0.5;
      if (a < 0.002) this.shakeAmp = 0;
    }
    const zoom = this.zoom;
    const aspect = this.width / this.height;
    // Смещение кадра, чтобы уровень был по центру области без HUD.
    const offX = ((this.insets.left - this.insets.right) / this.width) * zoom * aspect;
    const offY = ((this.insets.bottom - this.insets.top) / this.height) * zoom;

    const o = this.ortho;
    o.left = -zoom * aspect - offX;
    o.right = zoom * aspect - offX;
    o.top = zoom - offY;
    o.bottom = -zoom - offY;
    o.position.copy(target).addScaledVector(dir, 120);
    o.up.set(0, 1, 0);
    o.lookAt(target);
    o.updateProjectionMatrix();

    const p = this.persp;
    p.aspect = aspect;
    const dist = zoom / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    p.position.copy(target).addScaledVector(dir, dist);
    p.up.set(0, 1, 0);
    p.lookAt(target);
    p.clearViewOffset();
    const fullH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * dist;
    const pxPerUnit = this.height / fullH;
    const shiftX = offX * pxPerUnit;
    const shiftY = offY * pxPerUnit;
    if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
      p.setViewOffset(this.width, this.height, -shiftX, shiftY, this.width, this.height);
    }
    p.near = Math.max(0.1, dist - 80);
    p.far = dist + 80;
    p.updateProjectionMatrix();
  }
}
