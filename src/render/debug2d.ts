import { COLORS, type WorldState } from '../core/types';
import { guardSight } from '../core/mechanics/guards';
import { toDraft } from '../core/world';

export const COLOR_HEX: Readonly<Record<(typeof COLORS)[number], string>> = {
  pink: '#FF5D8F',
  cyan: '#3DDCFF',
  violet: '#B388FF',
  orange: '#FF9F43',
};

const hexOf = (c: number) => (c < 0 ? '#ECE8FF' : COLOR_HEX[COLORS[c]!]);

/**
 * Отладочный 2D-рендер: рисует снимок мира на canvas без Three.js.
 * Нужен для проверки ядра и включается параметром `?debug2d`.
 */
export function drawDebug2D(ctx: CanvasRenderingContext2D, s: WorldState, cs: number): void {
  const L = s.level;
  ctx.fillStyle = '#0D0B1E';
  ctx.fillRect(0, 0, L.width * cs, L.height * cs);
  const cx = (c: number) => ((c % L.width) + 0.5) * cs;
  const cy = (c: number) => (Math.floor(c / L.width) + 0.5) * cs;
  ctx.font = `${Math.round(cs * 0.32)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let c = 0; c < L.width * L.height; c++) {
    const x = (c % L.width) * cs;
    const y = Math.floor(c / L.width) * cs;
    const t = L.terrain[c];
    if (t === 'void') continue;
    if (t === 'wall') {
      ctx.fillStyle = '#221D45';
      ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      ctx.fillStyle = '#342C69';
      ctx.fillRect(x + 1, y + 1, cs - 2, cs * 0.2);
      continue;
    }
    ctx.fillStyle = L.solidZone[c] ? '#1b1740' : '#15122B';
    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
    const h = L.heights[c] ?? 0;
    if (h) {
      ctx.fillStyle = `rgba(236,232,255,${0.05 * h})`;
      ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
    }
    const fx = L.fixtures[c];
    const reg = s.cells[c] ?? 0;
    if (!fx) continue;
    ctx.save();
    switch (fx.type) {
      case 'exit':
        ctx.strokeStyle = '#5CF2B5';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + cs * 0.15, y + cs * 0.15, cs * 0.7, cs * 0.7);
        break;
      case 'plate':
        ctx.strokeStyle = hexOf(fx.color);
        ctx.fillStyle = hexOf(fx.color);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx(c), cy(c), cs * 0.3, 0, Math.PI * 2);
        if (reg) ctx.fill();
        ctx.stroke();
        if (fx.filter !== 'any') {
          ctx.fillStyle = '#fff';
          ctx.fillText(fx.filter === 'echo' ? 'e' : 'p', cx(c), cy(c));
        }
        break;
      case 'door':
      case 'timerDoor': {
        const col = fx.type === 'door' ? hexOf(fx.color) : '#ECE8FF';
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        if (reg) ctx.strokeRect(x + 4, y + 4, cs - 8, cs - 8);
        else ctx.fillRect(x + 4, y + 4, cs - 8, cs - 8);
        if (fx.type === 'door' && fx.inverse) {
          ctx.fillStyle = '#000';
          ctx.fillText('/', cx(c), cy(c));
        }
        break;
      }
      case 'lever':
      case 'socket':
      case 'lock':
      case 'receiver':
        ctx.fillStyle = hexOf(fx.color);
        ctx.globalAlpha = reg ? 1 : 0.5;
        ctx.fillRect(x + cs * 0.25, y + cs * 0.25, cs * 0.5, cs * 0.5);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.fillText(fx.type[0]!.toUpperCase(), cx(c), cy(c));
        break;
      case 'portal':
        ctx.strokeStyle = hexOf(fx.color);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx(c), cy(c), cs * 0.35, cs * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'conveyor':
        ctx.fillStyle = '#9C95C9';
        ctx.fillText('↑→↓←'[fx.dir]!, cx(c), cy(c));
        break;
      case 'ice':
        ctx.fillStyle = 'rgba(61,220,255,0.18)';
        ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
        break;
      case 'fragile':
      case 'pit': {
        const hole = fx.type === 'pit' ? reg !== 200 : reg === 100;
        ctx.fillStyle = hole ? '#000' : '#2A2452';
        ctx.fillRect(x + 3, y + 3, cs - 6, cs - 6);
        if (fx.type === 'fragile' && !hole) {
          ctx.fillStyle = '#9C95C9';
          ctx.fillText(String(fx.durability - reg), cx(c), cy(c));
        }
        break;
      }
      case 'emitter':
        ctx.fillStyle = '#FF4D5E';
        ctx.fillText('↑→↓←'[fx.dir]!, cx(c), cy(c));
        break;
      case 'mirror':
        ctx.strokeStyle = '#ECE8FF';
        ctx.lineWidth = 3;
        ctx.beginPath();
        if ((fx.orient === '/') !== (fx.color >= 0 && !!s.signals[fx.color])) {
          ctx.moveTo(x + 4, y + cs - 4);
          ctx.lineTo(x + cs - 4, y + 4);
        } else {
          ctx.moveTo(x + 4, y + 4);
          ctx.lineTo(x + cs - 4, y + cs - 4);
        }
        ctx.stroke();
        break;
      case 'stairs':
        ctx.fillStyle = '#9C95C9';
        ctx.fillText('≡', cx(c), cy(c));
        break;
      case 'lift':
        ctx.strokeStyle = hexOf(fx.color);
        ctx.strokeRect(x + 6, y + 6, cs - 12, cs - 12);
        ctx.fillStyle = hexOf(fx.color);
        ctx.fillText(reg ? '▲' : '▼', cx(c), cy(c));
        break;
    }
    ctx.restore();
  }

  // Лучи.
  ctx.strokeStyle = 'rgba(255,77,94,0.8)';
  ctx.lineWidth = 3;
  for (const b of s.beams) {
    ctx.beginPath();
    ctx.moveTo(cx(b.emitter), cy(b.emitter));
    for (const c of b.cells) ctx.lineTo(cx(c), cy(c));
    ctx.stroke();
  }

  // Ящики, предметы.
  for (const b of s.boxes) {
    if (b < 0) continue;
    ctx.fillStyle = '#8a6d3b';
    ctx.fillRect(cx(b) - cs * 0.32, cy(b) - cs * 0.32, cs * 0.64, cs * 0.64);
  }
  for (const it of s.items) {
    if (it.cell < 0 || it.consumed) continue;
    ctx.fillStyle = it.kind === 'key' ? hexOf(it.color) : '#5CF2B5';
    ctx.fillText(it.kind === 'key' ? '⚷' : '▮', cx(it.cell), cy(it.cell));
  }

  // Стражи и их обзор.
  const d = toDraft(s);
  s.guards.forEach((g, gi) => {
    ctx.fillStyle = 'rgba(255,77,94,0.15)';
    for (const c of guardSight(d, gi)) ctx.fillRect((c % L.width) * cs, Math.floor(c / L.width) * cs, cs, cs);
    ctx.fillStyle = '#FF4D5E';
    ctx.beginPath();
    ctx.arc(cx(g.cell), cy(g.cell), cs * 0.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Акторы.
  s.actors.forEach((a) => {
    const col = a.kind === 'player' ? '#FFE45E' : a.status === 'broken' ? '#FF4D5E' : '#8C9EFF';
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      cx(a.cell),
      cy(a.cell) - (a.riding ? cs * 0.15 : 0),
      cs * (a.kind === 'player' ? 0.26 : 0.3),
      0,
      Math.PI * 2,
    );
    if (a.kind === 'player') ctx.fill();
    else ctx.stroke();
    if (a.kind === 'echo') ctx.fillText(String(a.echo + 1), cx(a.cell), cy(a.cell));
    const dx = [0, 1, 0, -1][a.facing]!;
    const dy = [-1, 0, 1, 0][a.facing]!;
    ctx.beginPath();
    ctx.moveTo(cx(a.cell), cy(a.cell));
    ctx.lineTo(cx(a.cell) + dx * cs * 0.4, cy(a.cell) + dy * cs * 0.4);
    ctx.stroke();
  });
}
