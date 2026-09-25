import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Quality } from './gameView';

/** Свой шейдер: хроматическая аберрация, глитч парадокса, VHS-перемотка, виньетка. */
const FXShader = {
  name: 'EchoFX',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uGlitch: { value: 0 },
    uVhs: { value: 0 },
    uVignette: { value: 0.55 },
    uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uGlitch;
    uniform float uVhs;
    uniform float uVignette;
    uniform float uFlash;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      if (uGlitch > 0.001) {
        float row = floor(uv.y * 26.0);
        float n = hash(vec2(row, floor(uTime * 24.0)));
        if (n > 1.0 - uGlitch * 0.55) uv.x += (hash(vec2(row, floor(uTime * 30.0))) - 0.5) * 0.09 * uGlitch;
      }
      if (uVhs > 0.001) {
        uv.x += sin(uv.y * 38.0 + uTime * 28.0) * 0.004 * uVhs;
        float band = step(0.965, fract(uv.y * 2.5 - uTime * 1.9));
        uv.x += band * 0.025 * uVhs;
        uv.y = fract(uv.y + uVhs * 0.02 * sin(uTime * 3.0));
      }
      vec2 dir = uv - 0.5;
      float ab = uAberration * 0.012 + uGlitch * 0.007 + uVhs * 0.004;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;
      if (uVhs > 0.001) {
        float scan = 0.82 + 0.18 * sin(uv.y * uRes.y * 1.4);
        col *= mix(1.0, scan, uVhs);
        col += (hash(uv * (uTime + 1.0)) - 0.5) * 0.14 * uVhs;
        col = mix(col, col * vec3(0.85, 1.0, 1.25), uVhs * 0.6);
      }
      col += vec3(uFlash);
      float v = smoothstep(0.9, 0.2, length(dir));
      col *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * Постобработка. На низком качестве — прямой рендер без эффектов.
 * Эффекты управляются значениями 0…1, которые затухают сами.
 */
export class PostFX {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private camera: THREE.Camera;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private fx: ShaderPass | null = null;
  private fxaa: ShaderPass | null = null;
  private enabled = false;
  private reducedMotion = false;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  /** Текущая сила эффектов; затухают экспоненциально. */
  aberration = 0;
  glitch = 0;
  vhs = 0;
  flash = 0;
  /** Удерживаемый уровень VHS (пока идёт перемотка). */
  vhsHold = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
  }

  configure(quality: Quality, reducedMotion: boolean, isMobile: boolean): void {
    this.reducedMotion = reducedMotion;
    this.enabled = quality !== 'low';
    this.disposeComposer();
    if (!this.enabled) return;
    const composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    const bloomRes = new THREE.Vector2(256, 256);
    this.bloom = new UnrealBloomPass(bloomRes, quality === 'high' ? 0.85 : 0.7, 0.55, 0.62);
    composer.addPass(this.bloom);
    this.fx = new ShaderPass(FXShader);
    composer.addPass(this.fx);
    composer.addPass(new OutputPass());
    if (quality === 'high' || !isMobile) {
      this.fxaa = new ShaderPass(FXAAShader);
      composer.addPass(this.fxaa);
    }
    this.composer = composer;
    this.bloomHalf = isMobile || quality === 'medium';
    this.setSize(this.width, this.height, this.pixelRatio);
  }

  private bloomHalf = false;

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    if (this.renderPass) this.renderPass.camera = camera;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    if (!this.composer) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    if (this.bloom && this.bloomHalf) this.bloom.setSize((width * pixelRatio) / 2, (height * pixelRatio) / 2);
    const w = width * pixelRatio;
    const h = height * pixelRatio;
    if (this.fxaa) (this.fxaa.material.uniforms.resolution!.value as THREE.Vector2).set(1 / w, 1 / h);
    if (this.fx) (this.fx.material.uniforms.uRes!.value as THREE.Vector2).set(w, h);
  }

  render(dt: number, time: number): void {
    const k = Math.exp(-dt * 4);
    this.aberration *= k;
    this.glitch *= Math.exp(-dt * 3);
    this.flash *= Math.exp(-dt * 6);
    this.vhs = Math.max(this.vhsHold, this.vhs * Math.exp(-dt * 5));
    if (!this.composer || !this.fx) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const u = this.fx.material.uniforms;
    const motion = this.reducedMotion ? 0 : 1;
    u.uTime!.value = time;
    u.uAberration!.value = this.aberration * motion;
    u.uGlitch!.value = this.glitch * motion;
    u.uVhs!.value = this.vhs * (this.reducedMotion ? 0.35 : 1);
    u.uFlash!.value = this.flash * 0.25;
    this.composer.render(dt);
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    this.composer.passes.forEach((p) => p.dispose?.());
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloom = null;
    this.fx = null;
    this.fxaa = null;
  }

  dispose(): void {
    this.disposeComposer();
  }
}
