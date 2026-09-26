import * as THREE from 'three';
import { OrbitCamera, type Insets } from '../camera/orbit';
import type { Level, SimEvent, WorldState } from '../core/types';
import { LevelView } from './levelView';
import { PALETTE } from './palette';
import { PostFX } from './postfx';

export type Quality = 'low' | 'medium' | 'high';

export interface ViewSettings {
  quality: Quality;
  colorblind: boolean;
  reducedMotion: boolean;
  perspective: boolean;
  freeCamera: boolean;
  isMobile: boolean;
}

/**
 * Владелец WebGL: сцена, свет, камера, постобработка и текущий уровень.
 * Получает снимки симуляции и события, сам ничего в игровой логике не меняет.
 */
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly orbit = new OrbitCamera();
  readonly post: PostFX;
  level: LevelView | null = null;
  private readonly key: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly raycaster = new THREE.Raycaster();
  private settings: ViewSettings;
  private time = 0;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private width = 1;
  private height = 1;
  /** Внешние хуки кадра (частицы, эффекты). */
  readonly frameHooks: ((dt: number, time: number) => void)[] = [];

  constructor(canvas: HTMLCanvasElement, settings: ViewSettings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setClearColor(PALETTE.bg);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(PALETTE.bg);
    this.scene.fog = new THREE.Fog(PALETTE.bg, 60, 160);

    this.hemi = new THREE.HemisphereLight(0x9d92ff, 0x1a1238, 1.7);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight(0x3a3370, 1.0));
    this.key = new THREE.DirectionalLight(0xfff1e0, 2.6);
    this.key.position.set(-6, 14, 8);
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);

    this.post = new PostFX(this.renderer, this.scene, this.orbit.camera);
    this.applySettings(settings);
  }

  applySettings(s: ViewSettings): void {
    const qualityChanged = !this.settings || this.settings.quality !== s.quality || this.settings.colorblind !== s.colorblind;
    this.settings = s;
    const maxDpr = s.quality === 'high' ? (s.isMobile ? 2 : 2) : s.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    const shadows = s.quality !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.key.castShadow = shadows;
    this.key.shadow.mapSize.set(s.quality === 'high' ? 2048 : 1024, s.quality === 'high' ? 2048 : 1024);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
    this.orbit.opts = { perspective: s.perspective, freeCamera: s.freeCamera, reducedMotion: s.reducedMotion };
    this.post.configure(s.quality, s.reducedMotion, s.isMobile);
    this.post.setCamera(this.orbit.camera);
    if (qualityChanged && this.level) {
      // Материалы с тенями нужно перекомпилировать.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
    this.resize(this.width, this.height, this.insets);
  }

  get viewSettings(): ViewSettings {
    return this.settings;
  }

  setLevel(level: Level, state: WorldState): void {
    this.clearLevel();
    this.level = new LevelView(level, state, { shadows: this.settings.quality !== 'low', colorblind: this.settings.colorblind });
    this.scene.add(this.level.root);
    const box = this.level.bounds();
    this.orbit.setBounds(box, level.cameraYaw);
    // Тени только в пределах уровня — чётче и дешевле.
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.75 + 2;
    const cam = this.key.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = 60;
    cam.updateProjectionMatrix();
    this.key.target.position.set(0, 0, 0);
    this.key.position.set(-r * 0.6, 18, r * 0.8);
  }

  clearLevel(): void {
    if (!this.level) return;
    this.scene.remove(this.level.root);
    this.level.dispose();
    this.level = null;
  }

  /** Показать снимок; `rewind` — с анимацией перемотки к старту. */
  setState(s: WorldState, rewind = false): void {
    if (rewind && !this.settings.reducedMotion) this.level?.rewindTo(s, 0.55);
    else this.level?.setState(s);
  }

  setTick(prev: WorldState, next: WorldState, events: readonly SimEvent[]): void {
    this.level?.setTick(prev, next, events);
  }

  resize(width: number, height: number, insets: Insets): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = insets;
    this.renderer.setSize(this.width, this.height, false);
    this.orbit.setViewport(this.width, this.height, insets);
    this.post.setSize(this.width, this.height, this.renderer.getPixelRatio());
  }

  /** Стены между камерой и игроком становятся полупрозрачными (проверка лучами). */
  private updateOccluders(): void {
    const lv = this.level;
    const walls = lv?.wallMesh;
    if (!lv || !walls) return;
    const cam = this.orbit.camera;
    cam.updateMatrixWorld();
    const hit = new Set<number>();
    const player = lv.playerPosition();
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const viewDir = new THREE.Vector3();
    cam.getWorldDirection(viewDir);
    for (const dy of [0.25, 0.6]) {
      const target = player.clone().add(new THREE.Vector3(0, dy, 0));
      // Ортографическая камера: луч идёт параллельно направлению взгляда.
      const origin = this.settings.perspective ? camPos : target.clone().addScaledVector(viewDir, -100);
      const dir = target.clone().sub(origin);
      const dist = dir.length();
      this.raycaster.set(origin, dir.normalize());
      this.raycaster.far = dist - 0.05;
      for (const h of this.raycaster.intersectObject(walls, false)) if (h.instanceId !== undefined) hit.add(h.instanceId);
    }
    lv.setOccluders(hit);
  }

  render(dt: number, alpha: number): void {
    this.time += dt;
    this.orbit.update(dt);
    if (this.level) {
      this.level.update(alpha, dt, this.time);
      this.updateOccluders();
    }
    for (const h of this.frameHooks) h(dt, this.time);
    this.post.setCamera(this.orbit.camera);
    this.post.render(dt, this.time);
  }

  get clock(): number {
    return this.time;
  }

  /** Экранные координаты точки мира (для частиц, подсказок, панорамирования звука). */
  project(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.orbit.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  dispose(): void {
    this.clearLevel();
    this.post.dispose();
    this.renderer.dispose();
  }
}
