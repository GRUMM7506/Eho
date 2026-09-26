import * as THREE from 'three';
import type { SimEvent, WorldState } from '../core/types';
import type { GameView } from './gameView';
import { MECH_COLORS, PALETTE } from './palette';
import { Particles } from './particles';

/**
 * Визуальные эффекты поверх рендера: частицы, волна света, VHS-перемотка.
 * Реагирует на события симуляции и ничего не меняет в игровой логике.
 */
export class Effects {
  readonly particles = new Particles();
  private readonly waves: { mesh: THREE.Mesh; t: number; dur: number; max: number }[] = [];
  private reduced = false;

  constructor(private readonly view: GameView) {
    view.scene.add(this.particles.points);
    view.frameHooks.push((dt) => this.update(dt));
  }

  configure(quality: 'low' | 'medium' | 'high', reducedMotion: boolean): void {
    this.reduced = reducedMotion;
    this.particles.density = (quality === 'low' ? 0.35 : quality === 'medium' ? 0.7 : 1) * (reducedMotion ? 0.3 : 1);
  }

  private pos(cell: number, y = 0.3): THREE.Vector3 {
    const lv = this.view.level;
    if (!lv) return new THREE.Vector3();
    return lv.cellPos(cell, lv.floorY(cell) + y);
  }

  onEvents(prev: WorldState, next: WorldState, events: readonly SimEvent[]): void {
    const L = next.level;
    const p = this.particles;
    for (const e of events) {
      switch (e.type) {
        case 'plateDown': {
          const fx = L.fixtures[e.cell];
          const col = fx?.type === 'plate' ? MECH_COLORS[fx.color]! : PALETTE.ink;
          p.emit({ count: 26, origin: this.pos(e.cell, 0.08), color: col, speed: 2.2, up: 0.15, ring: true, gravity: 1.5, life: 0.5, size: 0.09, radius: 0.25 });
          break;
        }
        case 'teleport': {
          const fx = L.fixtures[e.from];
          const col = fx?.type === 'portal' ? MECH_COLORS[fx.color]! : PALETTE.cyan;
          for (const c of [e.from, e.to]) p.emit({ count: 30, origin: this.pos(c, 0.4), color: col, whiten: 0.6, speed: 1.8, up: 0.6, gravity: 0.5, life: 0.6, size: 0.1, radius: 0.3 });
          break;
        }
        case 'push':
          p.emit({ count: 10, origin: this.pos(e.from, 0.05), color: 0x9c95c9, speed: 0.9, up: 0.4, gravity: 2, life: 0.45, size: 0.12, radius: 0.35 });
          break;
        case 'boxFill':
          p.emit({ count: 24, origin: this.pos(e.cell, 0.05), color: 0x9c95c9, speed: 1.4, up: 0.8, gravity: 4, life: 0.6, size: 0.12, radius: 0.4 });
          break;
        case 'crack':
          p.emit({ count: 6, origin: this.pos(e.cell, 0.03), color: 0xb9a6ff, speed: 0.8, up: 0.8, gravity: 5, life: 0.4, size: 0.07, radius: 0.3 });
          break;
        case 'break':
          p.emit({ count: 40, origin: this.pos(e.cell, 0.02), color: 0x6b5a8e, whiten: 0.2, speed: 1.6, up: 0.5, gravity: 7, life: 0.9, size: 0.13, radius: 0.45 });
          break;
        case 'lever':
        case 'unlock':
        case 'socket':
          p.emit({ count: 14, origin: this.pos(e.cell, 0.5), color: PALETTE.player, speed: 1.4, up: 0.5, gravity: 3, life: 0.4, size: 0.07 });
          break;
        case 'pickup':
        case 'drop':
          p.emit({ count: 10, origin: this.pos(e.cell, 0.2), color: PALETTE.exit, speed: 1, up: 0.8, gravity: 2, life: 0.4, size: 0.06 });
          break;
        case 'paradox':
          p.emit({ count: 40, origin: this.pos(e.cell, 0.5), color: PALETTE.paradox, whiten: 0.2, speed: 2.4, up: 0.2, gravity: 1, life: 0.6, size: 0.1, radius: 0.2 });
          this.wave(e.cell, PALETTE.paradox, 1.6, 0.5);
          break;
        case 'death':
          p.emit({ count: 90, origin: this.pos(e.cell, 0.5), color: PALETTE.player, whiten: 0.4, speed: 3.2, up: 0.4, gravity: 5, life: 1, size: 0.13 });
          p.emit({ count: 40, origin: this.pos(e.cell, 0.5), color: PALETTE.paradox, speed: 2, up: 0.3, gravity: 3, life: 0.8, size: 0.11 });
          this.view.post.flash = 1;
          break;
        case 'win':
          this.celebrate(next, e.cell);
          break;
        default:
          break;
      }
    }
    void prev;
  }

  /** Победа: волна света от выхода по полу и конфетти в цветах уровня. */
  celebrate(s: WorldState, cell: number): void {
    const L = s.level;
    this.wave(cell, PALETTE.exit, Math.max(L.width, L.height) * 0.9, 1.4);
    const used = new Set<number>();
    for (const fx of L.fixtures) if (fx && 'color' in fx && typeof fx.color === 'number' && fx.color >= 0) used.add(fx.color);
    const colors = [PALETTE.exit, PALETTE.player, PALETTE.echo, ...[...used].map((c) => MECH_COLORS[c]!)];
    const bursts = this.reduced ? 2 : 6;
    for (let i = 0; i < bursts; i++) {
      window.setTimeout(() => {
        this.particles.emit({ count: 60, origin: this.pos(cell, 0.3), color: colors[i % colors.length]!, whiten: 0.2, speed: 4.2, up: 1.4, spread: 0.8, gravity: 5, life: 1.8, size: 0.11 });
      }, i * 140);
    }
    this.view.post.flash = 0.6;
  }

  /** Расходящееся светящееся кольцо по полу. */
  wave(cell: number, color: number, maxRadius: number, dur: number): void {
    if (this.reduced && maxRadius < 3) return;
    const geo = new THREE.RingGeometry(0.85, 1, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.pos(cell, 0.04));
    mesh.scale.setScalar(0.1);
    this.view.scene.add(mesh);
    this.waves.push({ mesh, t: 0, dur, max: maxRadius });
  }

  /** VHS-перемотка при записи эха или конце времени. */
  vhs(seconds: number): void {
    const post = this.view.post;
    post.vhsHold = 1;
    window.setTimeout(() => (post.vhsHold = 0), seconds * 1000);
  }

  private update(dt: number): void {
    this.particles.update(dt);
    const o = this.view.orbit;
    const h = this.view.renderer.domElement.height;
    this.particles.setScale(o.opts.perspective ? h / 0.573 : h / (2 * o.zoom));
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]!;
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      w.mesh.scale.setScalar(0.1 + k * w.max);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.view.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        this.waves.splice(i, 1);
      }
    }
  }
}
