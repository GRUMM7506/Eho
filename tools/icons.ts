/**
 * Генератор иконок приложения: `npm run icons`. Рисует логотип (игрок и его эхо) в буфер
 * пикселей и кодирует PNG вручную (zlib из Node), без внешних зависимостей.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

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

function png(size: number, rgba: Uint8ClampedArray): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type RGB = [number, number, number];
const BG: RGB = [0x0d, 0x0b, 0x1e];
const PLAYER: RGB = [0xff, 0xe4, 0x5e];
const ECHO: RGB = [0x8c, 0x9e, 0xff];

/** Иконка: скруглённый квадрат, эхо-круг со смещением и яркий круг игрока. `pad` — отступ для maskable. */
function draw(size: number, pad: number, rounded: boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  const ss = 4; // суперсэмплинг для сглаживания
  const inner = size * (1 - pad * 2);
  const off = size * pad;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = (x + (sx + 0.5) / ss) / size;
          const fy = (y + (sy + 0.5) / ss) / size;
          // Фон.
          const rr = 0.22;
          const qx = Math.max(Math.abs(fx - 0.5) - (0.5 - rr), 0);
          const qy = Math.max(Math.abs(fy - 0.5) - (0.5 - rr), 0);
          const inBg = !rounded || Math.hypot(qx, qy) <= rr;
          if (!inBg) continue;
          let c: RGB = BG;
          const u = (fx * size - off) / inner;
          const v = (fy * size - off) / inner;
          const dEcho2 = Math.hypot(u - 0.66, v - 0.5);
          const dEcho1 = Math.hypot(u - 0.56, v - 0.5);
          const dPlayer = Math.hypot(u - 0.4, v - 0.5);
          if (dEcho2 < 0.24) c = mix(BG, ECHO, 0.35);
          if (dEcho1 < 0.24) c = mix(BG, ECHO, 0.6);
          if (dPlayer < 0.24) c = PLAYER;
          if (dPlayer < 0.07) c = [0x1a, 0x15, 0x00];
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      px[i] = r / Math.max(1, a / 255);
      px[i + 1] = g / Math.max(1, a / 255);
      px[i + 2] = b / Math.max(1, a / 255);
      px[i + 3] = a / n;
    }
  }
  return px;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

mkdirSync(out, { recursive: true });
const files: [string, number, number, boolean][] = [
  ['icon-192.png', 192, 0.08, true],
  ['icon-512.png', 512, 0.08, true],
  ['icon-maskable-512.png', 512, 0.18, false],
  ['apple-touch-icon.png', 180, 0.1, false],
  ['favicon-32.png', 32, 0.02, true],
];
for (const [name, size, pad, rounded] of files) {
  const file = join(out, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size, draw(size, pad, rounded)));
  console.log('✓', name);
}
