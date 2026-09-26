/**
 * Генератор иконок: `npm run icons`. Рисует логотип (игрок и его эхо) в буфер пикселей и
 * кодирует PNG вручную (zlib из Node), без внешних зависимостей. Выход:
 *  - public/icons — веб и PWA;
 *  - build/icon.png — иконка Windows-сборки (Electron);
 *  - android/app/src/main/res — иконки лаунчера и заставки (если есть проект Capacitor).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type RGB = [number, number, number];
type Shape = 'square' | 'rounded' | 'circle';
const BG: RGB = [0x0d, 0x0b, 0x1e];
const PLAYER: RGB = [0xff, 0xe4, 0x5e];
const ECHO: RGB = [0x8c, 0x9e, 0xff];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Холст w×h с фоном и логотипом в квадрате со стороной `logo` по центру.
 * `shape` — форма фона: квадрат, скруглённый квадрат или круг.
 */
function draw(w: number, h: number, logo: number, shape: Shape): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  const ss = 4; // суперсэмплинг для сглаживания
  const ox = (w - logo) / 2;
  const oy = (h - logo) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const X = x + (sx + 0.5) / ss;
          const Y = y + (sy + 0.5) / ss;
          const fx = X / w;
          const fy = Y / h;
          if (shape === 'rounded') {
            const rr = 0.22;
            const qx = Math.max(Math.abs(fx - 0.5) - (0.5 - rr), 0);
            const qy = Math.max(Math.abs(fy - 0.5) - (0.5 - rr), 0);
            if (Math.hypot(qx, qy) > rr) continue;
          } else if (shape === 'circle' && Math.hypot(fx - 0.5, fy - 0.5) > 0.5) continue;
          let c: RGB = BG;
          const u = (X - ox) / logo;
          const v = (Y - oy) / logo;
          if (Math.hypot(u - 0.66, v - 0.5) < 0.24) c = mix(BG, ECHO, 0.35);
          if (Math.hypot(u - 0.56, v - 0.5) < 0.24) c = mix(BG, ECHO, 0.6);
          const dPlayer = Math.hypot(u - 0.4, v - 0.5);
          if (dPlayer < 0.24) c = PLAYER;
          if (dPlayer < 0.07) c = [0x1a, 0x15, 0x00];
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const i = (y * w + x) * 4;
      px[i] = r / Math.max(1, a / 255);
      px[i + 1] = g / Math.max(1, a / 255);
      px[i + 2] = b / Math.max(1, a / 255);
      px[i + 3] = a / (ss * ss);
    }
  }
  return px;
}

function save(file: string, w: number, h: number, logo: number, shape: Shape): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(w, h, draw(w, h, logo, shape)));
  console.log('✓', file.slice(root.length + 1));
}

// Веб и PWA.
save(join(out, 'icon-192.png'), 192, 192, 192 * 0.84, 'rounded');
save(join(out, 'icon-512.png'), 512, 512, 512 * 0.84, 'rounded');
save(join(out, 'icon-maskable-512.png'), 512, 512, 512 * 0.64, 'square');
save(join(out, 'apple-touch-icon.png'), 180, 180, 180 * 0.8, 'square');
save(join(out, 'favicon-32.png'), 32, 32, 32 * 0.96, 'rounded');

// Windows (Electron): PNG для окна и многоразмерная .ico для exe и ярлыков.
save(join(root, 'build', 'icon.png'), 512, 512, 512 * 0.84, 'rounded');
{
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((s) => png(s, s, draw(s, s, s * (s <= 32 ? 0.96 : 0.84), 'rounded')));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head[e] = s >= 256 ? 0 : s;
    head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i]!.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += images[i]!.length;
  });
  writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([head, ...images]));
  console.log('✓ build/icon.ico');
}

// Android: иконки лаунчера и заставки, если есть проект Capacitor.
const res = join(root, 'android', 'app', 'src', 'main', 'res');
if (existsSync(res)) {
  const dens: [string, number][] = [
    ['mdpi', 1],
    ['hdpi', 1.5],
    ['xhdpi', 2],
    ['xxhdpi', 3],
    ['xxxhdpi', 4],
  ];
  for (const [d, k] of dens) {
    const s48 = Math.round(48 * k);
    const s108 = Math.round(108 * k);
    const dir = join(res, 'mipmap-' + d);
    save(join(dir, 'ic_launcher.png'), s48, s48, s48 * 0.84, 'rounded');
    save(join(dir, 'ic_launcher_round.png'), s48, s48, s48 * 0.76, 'circle');
    // Адаптивная иконка: логотип в безопасной зоне 66 из 108 dp.
    save(join(dir, 'ic_launcher_foreground.png'), s108, s108, s108 * 0.56, 'square');
  }
  // Заставки: те же размеры, что сгенерировал Capacitor, логотип по центру.
  for (const dir of readdirSync(res)) {
    const file = join(res, dir, 'splash.png');
    if (!existsSync(file)) continue;
    const head = readFileSync(file);
    const w = head.readUInt32BE(16);
    const h = head.readUInt32BE(20);
    save(file, w, h, Math.min(w, h) * 0.34, 'square');
  }
}
