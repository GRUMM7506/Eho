import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { guardSight } from '../core/mechanics/guards';
import { mirrorOrient, emitterActive } from '../core/mechanics/lasers';
import { FRAGILE_BROKEN, HOLE_FILLED } from '../core/mechanics/fragile';
import type { Fixture, Level, Mover, SimEvent, WorldState } from '../core/types';
import { toDraft } from '../core/world';
import {
  createBatteryModel,
  createBoxModel,
  createEchoModel,
  createGuardModel,
  createKeyModel,
  createPedestal,
  createPlayerModel,
  disposeObject,
  type ActorModel,
} from './models';
import { FLOOR_UNIT, PALETTE, WALL_HEIGHT, mechColor } from './palette';
import { applyDitherFade, createPortalMaterial } from './shaders';
import { conveyorTexture, crackTexture, floorTexture, gridTexture, hatchTexture, symbolTexture } from './textures';

export interface ViewOptions {
  shadows: boolean;
  colorblind: boolean;
}

interface Waypoint {
  cell: number;
  y: number;
  jump: boolean;
  hop: boolean;
}

interface FixtureView {
  cell: number;
  obj: THREE.Object3D;
  update(s: WorldState, dt: number, time: number): void;
}

interface ActorView {
  model: ActorModel;
  path: Waypoint[];
  yaw: number;
  broken: number;
  dead: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const FACING_YAW = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];

/**
 * 3D-представление уровня. Читает снимки симуляции и никогда их не меняет.
 * Статика (пол, стены) собрана в InstancedMesh, чтобы было мало вызовов отрисовки.
 */
export class LevelView {
  readonly root = new THREE.Group();
  readonly level: Level;
  private readonly opts: ViewOptions;
  private state: WorldState;
  private walls: THREE.InstancedMesh | null = null;
  private wallCells: number[] = [];
  private wallFade: Float32Array = new Float32Array(0);
  private wallFadeTarget: Float32Array = new Float32Array(0);
  private fixtures: FixtureView[] = [];
  private actors: ActorView[] = [];
  private boxes: { mesh: THREE.Mesh; path: Waypoint[]; sink: number }[] = [];
  private items: THREE.Group[] = [];
  private guards: { model: ActorModel; path: Waypoint[]; yaw: number }[] = [];
  private readonly beamGroup = new THREE.Group();
  private readonly sightGroup = new THREE.Group();
  private readonly beamMat = new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private readonly sightMat = new THREE.MeshBasicMaterial({ color: PALETTE.paradox, transparent: true, opacity: 0.16, depthWrite: false });
  private readonly shared: { geo: THREE.BufferGeometry[]; mat: THREE.Material[] } = { geo: [], mat: [] };
  private conveyorTex: THREE.Texture | null = null;

  constructor(level: Level, state: WorldState, opts: ViewOptions) {
    this.level = level;
    this.state = state;
    this.opts = opts;
    this.root.add(this.beamGroup, this.sightGroup);
    this.buildStatic();
    this.buildFixtures();
    this.buildEntities(state);
    this.setState(state);
  }

  // ————— координаты —————

  cellPos(cell: number, y = 0): THREE.Vector3 {
    const L = this.level;
    return new THREE.Vector3((cell % L.width) - L.width / 2 + 0.5, y, Math.floor(cell / L.width) - L.height / 2 + 0.5);
  }

  floorY(cell: number, s: WorldState = this.state): number {
    const fx = this.level.fixtures[cell];
    if (fx?.type === 'lift') return ((s.cells[cell] ?? 0) ? fx.high : fx.low) * FLOOR_UNIT;
    return (this.level.heights[cell] ?? 0) * FLOOR_UNIT;
  }

  bounds(): THREE.Box3 {
    const L = this.level;
    const maxH = Math.max(0, ...L.heights) * FLOOR_UNIT + WALL_HEIGHT;
    return new THREE.Box3(new THREE.Vector3(-L.width / 2, 0, -L.height / 2), new THREE.Vector3(L.width / 2, maxH, L.height / 2));
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if (x instanceof THREE.BufferGeometry) this.shared.geo.push(x);
    else this.shared.mat.push(x);
    return x;
  }

  // ————— статика —————

  private buildStatic(): void {
    const L = this.level;
    const n = L.width * L.height;
    const floorCells: number[] = [];
    const pillarCells: number[] = [];
    const special = new Set(['pit', 'fragile', 'ice', 'conveyor', 'lift', 'stairs']);
    for (let c = 0; c < n; c++) {
      if (L.terrain[c] === 'wall') this.wallCells.push(c);
      else if (L.terrain[c] === 'floor') {
        const fx = L.fixtures[c];
        if (!fx || !special.has(fx.type)) floorCells.push(c);
        if ((L.heights[c] ?? 0) > 0 && fx?.type !== 'lift' && fx?.type !== 'stairs') pillarCells.push(c);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    // Пол: плитки с тонкими швами.
    const floorGeo = this.track(new THREE.BoxGeometry(1, 0.1, 1));
    floorGeo.translate(0, -0.05, 0);
    const floorMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, map: floorTexture(), roughness: 0.85, metalness: 0.05 }));
    const floors = new THREE.InstancedMesh(floorGeo, floorMat, Math.max(1, floorCells.length));
    floors.count = floorCells.length;
    const tint = new THREE.Color();
    floorCells.forEach((c, i) => {
      m.compose(this.cellPos(c, this.floorY(c)), q, one);
      floors.setMatrixAt(i, m);
      const zone = L.solidZone[c];
      const alt = ((c % L.width) + Math.floor(c / L.width)) % 2 === 0;
      tint.set(zone ? 0x2a2266 : alt ? PALETTE.floor : PALETTE.floorAlt);
      floors.setColorAt(i, tint);
    });
    floors.receiveShadow = true;
    this.root.add(floors);

