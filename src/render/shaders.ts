import * as THREE from 'three';

/**
 * Голографический материал эхо: френель + бегущие сканлайны + мерцание.
 * `uGlitch` > 0 — сбитое эхо: вершины рвёт горизонтальными полосами.
 */
export function createHologramMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uGlitch: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlitch;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vY;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec3 p = position;
        float band = step(0.72, hash(floor(p.y * 14.0) + floor(uTime * 18.0)));
        p.x += sin(uTime * 70.0 + p.y * 30.0) * 0.07 * uGlitch * band;
        p.z += cos(uTime * 53.0 + p.y * 21.0) * 0.04 * uGlitch * band;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uGlitch;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vY;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 2.0);
        float scan = 0.62 + 0.38 * sin(vY * 70.0 - uTime * 7.0);
        float flick = 0.9 + 0.1 * sin(uTime * 23.0 + vY * 3.0);
        float a = (0.22 + fres * 0.95) * scan * flick * uOpacity;
        vec3 col = uColor * (0.55 + fres * 1.8);
        col += vec3(0.6, 0.1, 0.1) * uGlitch * step(0.5, fract(vY * 9.0 + uTime * 3.0)) * 0.3;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Вихрь портала на диске. */
export function createPortalMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uFlash;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float a = atan(p.y, p.x);
        float sw = sin(a * 3.0 + r * 11.0 - uTime * 4.0) * 0.5 + 0.5;
        float edge = smoothstep(1.0, 0.86, r);
        float ring = edge * (0.25 + 0.75 * sw) * (0.35 + r * 0.9);
        vec3 col = uColor * ring * (1.6 + uFlash * 3.0);
        gl_FragColor = vec4(col, edge * (0.55 + 0.45 * sw));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * Растровое (дизеринг) исчезновение стен, закрывающих игрока от камеры.
 * Атрибут экземпляра `aFade`: 1 — стена видна, меньше — сквозь неё видно.
 * Непрозрачный конвейер без сортировки: пиксели отбрасываются по матрице Байера.
 */
export function applyDitherFade(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float aFade;\nvarying float vFade;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFade = aFade;');
    shader.fragmentShader =
      'varying float vFade;\n' +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (vFade < 0.999) {
          ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
          int bi = bp.x + bp.y * 4;
          float bm[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
          if ((bm[bi] + 0.5) / 16.0 > vFade) discard;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'dither-fade';
}
