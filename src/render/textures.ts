import * as THREE from 'three';

/**
 * Процедурные текстуры на canvas: всё рисуется кодом, внешних файлов нет.
 * Текстуры кешируются и живут всю сессию (их немного).
 */
const cache = new Map<string, THREE.Texture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/** Плитка пола с тонкими швами. */
export function floorTexture(): THREE.Texture {
  return canvasTexture('floor', 128, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(s * 0.5 - 1, s * 0.5 - 1, 2, 2);
  });
}

/** Штриховка инверсной двери. */
export function hatchTexture(): THREE.Texture {
  const t = canvasTexture('hatch', 128, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#000000';
    g.lineWidth = s * 0.12;
    for (let i = -s; i < s * 2; i += s * 0.34) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + s, s);
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Стрелки конвейера (прокручиваются смещением текстуры). */
export function conveyorTexture(): THREE.Texture {
  const t = canvasTexture('conveyor', 128, (g, s) => {
    g.fillStyle = '#2a2452';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#9C95C9';
    for (let k = 0; k < 2; k++) {
      const y0 = k * s * 0.5;
      g.beginPath();
      g.moveTo(s * 0.2, y0 + s * 0.4);
      g.lineTo(s * 0.5, y0 + s * 0.1);
      g.lineTo(s * 0.8, y0 + s * 0.4);
      g.lineTo(s * 0.68, y0 + s * 0.4);
      g.lineTo(s * 0.5, y0 + s * 0.22);
      g.lineTo(s * 0.32, y0 + s * 0.4);
      g.closePath();
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Трещины хрупкого пола. */
export function crackTexture(level: number): THREE.Texture {
  return canvasTexture(`crack${level}`, 128, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);
    g.strokeStyle = 'rgba(20,10,40,0.85)';
    g.lineWidth = 2.5;
    // Детерминированный узор трещин.
    let seed = 7 + level * 13;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const lines = 2 + level * 3;
    for (let i = 0; i < lines; i++) {
      g.beginPath();
      let x = s * 0.5;
      let y = s * 0.5;
      g.moveTo(x, y);
      const a = rnd() * Math.PI * 2;
      for (let j = 0; j < 4; j++) {
        x += Math.cos(a + (rnd() - 0.5)) * s * 0.14;
        y += Math.sin(a + (rnd() - 0.5)) * s * 0.14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** Сетка особой зоны (твёрдое эхо). */
export function gridTexture(): THREE.Texture {
  return canvasTexture('grid', 128, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * s;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, s);
      g.moveTo(0, p);
      g.lineTo(s, p);
      g.stroke();
    }
  });
}

/**
 * Значок цвета для режима дальтоников: у каждого цвета своя форма и узор.
 * Розовый — круг с точками, циан — треугольник с полосами, фиолетовый — ромб с сеткой,
 * оранжевый — квадрат с крестом.
 */
export function symbolTexture(colorId: number): THREE.Texture {
  return canvasTexture(`sym${colorId}`, 128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ffffff';
    g.lineWidth = s * 0.07;
    const c = s / 2;
    const r = s * 0.3;
    g.beginPath();
    switch (colorId) {
      case 0:
        g.arc(c, c, r, 0, Math.PI * 2);
        break;
      case 1:
        g.moveTo(c, c - r);
        g.lineTo(c + r, c + r * 0.8);
        g.lineTo(c - r, c + r * 0.8);
        g.closePath();
        break;
      case 2:
        g.moveTo(c, c - r);
        g.lineTo(c + r, c);
        g.lineTo(c, c + r);
        g.lineTo(c - r, c);
        g.closePath();
        break;
      default:
        g.rect(c - r * 0.85, c - r * 0.85, r * 1.7, r * 1.7);
    }
    g.stroke();
    g.save();
    g.clip();
    g.lineWidth = s * 0.03;
    if (colorId === 0) {
      for (let x = 0; x < s; x += s * 0.12) for (let y = 0; y < s; y += s * 0.12) g.fillRect(x, y, 4, 4);
    } else if (colorId === 1) {
      for (let y = 0; y < s; y += s * 0.1) g.fillRect(0, y, s, s * 0.035);
    } else if (colorId === 2) {
      for (let x = 0; x < s; x += s * 0.1) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + s, s);
        g.moveTo(x, s);
        g.lineTo(x + s, 0);
        g.stroke();
      }
    } else {
      g.fillRect(c - s * 0.03, 0, s * 0.06, s);
      g.fillRect(0, c - s * 0.03, s, s * 0.06);
    }
    g.restore();
  });
}

/** Мягкое круглое пятно для частиц и свечения. */
export function glowTexture(): THREE.Texture {
  return canvasTexture('glow', 64, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}
