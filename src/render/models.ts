import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE, mechColor } from './palette';
import { createHologramMaterial } from './shaders';

/**
 * Все модели строятся кодом из примитивов. Начало координат модели — у ног,
 * «вперёд» — локальная ось +Z.
 */

export interface ActorModel {
  root: THREE.Group;
  body: THREE.Object3D;
  materials: THREE.Material[];
  hologram: THREE.ShaderMaterial | null;
}

function capsuleBody(): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.2, 0.28, 6, 14);
  g.translate(0, 0.2 + 0.14, 0);
  return g;
}

export function createPlayerModel(): ActorModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: PALETTE.player,
    emissive: PALETTE.player,
    emissiveIntensity: 0.55,
    roughness: 0.35,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(capsuleBody(), bodyMat);
  mesh.castShadow = true;
  body.add(mesh);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1500, emissive: 0x000000, roughness: 0.2 });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), eyeMat);
  eye.scale.set(1.3, 0.8, 0.6);
  eye.position.set(0, 0.5, 0.17);
  body.add(eye);
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  pupil.position.set(0, 0.5, 0.215);
  body.add(pupil);
  root.add(body);
  return { root, body, materials: [bodyMat, eyeMat, pupil.material as THREE.Material], hologram: null };
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 40px "IBM Plex Mono", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.28, 0.28, 1);
  s.renderOrder = 10;
  return s;
}

export function createEchoModel(index: number): ActorModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const holo = createHologramMaterial(PALETTE.echo);
  const mesh = new THREE.Mesh(capsuleBody(), holo);
  body.add(mesh);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), holo);
  eye.scale.set(1.3, 0.8, 0.6);
  eye.position.set(0, 0.5, 0.17);
  body.add(eye);
  root.add(body);
  const label = labelSprite(String(index + 1), '#C8D0FF');
  label.position.set(0, 0.95, 0);
  root.add(label);
  return { root, body, materials: [holo, label.material], hologram: holo };
}

export function createGuardModel(): ActorModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2b1030,
    emissive: PALETTE.paradox,
    emissiveIntensity: 0.25,
    roughness: 0.4,
    metalness: 0.5,
    flatShading: true,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat);
  core.position.y = 0.42;
  core.scale.set(1, 1.2, 1);
  core.castShadow = true;
  body.add(core);
  const visorMat = new THREE.MeshBasicMaterial({ color: PALETTE.paradox });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.06), visorMat);
  visor.position.set(0, 0.48, 0.22);
  body.add(visor);
  root.add(body);
  return { root, body, materials: [mat, visorMat], hologram: null };
}

export function createBoxModel(): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial({ color: PALETTE.box, roughness: 0.55, metalness: 0.15 });
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.78, 0.78, 3, 0.08), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Неоновый кант по рёбрам.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.8, 0.8, 0.8)),
    new THREE.LineBasicMaterial({ color: 0xb9a6ff, transparent: true, opacity: 0.35 }),
  );
  mesh.add(edges);
  return { mesh, material };
}

export function createKeyModel(colorId: number): THREE.Group {
  const g = new THREE.Group();
  const col = mechColor(colorId);
  const mat = new THREE.MeshStandardMaterial({
    color: col,
    emissive: col,
    emissiveIntensity: 0.9,
    metalness: 0.6,
    roughness: 0.3,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 20), mat);
  ring.position.y = 0.12;
  g.add(ring);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.26), mat);
  shaft.position.set(0, 0.12, 0.2);
  g.add(shaft);
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.05), mat);
  tooth.position.set(0, 0.07, 0.3);
  g.add(tooth);
  g.rotation.y = Math.PI / 4;
  return g;
}

export function createBatteryModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.3, 16),
    new THREE.MeshStandardMaterial({
      color: 0x1d3b33,
      emissive: PALETTE.exit,
      emissiveIntensity: 0.35,
      metalness: 0.4,
      roughness: 0.4,
    }),
  );
  body.position.y = 0.17;
  g.add(body);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.103, 0.103, 0.08, 16),
    new THREE.MeshBasicMaterial({ color: PALETTE.exit }),
  );
  band.position.y = 0.2;
  g.add(band);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.9, roughness: 0.2 }),
  );
  cap.position.y = 0.35;
  g.add(cap);
  return g;
}

/** Пьедестал для рычагов, гнёзд, излучателей, зеркал и приёмников. */
export function createPedestal(): THREE.Mesh {
  const m = new THREE.Mesh(
    new RoundedBoxGeometry(0.7, 0.3, 0.7, 2, 0.05),
    new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.6 }),
  );
  m.position.y = 0.15;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}
