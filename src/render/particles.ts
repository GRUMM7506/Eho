import * as THREE from 'three';

/**
 * GPU-частицы: кольцевой буфер точек, траектория считается в вершинном шейдере
 * (p = p0 + v·t + ½·g·t²), поэтому на CPU при кадре ничего не пересчитывается.
 */
export interface Burst {
  count: number;
  origin: THREE.Vector3;
  color: THREE.ColorRepresentation;
  /** Разброс цвета к белому (0…1). */
  whiten?: number;
  speed: number;
  /** Доля скорости вверх. */
  up?: number;
  spread?: number;
  gravity?: number;
  life: number;
  size: number;
  /** Разброс точек старта. */
  radius?: number;
  /** Горизонтальное кольцо вместо сферы. */
  ring?: boolean;
}

const MAX = 3000;

export class Particles {
  readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private cursor = 0;
  private time = 0;
  /** Множитель количества (качество, уменьшенное движение). */
  density = 1;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    // x — время рождения, y — жизнь, z — размер, w — гравитация
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(MAX * 4).fill(-1000), 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute vec3 aVel;
        attribute vec3 aColor;
        attribute vec4 aLife;
        uniform float uTime;
        uniform float uScale;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          float t = uTime - aLife.x;
          float k = t / aLife.y;
          if (k < 0.0 || k > 1.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }
          vec3 p = position + aVel * t + vec3(0.0, -0.5 * aLife.w * t * t, 0.0);
          p.y = max(p.y, -0.4);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float persp = projectionMatrix[3][3] > 0.5 ? 1.0 : 1.0 / max(0.5, -mv.z);
          gl_PointSize = aLife.z * uScale * persp * (1.0 - k * 0.6);
          vColor = aColor;
          vFade = 1.0 - k;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vFade;
          gl_FragColor = vec4(vColor * 1.6, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Масштаб размера точек под высоту вьюпорта и зум камеры. */
  setScale(pixelsPerUnit: number): void {
    this.mat.uniforms.uScale!.value = pixelsPerUnit;
  }

  emit(b: Burst): void {
    const n = Math.max(1, Math.round(b.count * this.density));
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const vel = this.geo.getAttribute('aVel') as THREE.BufferAttribute;
    const col = this.geo.getAttribute('aColor') as THREE.BufferAttribute;
    const life = this.geo.getAttribute('aLife') as THREE.BufferAttribute;
    const base = new THREE.Color(b.color);
    const white = new THREE.Color(0xffffff);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const r = b.radius ?? 0;
      const ox = Math.cos(a) * r * Math.random();
      const oz = Math.sin(a) * r * Math.random();
      pos.setXYZ(k, b.origin.x + ox, b.origin.y, b.origin.z + oz);
      const s = b.speed * (0.4 + Math.random() * 0.6);
      let vx: number;
      let vy: number;
      let vz: number;
      if (b.ring) {
        vx = Math.cos(a) * s;
        vz = Math.sin(a) * s;
        vy = (b.up ?? 0.3) * s * Math.random();
      } else {
        const u = Math.random() * 2 - 1;
        const q = Math.sqrt(1 - u * u);
        vx = q * Math.cos(a) * s * (b.spread ?? 1);
        vz = q * Math.sin(a) * s * (b.spread ?? 1);
        vy = Math.abs(u) * s + (b.up ?? 0.5) * s;
      }
      vel.setXYZ(k, vx, vy, vz);
      c.copy(base).lerp(white, Math.random() * (b.whiten ?? 0.3));
      col.setXYZ(k, c.r, c.g, c.b);
      life.setXYZW(
        k,
        this.time,
        b.life * (0.6 + Math.random() * 0.4),
        b.size * (0.6 + Math.random() * 0.6),
        b.gravity ?? 4,
      );
    }
    pos.needsUpdate = vel.needsUpdate = col.needsUpdate = life.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime!.value = this.time;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