    // Зона твёрдого эхо: сетка поверх плиток.
    const zoneCells = floorCells.filter((c) => L.solidZone[c]);
    if (zoneCells.length) {
      const zg = this.track(new THREE.PlaneGeometry(0.98, 0.98));
      zg.rotateX(-Math.PI / 2);
      const zm = this.track(new THREE.MeshBasicMaterial({ color: PALETTE.violet, alphaMap: gridTexture(), transparent: true, opacity: 0.35, depthWrite: false }));
      const zones = new THREE.InstancedMesh(zg, zm, zoneCells.length);
      zoneCells.forEach((c, i) => {
        m.compose(this.cellPos(c, this.floorY(c) + 0.005), q, one);
        zones.setMatrixAt(i, m);
      });
      this.root.add(zones);
    }

    // Опоры приподнятых клеток.
    if (pillarCells.length) {
      const pg = this.track(new THREE.BoxGeometry(1, 1, 1));
      pg.translate(0, 0.5, 0);
      const pm = this.track(new THREE.MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.9 }));
      const pillars = new THREE.InstancedMesh(pg, pm, pillarCells.length);
      pillarCells.forEach((c, i) => {
        const h = this.floorY(c) - 0.1;
        m.compose(this.cellPos(c, 0), q, new THREE.Vector3(1, Math.max(0.01, h), 1));
        pillars.setMatrixAt(i, m);
      });
      pillars.castShadow = true;
      pillars.receiveShadow = true;
      this.root.add(pillars);
    }

    // Стены: блоки со скошенной кромкой; верхняя грань светлее.
    if (this.wallCells.length) {
      const shape = new THREE.Shape();
      const hs = 0.46;
      shape.moveTo(-hs, -hs);
      shape.lineTo(hs, -hs);
      shape.lineTo(hs, hs);
      shape.lineTo(-hs, hs);
      shape.closePath();
      const wg = this.track(
        new THREE.ExtrudeGeometry(shape, { depth: 0.92, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 }),
      );
      wg.rotateX(-Math.PI / 2);
      wg.translate(0, 0.04, 0);
      wg.computeBoundingBox();
      const bb = wg.boundingBox!;
      wg.translate(0, -bb.min.y, 0);
      wg.scale(1, 1 / (bb.max.y - bb.min.y), 1);
      const top = this.track(new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.7, emissive: PALETTE.wallTop, emissiveIntensity: 0.12 }));
      const side = this.track(new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.8 }));
      applyDitherFade(top);
      applyDitherFade(side);
      this.wallFade = new Float32Array(this.wallCells.length).fill(1);
      this.wallFadeTarget = new Float32Array(this.wallCells.length).fill(1);
      wg.setAttribute('aFade', new THREE.InstancedBufferAttribute(this.wallFade, 1));
      const walls = new THREE.InstancedMesh(wg, [top, side], this.wallCells.length);
      this.wallCells.forEach((c, i) => {
        const h = this.floorY(c) + WALL_HEIGHT;
        m.compose(this.cellPos(c, 0), q, new THREE.Vector3(1, h, 1));
        walls.setMatrixAt(i, m);
      });
      walls.castShadow = this.opts.shadows;
      walls.receiveShadow = true;
      this.walls = walls;
      this.root.add(walls);
    }

    // Нижняя плоскость-подложка, чтобы уровень не висел в пустоте.
    const base = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(L.width + 40, L.height + 40)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x0a0818, roughness: 1 })),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.6;
    base.receiveShadow = true;
    this.root.add(base);
  }

  get wallMesh(): THREE.InstancedMesh | null {
    return this.walls;
  }

  /** Отметить стены, заслоняющие игрока (по результату луча от камеры). */
  setOccluders(instanceIds: ReadonlySet<number>): void {
    for (let i = 0; i < this.wallFadeTarget.length; i++) this.wallFadeTarget[i] = instanceIds.has(i) ? 0.22 : 1;
  }

  // ————— приспособления —————

  private symbolDecal(colorId: number, size: number, y: number): THREE.Mesh | null {
    if (!this.opts.colorblind || colorId < 0) return null;
    const g = this.track(new THREE.PlaneGeometry(size, size));
    g.rotateX(-Math.PI / 2);
    const mat = this.track(new THREE.MeshBasicMaterial({ map: symbolTexture(colorId), transparent: true, depthWrite: false, color: 0x0d0b1e }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.y = y;
    mesh.renderOrder = 2;
    return mesh;
  }

  private buildFixtures(): void {
    const L = this.level;
    L.fixtures.forEach((fx, cell) => {
      if (!fx) return;
      const v = this.makeFixture(fx, cell);
      if (!v) return;
      v.obj.position.copy(this.cellPos(cell, this.floorY(cell)));
      this.root.add(v.obj);
      this.fixtures.push(v);
    });
  }

  private makeFixture(fx: Fixture, cell: number): FixtureView | null {
    const g = new THREE.Group();
    switch (fx.type) {
      case 'plate': {
        const col = mechColor(fx.color);
        const mat = this.track(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.4 }));
        const shapeGeo =
          fx.filter === 'echo'
            ? new THREE.CylinderGeometry(0.34, 0.34, 0.08, 4)
            : fx.filter === 'player'
              ? new THREE.CylinderGeometry(0.32, 0.32, 0.08, 6)
              : new THREE.CylinderGeometry(0.32, 0.34, 0.08, 28);
        const top = new THREE.Mesh(this.track(shapeGeo), mat);
        top.position.y = 0.04;
        top.receiveShadow = true;
        g.add(top);
        const ring = new THREE.Mesh(
          this.track(new THREE.RingGeometry(0.36, 0.42, fx.filter === 'echo' ? 4 : fx.filter === 'player' ? 6 : 32)),
          this.track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, toneMapped: false })),
        );
        ring.rotation.x = -Math.PI / 2;
        if (fx.filter === 'echo') ring.rotation.z = Math.PI / 4;
        ring.position.y = 0.01;
        g.add(ring);
        const sym = this.symbolDecal(fx.color, 0.42, 0.085);
        if (sym) top.add(sym);
        let depth = 0;
        return {
          cell,
          obj: g,
          update: (s, dt) => {
            const on = (s.cells[cell] ?? 0) > 0;
            depth = approach(depth, on ? 1 : 0, 18, dt);
            top.position.y = 0.04 - depth * 0.05;
            mat.emissiveIntensity = 0.25 + depth * 1.6;
          },
        };
      }
      case 'door':
      case 'timerDoor':
      case 'lock': {
        const colorId = fx.type === 'timerDoor' ? -1 : fx.color;
        const col = mechColor(colorId);
        const inverse = fx.type === 'door' && fx.inverse;
        const mat = this.track(
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 0.55,
            roughness: 0.35,
            transparent: true,
            opacity: 0.88,
            map: inverse ? hatchTexture() : null,
            emissiveMap: inverse ? hatchTexture() : null,
          }),
        );
        const slab = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.9, WALL_HEIGHT * 0.95, 0.9, 2, 0.04)), mat);
        slab.castShadow = true;
        const holder = new THREE.Group();
        holder.add(slab);
        slab.position.y = (WALL_HEIGHT * 0.95) / 2;
        g.add(holder);
        const frame = new THREE.Mesh(
          this.track(new THREE.RingGeometry(0.44, 0.49, 4, 1)),
          this.track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, toneMapped: false })),
        );
        frame.rotation.x = -Math.PI / 2;
        frame.rotation.z = Math.PI / 4;
        frame.position.y = 0.01;
        g.add(frame);
        if (fx.type === 'lock') {
          const shackle = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.16, 0.04, 8, 16, Math.PI)), this.track(new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.2 })));
          shackle.position.set(0, WALL_HEIGHT * 0.95 + 0.02, 0);
          holder.add(shackle);
        }
        const sym = this.symbolDecal(colorId, 0.6, WALL_HEIGHT * 0.95 + 0.01);
        if (sym) holder.add(sym);
        let open = 0;
        return {
          cell,
          obj: g,
          update: (s, dt) => {
            const target = (s.cells[cell] ?? 0) > 0 ? 1 : 0;
            open = approach(open, target, 12, dt);
            holder.position.y = -open * WALL_HEIGHT * 0.97;
            holder.visible = open < 0.98;
          },
        };
      }
      case 'lever': {
        g.add(createPedestal());
        const col = mechColor(fx.color);
        const pivot = new THREE.Group();
        pivot.position.y = 0.3;
        const stick = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8)), this.track(new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 })));
        stick.position.y = 0.2;
        const knobMat = this.track(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8 }));
        const knob = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.08, 12, 10)), knobMat);
        knob.position.y = 0.42;
        pivot.add(stick, knob);
        g.add(pivot);
        const sym = this.symbolDecal(fx.color, 0.4, 0.31);
        if (sym) g.add(sym);
        let a = 0;
        return {
          cell,
          obj: g,
          update: (s, dt) => {
            const on = (s.cells[cell] ?? 0) > 0;
            a = approach(a, on ? 1 : -1, 14, dt);
            pivot.rotation.x = a * 0.6;
            knobMat.emissiveIntensity = on ? 2 : 0.6;
          },
        };
      }
      case 'socket': {
        g.add(createPedestal());
        const col = mechColor(fx.color);
        const ringMat = this.track(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 }));
        const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.16, 0.04, 8, 24)), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.31;
        g.add(ring);
        const sym = this.symbolDecal(fx.color, 0.3, 0.305);
        if (sym) g.add(sym);
        return {
          cell,
          obj: g,
          update: (s) => {
            ringMat.emissiveIntensity = (s.cells[cell] ?? 0) > 0 ? 2.2 : 0.4;
          },
        };
      }
      case 'portal': {
        const col = mechColor(fx.color);
        const disc = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.42, 40)), this.track(createPortalMaterial(col)));
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.02;
        const ringMat = this.track(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.3 }));
        const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.42, 0.04, 8, 40)), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        g.add(disc, ring);
        const sym = this.symbolDecal(fx.color, 0.3, 0.03);
        if (sym) g.add(sym);
        const pmat = disc.material as THREE.ShaderMaterial;
        return {
          cell,
          obj: g,
          update: (_s, dt, time) => {
            pmat.uniforms.uTime!.value = time;
            pmat.uniforms.uFlash!.value = Math.max(0, (pmat.uniforms.uFlash!.value as number) - dt * 3);
            ring.rotation.z = time * 0.8;
            ring.position.y = 0.06 + Math.sin(time * 2) * 0.02;
          },
        };
      }
      case 'conveyor': {
        this.conveyorTex ??= conveyorTexture();
        const tile = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.98, 0.1, 0.98)), this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.conveyorTex, roughness: 0.7 })));
        tile.position.y = -0.05;
        tile.rotation.y = -fx.dir * (Math.PI / 2);
        tile.receiveShadow = true;
        g.add(tile);
        return { cell, obj: g, update: () => undefined };
      }
      case 'ice': {
        const tile = new THREE.Mesh(
          this.track(new THREE.BoxGeometry(0.98, 0.1, 0.98)),
          this.track(new THREE.MeshStandardMaterial({ color: PALETTE.ice, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75, emissive: 0x2a6f8a, emissiveIntensity: 0.3 })),
        );
        tile.position.y = -0.05;
        tile.receiveShadow = true;
        g.add(tile);
        return { cell, obj: g, update: () => undefined };
      }
      case 'fragile':
      case 'pit': {
        const hole = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.98, 0.6, 0.98)), this.track(new THREE.MeshStandardMaterial({ color: 0x050410, roughness: 1 })));
        hole.position.y = -0.62;
        g.add(hole);
        const tileMat = this.track(new THREE.MeshStandardMaterial({ color: fx.type === 'pit' ? PALETTE.box : 0x3a3170, map: crackTexture(0), roughness: 0.9 }));
        const tile = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.98, 0.1, 0.98)), tileMat);
        tile.position.y = -0.05;
        tile.receiveShadow = true;
        g.add(tile);
        let fall = 0;
        let lastLevel = -1;
        return {
          cell,
          obj: g,
          update: (s, dt) => {
            const reg = s.cells[cell] ?? 0;
            const isHole = fx.type === 'pit' ? reg !== HOLE_FILLED : reg === FRAGILE_BROKEN;
            fall = approach(fall, isHole ? 1 : 0, 6, dt);
            tile.position.y = -0.05 - fall * 0.8;
            tile.visible = fall < 0.95;
            if (fx.type === 'fragile' && !isHole) {
              const lvl = Math.min(3, Math.round((reg / fx.durability) * 3));
              if (lvl !== lastLevel) {
                tileMat.map = crackTexture(lvl);
                tileMat.needsUpdate = true;
                lastLevel = lvl;
              }
            }
            if (fx.type === 'pit') tileMat.color.set(reg === HOLE_FILLED ? PALETTE.box : 0x3a3170);
          },
        };
      }
      case 'emitter': {
        g.add(createPedestal());
        const barrelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3b1020, emissive: PALETTE.paradox, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
        const barrel = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.1, 0.13, 0.4, 12)), barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.y = 0.45;
        const holder = new THREE.Group();
        holder.add(barrel);
        holder.rotation.y = FACING_YAW[fx.dir]!;
        barrel.position.z = 0.1;
        g.add(holder);
        const d = toDraft(this.state);
        return {
          cell,
          obj: g,
          update: (s) => {
            d.signals = s.signals.slice();
            barrelMat.emissiveIntensity = emitterActive(d, cell, s.signals) ? 1.8 : 0.2;
          },
        };
      }
      case 'mirror': {
        g.add(createPedestal());
        const mat = this.track(new THREE.MeshStandardMaterial({ color: 0xdfe6ff, metalness: 1, roughness: 0.05, emissive: fx.color >= 0 ? mechColor(fx.color) : new THREE.Color(0x333333), emissiveIntensity: 0.4 }));
        const plate = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.72, 0.4, 0.05)), mat);
        plate.position.y = 0.5;
        const pivot = new THREE.Group();
        pivot.add(plate);
        g.add(pivot);
        const sym = this.symbolDecal(fx.color, 0.3, 0.305);
        if (sym) g.add(sym);
        let rot = fx.orient === '/' ? Math.PI / 4 : -Math.PI / 4;
        const d = toDraft(this.state);
        return {
          cell,
          obj: g,
          update: (s, dt) => {
            const o = mirrorOrient(d, cell, s.signals);
            rot = approach(rot, o === '/' ? Math.PI / 4 : -Math.PI / 4, 10, dt);
            pivot.rotation.y = rot;
          },
        };
      }
      case 'receiver': {
        g.add(createPedestal());
        const col = mechColor(fx.color);
        const mat = this.track(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3, flatShading: true, roughness: 0.2 }));
        const gem = new THREE.Mesh(this.track(new THREE.IcosahedronGeometry(0.17, 0)), mat);
        gem.position.y = 0.5;
        g.add(gem);
        const sym = this.symbolDecal(fx.color, 0.3, 0.305);
        if (sym) g.add(sym);
        return {
          cell,
          obj: g,
          update: (s, _dt, time) => {
            const on = (s.cells[cell] ?? 0) > 0;
            mat.emissiveIntensity = on ? 2.5 : 0.3;
            gem.rotation.y = time * (on ? 2 : 0.4);
          },
        };
      }
      case 'stairs': {
        const L = this.level;
        const h = L.heights[cell] ?? 0;
        // Ступени поднимаются от самого низкого соседа.
        let lowDir = 0;
        let lowH = Infinity;
        for (let d = 0; d < 4; d++) {
          const x = (cell % L.width) + [0, 1, 0, -1][d]!;
          const y = Math.floor(cell / L.width) + [-1, 0, 1, 0][d]!;
          if (x < 0 || y < 0 || x >= L.width || y >= L.height) continue;
          const n = y * L.width + x;
          if (L.terrain[n] !== 'floor') continue;
          const nh = L.heights[n] ?? 0;
          if (nh < lowH) {
            lowH = nh;
            lowDir = d;
          }
        }
        const mat = this.track(new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.7 }));
        const steps = new THREE.Group();
        // Локальные координаты: 0 — пол клетки (этаж h), низ — земля.
        const ground = -h * FLOOR_UNIT - 0.1;
        const low = (Math.min(lowH, h) - h) * FLOOR_UNIT;
        const n = lowH < h ? 4 : 1;
        for (let i = 0; i < n; i++) {
          const top = n === 1 ? 0 : low + ((i + 1) / n) * -low;
          const depth = 0.98 / n;
          const s = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.98, top - ground, depth)), mat);
          s.position.set(0, (top + ground) / 2, 0.49 - depth / 2 - i * depth);
          s.castShadow = s.receiveShadow = true;
          steps.add(s);
        }
        // Нижняя ступень смотрит в сторону низкого соседа.
        steps.rotation.y = FACING_YAW[lowDir]!;
        g.add(steps);
        return { cell, obj: g, update: () => undefined };
      }
      case 'lift': {
        const col = mechColor(fx.color);
        const shaft = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.98, 1, 0.98)), this.track(new THREE.MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.9 })));
        const platMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2c2560, emissive: col, emissiveIntensity: 0.35, roughness: 0.5 }));
        const plat = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.96, 0.14, 0.96, 2, 0.03)), platMat);
        plat.receiveShadow = true;
        g.add(shaft, plat);
        const sym = this.symbolDecal(fx.color, 0.4, 0.075);
        if (sym) plat.add(sym);
        let y = this.floorY(cell);
        return {
          cell,
          obj: g,
          update: (s, dt) => {
            y = approach(y, this.floorY(cell, s), 7, dt);
            // Группа стоит на y = 0, платформа и шахта двигаются внутри.
            g.position.y = 0;
            plat.position.y = y - 0.07;
            shaft.scale.y = Math.max(0.01, y - 0.14);
            shaft.position.y = shaft.scale.y / 2;
          },
        };
      }
      case 'exit': {
        const mat = this.track(new THREE.MeshBasicMaterial({ color: PALETTE.exit, toneMapped: false }));
        const frame = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.4, 0.035, 6, 4)), mat);
        frame.rotation.x = -Math.PI / 2;
        frame.rotation.z = Math.PI / 4;
        frame.position.y = 0.03;
        const col = new THREE.Mesh(
          this.track(new THREE.CylinderGeometry(0.34, 0.4, 2.2, 24, 1, true)),
          this.track(new THREE.MeshBasicMaterial({ color: PALETTE.exit, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })),
        );
        col.position.y = 1.1;
        const inner = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.5)), this.track(new THREE.MeshBasicMaterial({ color: PALETTE.exit, transparent: true, opacity: 0.35, toneMapped: false })));
        inner.rotation.x = -Math.PI / 2;
        inner.rotation.z = Math.PI / 4;
        inner.position.y = 0.02;
        g.add(frame, col, inner);
        return {
          cell,
          obj: g,
          update: (_s, _dt, time) => {
            const p = (Math.sin(time * 2.4) + 1) / 2;
            (col.material as THREE.MeshBasicMaterial).opacity = 0.08 + p * 0.1;
            (inner.material as THREE.MeshBasicMaterial).opacity = 0.25 + p * 0.25;
            frame.position.y = 0.03 + p * 0.03;
          },
        };
      }
    }
  }

  // ————— сущности —————

  private buildEntities(s: WorldState): void {
    for (const _ of s.boxes) {
      const { mesh } = createBoxModel();
      this.root.add(mesh);
      this.boxes.push({ mesh, path: [], sink: 0 });
    }
    for (const it of s.items) {
      const m = it.kind === 'key' ? createKeyModel(it.color) : createBatteryModel();
      this.root.add(m);
      this.items.push(m);
    }
    for (let i = 0; i < s.guards.length; i++) {
      const model = createGuardModel();
      this.root.add(model.root);
      this.guards.push({ model, path: [], yaw: 0 });
    }
    this.syncActors(s);
  }

  /** Число эхо меняется между петлями — пересобираем модели акторов. */
  private syncActors(s: WorldState): void {
    const want = s.actors.length;
    const kinds = s.actors.map((a) => a.kind).join();
    const have = this.actors.map((a) => (a.model.hologram ? 'echo' : 'player')).join();
    if (this.actors.length === want && kinds === have) return;
    for (const a of this.actors) {
      this.root.remove(a.model.root);
      disposeObject(a.model.root);
    }
    this.actors = s.actors.map((a, i) => {
      const model = a.kind === 'player' ? createPlayerModel() : createEchoModel(i);
      this.root.add(model.root);
      return { model, path: [], yaw: FACING_YAW[a.facing]!, broken: 0, dead: 0 };
    });
  }

  // ————— состояние и интерполяция —————

  /** Мгновенно показать снимок (новая петля, перемотка). */
  setState(s: WorldState): void {
    this.state = s;
    this.syncActors(s);
    s.actors.forEach((a, i) => {
      const v = this.actors[i]!;
      v.path = [{ cell: a.cell, y: this.floorY(a.cell, s) + (a.riding ? FLOOR_UNIT * 2 : 0), jump: false, hop: false }];
      v.yaw = FACING_YAW[a.facing]!;
      v.broken = a.status === 'broken' ? 1 : 0;
      v.dead = a.status === 'dead' ? 1 : 0;
    });
    s.boxes.forEach((b, i) => {
      const v = this.boxes[i]!;
      v.path = b >= 0 ? [{ cell: b, y: this.floorY(b, s), jump: false, hop: false }] : [];
      v.sink = b >= 0 ? 0 : 1;
    });
    s.guards.forEach((g, i) => {
      const v = this.guards[i]!;
      v.path = [{ cell: g.cell, y: this.floorY(g.cell, s), jump: false, hop: false }];
      v.yaw = FACING_YAW[g.facing]!;
    });
    this.rebuildBeams(s);
    this.rebuildSight(s);
  }

  /** Начало анимации тика: пути по событиям (шаги, скольжение, конвейер, телепорт). */
  setTick(prev: WorldState, next: WorldState, events: readonly SimEvent[]): void {
    this.state = next;
    this.syncActors(next);
    const actorPaths: Waypoint[][] = prev.actors.map((a) => [{ cell: a.cell, y: this.floorY(a.cell, prev) + (a.riding ? FLOOR_UNIT * 2 : 0), jump: false, hop: false }]);
    const boxPaths: Waypoint[][] = prev.boxes.map((b) => (b >= 0 ? [{ cell: b, y: this.floorY(b, prev), jump: false, hop: false }] : []));
    const push = (m: Mover, cell: number, jump: boolean, hop: boolean) => {
      const list = m.kind === 'actor' ? actorPaths[m.index] : boxPaths[m.index];
      list?.push({ cell, y: this.floorY(cell, next), jump, hop });
    };
    for (const e of events) {
      switch (e.type) {
        case 'step':
          push({ kind: 'actor', index: e.actor }, e.to, false, true);
          break;
        case 'push':
          push({ kind: 'box', index: e.box }, e.to, false, false);
          break;
        case 'slide':
        case 'conveyor':
          push(e.mover, e.to, false, false);
          break;
        case 'teleport':
          push(e.mover, e.to, true, false);
          break;
        default:
          break;
      }
    }
    next.actors.forEach((a, i) => {
      const v = this.actors[i]!;
      const p = actorPaths[i] ?? [];
      const last = p[p.length - 1];
      const y = this.floorY(a.cell, next) + (a.riding ? FLOOR_UNIT * 2 : 0);
      if (!last || last.cell !== a.cell) p.push({ cell: a.cell, y, jump: false, hop: false });
      else last.y = y;
      v.path = p;
    });
    next.boxes.forEach((b, i) => {
      const v = this.boxes[i]!;
      const p = boxPaths[i] ?? [];
      if (b >= 0) {
        const last = p[p.length - 1];
        if (!last || last.cell !== b) p.push({ cell: b, y: this.floorY(b, next), jump: false, hop: false });
      }
      v.path = p;
    });
    next.guards.forEach((g, i) => {
      const v = this.guards[i]!;
      const from = prev.guards[i]!.cell;
      v.path = [
        { cell: from, y: this.floorY(from, prev), jump: false, hop: false },
        { cell: g.cell, y: this.floorY(g.cell, next), jump: false, hop: from !== g.cell },
      ];
    });
    this.rebuildBeams(next);
    this.rebuildSight(next);
    for (const e of events) {
      if (e.type === 'teleport') {
        for (const f of this.fixtures) {
          if (f.cell === e.from || f.cell === e.to) {
            f.obj.traverse((o) => {
              const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
              if (mat && 'uniforms' in mat && mat.uniforms.uFlash) mat.uniforms.uFlash.value = 1;
            });
          }
        }
      }
    }
  }

  private samplePath(path: Waypoint[], alpha: number, out: THREE.Vector3): { hop: number; jumpScale: number } {
    if (!path.length) return { hop: 0, jumpScale: 1 };
    if (path.length === 1 || alpha >= 1) {
      const w = path[path.length - 1]!;
      out.copy(this.cellPos(w.cell, w.y));
      return { hop: 0, jumpScale: 1 };
    }
    const segs = path.length - 1;
    const f = Math.min(segs - 1e-6, alpha * segs);
    const i = Math.floor(f);
    const t = f - i;
    const a = path[i]!;
    const b = path[i + 1]!;
    if (b.jump) {
      const w = t < 0.5 ? a : b;
      out.copy(this.cellPos(w.cell, w.y));
      return { hop: 0, jumpScale: Math.abs(t - 0.5) * 2 };
    }
    const e = segs === 1 ? easeInOut(t) : t;
    out.copy(this.cellPos(a.cell, a.y)).lerp(this.cellPos(b.cell, b.y), e);
    return { hop: b.hop ? Math.sin(Math.PI * t) * 0.14 : 0, jumpScale: 1 };
  }

  /** Позиция игрока в мире (для камеры, эффектов, прозрачности стен). */
  playerPosition(out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.actors[this.actors.length - 1];
    if (v) out.copy(v.model.root.position);
    return out;
  }

  actorPosition(index: number, out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.actors[index];
    if (v) out.copy(v.model.root.position);
    return out;
  }

  /** Кадр: `alpha` — доля пройденного тика (0…1). */
  update(alpha: number, dt: number, time: number): void {
    const s = this.state;
    const tmp = new THREE.Vector3();
    s.actors.forEach((a, i) => {
      const v = this.actors[i];
      if (!v) return;
      const { hop, jumpScale } = this.samplePath(v.path, alpha, tmp);
      v.model.root.position.copy(tmp);
      v.model.root.position.y += hop;
      v.model.root.scale.setScalar(jumpScale);
      v.yaw = approachAngle(v.yaw, FACING_YAW[a.facing]!, 16, dt);
      v.model.body.rotation.y = v.yaw;
      v.broken = approach(v.broken, a.status === 'broken' ? 1 : 0, 10, dt);
      v.dead = approach(v.dead, a.status === 'dead' ? 1 : 0, 6, dt);
      if (v.model.hologram) {
        const u = v.model.hologram.uniforms;
        u.uTime!.value = time + i * 1.3;
        u.uGlitch!.value = v.broken;
        (u.uColor!.value as THREE.Color).setHex(PALETTE.echo).lerp(new THREE.Color(PALETTE.paradox), v.broken);
      }
      if (v.dead > 0.01) {
        v.model.body.rotation.z = v.dead * (Math.PI / 2.4);
        v.model.body.position.y = -v.dead * 0.1;
      } else {
        v.model.body.rotation.z = 0;
        v.model.body.position.y = 0;
      }
    });
    s.boxes.forEach((b, i) => {
      const v = this.boxes[i]!;
      if (!v.path.length) {
        v.mesh.visible = false;
        return;
      }
      this.samplePath(v.path, alpha, tmp);
      v.sink = approach(v.sink, b < 0 && alpha >= 1 ? 1 : 0, 8, dt);
      v.mesh.visible = v.sink < 0.98;
      v.mesh.position.copy(tmp);
      v.mesh.position.y += 0.39 - v.sink * 0.78;
    });
    s.items.forEach((it, i) => {
      const m = this.items[i]!;
      if (it.consumed) {
        m.visible = false;
        return;
      }
      m.visible = true;
      if (it.carrier >= 0) {
        const holder = this.actors[it.carrier];
        if (holder) m.position.copy(holder.model.root.position).add(new THREE.Vector3(0, 0.78, 0));
        m.rotation.y = time * 2;
      } else if (it.cell >= 0) {
        const fx = this.level.fixtures[it.cell];
        const y = this.floorY(it.cell, s) + (fx?.type === 'socket' ? 0.28 : 0.05 + Math.sin(time * 2 + i) * 0.04);
        m.position.copy(this.cellPos(it.cell, y));
        m.rotation.y = time * 0.8 + i;
      }
    });
    s.guards.forEach((g, i) => {
      const v = this.guards[i]!;
      const { hop } = this.samplePath(v.path, alpha, tmp);
      v.model.root.position.copy(tmp);
      v.model.root.position.y += hop * 0.5 + Math.sin(time * 3 + i) * 0.02;
      v.yaw = approachAngle(v.yaw, FACING_YAW[g.facing]!, 12, dt);
      v.model.body.rotation.y = v.yaw;
    });
    for (const f of this.fixtures) f.update(s, dt, time);
    if (this.conveyorTex) this.conveyorTex.offset.y = (time * 0.9) % 1;
    // Прозрачность стен.
    if (this.walls) {
      let dirty = false;
      for (let i = 0; i < this.wallFade.length; i++) {
        const cur = this.wallFade[i]!;
        const t = this.wallFadeTarget[i]!;
        if (Math.abs(cur - t) > 0.001) {
          this.wallFade[i] = approach(cur, t, 10, dt);
          dirty = true;
        }
      }
      if (dirty) (this.walls.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    const beamPulse = 0.75 + Math.sin(time * 20) * 0.15;
    this.beamMat.opacity = beamPulse;
    this.updateExtras(time);
  }

  private beamY(cell: number): number {
    return this.floorY(cell) + 0.45;
  }

  private rebuildBeams(s: WorldState): void {
    for (const c of this.beamGroup.children) (c as THREE.Mesh).geometry.dispose();
    this.beamGroup.clear();
    for (const b of s.beams) {
      const pts: THREE.Vector3[] = [this.cellPos(b.emitter, this.beamY(b.emitter))];
      b.cells.forEach((c, k) => {
        const last = k === b.cells.length - 1;
        const p = this.cellPos(c, this.beamY(b.emitter));
        if (last && (b.end === 'block' || b.end === 'edge')) p.lerp(pts[pts.length - 1]!, 0.5);
        pts.push(p);
      });
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k]!;
        const c = pts[k + 1]!;
        const len = a.distanceTo(c);
        if (len < 0.01) continue;
        const geo = new THREE.CylinderGeometry(0.035, 0.035, len, 6, 1, true);
        geo.rotateX(Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.beamMat);
        mesh.position.copy(a).lerp(c, 0.5);
        mesh.lookAt(c);
        this.beamGroup.add(mesh);
      }
    }
  }

  private rebuildSight(s: WorldState): void {
    for (const c of this.sightGroup.children) (c as THREE.Mesh).geometry.dispose();
    this.sightGroup.clear();
    if (!s.guards.length) return;
    const d = toDraft(s);
    s.guards.forEach((_g, gi) => {
      for (const c of guardSight(d, gi)) {
        const geo = new THREE.PlaneGeometry(0.9, 0.9);
        geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, this.sightMat);
        m.position.copy(this.cellPos(c, this.floorY(c, s) + 0.012));
        this.sightGroup.add(m);
      }
    });
  }

  // ————— подсказки и траектории —————

  private arrow: THREE.Mesh | null = null;
  private arrowCell = -1;
  private trails: THREE.InstancedMesh | null = null;
  private ghosts: ActorModel[] = [];

  /** 3D-стрелка над клеткой (обучение). */
  setHintArrow(cell: number | null): void {
    if (cell === null || cell < 0) {
      if (this.arrow) this.arrow.visible = false;
      this.arrowCell = -1;
      return;
    }
    if (!this.arrow) {
      const geo = this.track(new THREE.ConeGeometry(0.16, 0.34, 4));
      geo.rotateX(Math.PI);
      this.arrow = new THREE.Mesh(geo, this.track(new THREE.MeshBasicMaterial({ color: PALETTE.player, toneMapped: false })));
      this.root.add(this.arrow);
    }
    this.arrowCell = cell;
    this.arrow.visible = true;
  }

  /**
   * Пунктирные светящиеся траектории копий по прогнозу петли.
   * `paths[e]` — клетки эхо по тикам; `broken[e]` — сбивалось ли эхо.
   */
  setTrails(paths: readonly (readonly number[])[] | null, broken: readonly boolean[] = []): void {
    if (this.trails) {
      this.root.remove(this.trails);
      this.trails.geometry.dispose();
      (this.trails.material as THREE.Material).dispose();
      this.trails.dispose();
      this.trails = null;
    }
    if (!paths?.length) return;
    const dashes: { p: THREE.Vector3; yaw: number; e: number }[] = [];
    paths.forEach((cells, e) => {
      const uniq: number[] = [];
      for (const c of cells) if (uniq[uniq.length - 1] !== c) uniq.push(c);
      for (let i = 0; i < uniq.length - 1; i++) {
        const a = this.cellPos(uniq[i]!, this.floorY(uniq[i]!) + 0.03 + e * 0.004);
        const b = this.cellPos(uniq[i + 1]!, this.floorY(uniq[i + 1]!) + 0.03 + e * 0.004);
        const len = a.distanceTo(b);
        if (len > 1.5) continue; // телепорт — без линии
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        for (let s = 0.12; s < len; s += 0.26) dashes.push({ p: a.clone().lerp(b, s / len), yaw, e });
      }
    });
    if (!dashes.length) return;
    const geo = new THREE.BoxGeometry(0.05, 0.02, 0.13);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.85 });
    const mesh = new THREE.InstancedMesh(geo, mat, dashes.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    dashes.forEach((d, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw);
      m.compose(d.p, q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      c.setHex(broken[d.e] ? PALETTE.paradox : PALETTE.echo).multiplyScalar(1.4);
      mesh.setColorAt(i, c);
    });
    this.trails = mesh;
    this.root.add(mesh);
  }

  /** «Призрак будущего»: где каждое эхо будет через несколько тиков. */
  setGhosts(cells: readonly number[] | null): void {
    const n = cells?.length ?? 0;
    while (this.ghosts.length > n) {
      const g = this.ghosts.pop()!;
      this.root.remove(g.root);
      disposeObject(g.root);
    }
    while (this.ghosts.length < n) {
      const g = createEchoModel(this.ghosts.length);
      g.root.traverse((o) => {
        if (o instanceof THREE.Sprite) o.visible = false;
      });
      if (g.hologram) g.hologram.uniforms.uOpacity!.value = 0.28;
      this.root.add(g.root);
      this.ghosts.push(g);
    }
    cells?.forEach((cell, i) => {
      const g = this.ghosts[i]!;
      const actor = this.actors[i];
      const same = actor && actor.path[actor.path.length - 1]?.cell === cell;
      g.root.visible = cell >= 0 && !same;
      g.root.position.copy(this.cellPos(cell, this.floorY(cell)));
      g.root.scale.setScalar(0.92);
    });
  }

  private updateExtras(time: number): void {
    if (this.arrow?.visible && this.arrowCell >= 0) {
      this.arrow.position.copy(this.cellPos(this.arrowCell, this.floorY(this.arrowCell) + 1.25 + Math.sin(time * 4) * 0.12));
      this.arrow.rotation.y = time * 1.5;
    }
    for (const g of this.ghosts) if (g.hologram) g.hologram.uniforms.uTime!.value = time;
    if (this.trails) (this.trails.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 3) * 0.2;
  }

  dispose(): void {
    this.setTrails(null);
    this.setGhosts(null);
    for (const g of this.shared.geo) g.dispose();
    for (const m of this.shared.mat) m.dispose();
    for (const a of this.actors) disposeObject(a.model.root);
    for (const b of this.boxes) disposeObject(b.mesh);
    for (const i of this.items) disposeObject(i);
    for (const g of this.guards) disposeObject(g.model.root);
    for (const c of this.beamGroup.children) (c as THREE.Mesh).geometry.dispose();
    for (const c of this.sightGroup.children) (c as THREE.Mesh).geometry.dispose();
    this.beamMat.dispose();
    this.sightMat.dispose();
    this.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    // Пьедесталы и прочие модели, созданные вне track().
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.shared.geo.includes(m.geometry)) m.geometry.dispose();
    });
    this.root.clear();
  }
}

function approachAngle(cur: number, target: number, rate: number, dt: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-rate * dt));
}
