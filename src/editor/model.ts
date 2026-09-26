import { compileLevel, type LegendEntry, type RawLevel } from '../core/level';
import { COLORS, type Color, type Level } from '../core/types';

/**
 * Модель редактора: сетка клеток, каждая — основа (пол/стена/пустота), не больше одного
 * приспособления, не больше одной сущности (старт, ящик, предмет, страж) и флаг особой зоны.
 * Сериализуется в обычный JSON уровня (карта + легенда) и обратно.
 */

export type Dir4 = 'N' | 'E' | 'S' | 'W';
export type Base = 'floor' | 'wall' | 'void';

export type EdFixture =
  | { type: 'plate'; color: Color; filter: 'any' | 'echo' | 'player' }
  | { type: 'door'; color: Color; inverse: boolean }
  | { type: 'timerDoor'; from: number; to: number }
  | { type: 'lever'; color: Color }
  | { type: 'lock'; color: Color }
  | { type: 'socket'; color: Color }
  | { type: 'portal'; color: Color }
  | { type: 'conveyor'; dir: Dir4 }
  | { type: 'ice' }
  | { type: 'fragile'; durability: number }
  | { type: 'pit' }
  | { type: 'emitter'; dir: Dir4; color: Color | null }
  | { type: 'mirror'; orient: '/' | '\\'; color: Color | null }
  | { type: 'receiver'; color: Color }
  | { type: 'stairs' }
  | { type: 'lift'; color: Color; low: number; high: number }
  | { type: 'exit' };

export type EdEntity =
  | { type: 'start'; facing: Dir4 }
  | { type: 'box' }
  | { type: 'key'; color: Color }
  | { type: 'battery' }
  | { type: 'guard'; facing: Dir4; route: string; mode: 'patrol' | 'lure'; range: number };

export interface EdCell {
  base: Base;
  fx: EdFixture | null;
  entity: EdEntity | null;
  solid: boolean;
  height: number;
}

export interface EdDoc {
  id: string;
  name: { ru: string; en: string };
  width: number;
  height: number;
  cells: EdCell[];
  tickLimit: number;
  maxEchoes: number;
  reverseEchoes: boolean;
  par: { echoes: number; ticks: number };
}

export const MIN_SIZE = 3;
export const MAX_W = 24;
export const MAX_H = 18;

export function emptyCell(base: Base = 'floor'): EdCell {
  return { base, fx: null, entity: null, solid: false, height: 0 };
}

export function newDoc(width = 11, height = 7): EdDoc {
  const cells: EdCell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      cells.push(emptyCell(edge ? 'wall' : 'floor'));
    }
  }
  cells[1 * width + 1]!.entity = { type: 'start', facing: 'S' };
  cells[(height - 2) * width + (width - 2)]!.fx = { type: 'exit' };
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: { ru: 'Новый уровень', en: 'New level' },
    width,
    height,
    cells,
    tickLimit: 30,
    maxEchoes: 3,
    reverseEchoes: false,
    par: { echoes: 3, ticks: 30 },
  };
}

export function resize(doc: EdDoc, width: number, height: number): EdDoc {
  width = Math.max(MIN_SIZE, Math.min(MAX_W, width));
  height = Math.max(MIN_SIZE, Math.min(MAX_H, height));
  const cells: EdCell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const old = x < doc.width && y < doc.height ? doc.cells[y * doc.width + x] : undefined;
      cells.push(old ? structuredClone(old) : emptyCell('wall'));
    }
  }
  return { ...doc, width, height, cells };
}

// ————— инструменты —————

export type Tool =
  | { kind: 'base'; base: Base }
  | { kind: 'fixture'; fx: EdFixture }
  | { kind: 'entity'; entity: EdEntity }
  | { kind: 'solid'; on: boolean }
  | { kind: 'height'; delta: number }
  | { kind: 'erase' };

/** Применить инструмент к клетке. Возвращает, изменилось ли что-нибудь. */
export function applyTool(doc: EdDoc, cell: number, tool: Tool): boolean {
  const c = doc.cells[cell];
  if (!c) return false;
  const before = JSON.stringify(c);
  switch (tool.kind) {
    case 'base':
      c.base = tool.base;
      if (tool.base !== 'floor') {
        c.fx = null;
        c.entity = null;
        c.solid = false;
      }
      break;
    case 'fixture':
      c.base = 'floor';
      if (tool.fx.type === 'exit') {
        for (const o of doc.cells) if (o.fx?.type === 'exit') o.fx = null;
      }
      c.fx = structuredClone(tool.fx);
      if (isPedestal(tool.fx) && c.entity && c.entity.type !== 'guard') c.entity = null;
      break;
    case 'entity':
      c.base = 'floor';
      if (tool.entity.type === 'start') {
        for (const o of doc.cells) if (o.entity?.type === 'start') o.entity = null;
      }
      if (c.fx && isPedestal(c.fx)) c.fx = null;
      c.entity = structuredClone(tool.entity);
      break;
    case 'solid':
      if (c.base === 'floor') c.solid = tool.on;
      break;
    case 'height':
      c.height = Math.max(0, Math.min(9, c.height + tool.delta));
      break;
    case 'erase':
      if (c.entity) c.entity = null;
      else if (c.fx) c.fx = null;
      else if (c.solid) c.solid = false;
      else c.base = 'floor';
      break;
  }
  return JSON.stringify(c) !== before;
}

function isPedestal(fx: EdFixture): boolean {
  return ['lever', 'socket', 'lock', 'emitter', 'mirror', 'receiver'].includes(fx.type);
}

// ————— сериализация —————

function cellEntries(c: EdCell): LegendEntry[] {
  const out: LegendEntry[] = [];
  if (c.base === 'wall') return [{ type: 'wall' }];
  if (c.base === 'void') return [{ type: 'void' }];
  if (c.fx) {
    const f = c.fx;
    switch (f.type) {
      case 'emitter':
        out.push(f.color ? { type: 'emitter', dir: f.dir, color: f.color } : { type: 'emitter', dir: f.dir });
        break;
      case 'mirror':
        out.push(
          f.color
            ? { type: 'mirror', orient: f.orient, color: f.color }
            : { type: 'mirror', orient: f.orient },
        );
        break;
      default:
        out.push(f as LegendEntry);
    }
  }
  if (c.entity) out.push(c.entity as LegendEntry);
  if (c.solid) out.push({ type: 'solid' });
  if (!out.length) out.push({ type: 'floor' });
  return out;
}

const POOL = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWYZ0123456789!$&()*+,-/;<=>?@[]^_`{|}~"\'',
].filter((ch) => ch !== 'X' && ch !== 'S' && ch !== '#' && ch !== '.');

/** Документ редактора → JSON уровня (карта + легенда). */
export function toRaw(doc: EdDoc): RawLevel {
  const legend: Record<string, LegendEntry | LegendEntry[]> = {};
  const byKey = new Map<string, string>();
  let next = 0;
  const map: string[] = [];
  const heights: string[] = [];
  let anyHeight = false;
  for (let y = 0; y < doc.height; y++) {
    let row = '';
    let hrow = '';
    for (let x = 0; x < doc.width; x++) {
      const c = doc.cells[y * doc.width + x]!;
      const entries = cellEntries(c);
      const key = JSON.stringify(entries);
      let ch: string;
      if (key === '[{"type":"wall"}]') ch = '#';
      else if (key === '[{"type":"floor"}]') ch = '.';
      else if (key === '[{"type":"void"}]') ch = ' ';
      else if (key === '[{"type":"exit"}]') ch = 'X';
      else if (entries.length === 1 && entries[0]!.type === 'start') {
        ch = 'S';
        legend.S = entries[0]!;
      } else {
        ch = byKey.get(key) ?? '';
        if (!ch) {
          ch = POOL[next++] ?? '?';
          byKey.set(key, ch);
          legend[ch] = entries.length === 1 ? entries[0]! : entries;
        }
      }
      row += ch;
      hrow += String(c.height);
      if (c.height) anyHeight = true;
    }
    map.push(row);
    heights.push(hrow);
  }
  return {
    id: doc.id,
    world: 9,
    index: 1,
    name: doc.name,
    map,
    ...(anyHeight ? { heights } : {}),
    legend,
    tickLimit: doc.tickLimit,
    maxEchoes: doc.maxEchoes,
    par: doc.par,
    ...(doc.reverseEchoes ? { reverseEchoes: true } : {}),
  };
}

const DIR_NAME: readonly Dir4[] = ['N', 'E', 'S', 'W'];
const ROUTE = 'URDL';

/** JSON уровня → документ редактора (через компиляцию, так что легенда может быть любой). */
export function fromRaw(raw: unknown): EdDoc {
  const L: Level = compileLevel(raw);
  const r = raw as Partial<RawLevel>;
  const color = (c: number): Color => COLORS[c] ?? 'pink';
  const cells: EdCell[] = [];
  for (let i = 0; i < L.width * L.height; i++) {
    const c = emptyCell(L.terrain[i] === 'floor' ? 'floor' : L.terrain[i] === 'wall' ? 'wall' : 'void');
    c.height = L.heights[i] ?? 0;
    c.solid = L.solidZone[i] ?? false;
    const f = L.fixtures[i];
    if (f) {
      switch (f.type) {
        case 'plate':
          c.fx = { type: 'plate', color: color(f.color), filter: f.filter };
          break;
        case 'door':
          c.fx = { type: 'door', color: color(f.color), inverse: f.inverse };
          break;
        case 'timerDoor':
          c.fx = { type: 'timerDoor', from: f.from, to: f.to };
          break;
        case 'lever':
          c.fx = { type: 'lever', color: color(f.color) };
          break;
        case 'lock':
        case 'socket':
        case 'receiver':
        case 'portal':
          c.fx = { type: f.type, color: color(f.color) };
          break;
        case 'conveyor':
          c.fx = { type: 'conveyor', dir: DIR_NAME[f.dir]! };
          break;
        case 'fragile':
          c.fx = { type: 'fragile', durability: f.durability };
          break;
        case 'emitter':
          c.fx = { type: 'emitter', dir: DIR_NAME[f.dir]!, color: f.color >= 0 ? color(f.color) : null };
          break;
        case 'mirror':
          c.fx = { type: 'mirror', orient: f.orient, color: f.color >= 0 ? color(f.color) : null };
          break;
        case 'lift':
          c.fx = { type: 'lift', color: color(f.color), low: f.low, high: f.high };
          break;
        default:
          c.fx = { type: f.type } as EdFixture;
      }
    }
    cells.push(c);
  }
  cells[L.start]!.entity = { type: 'start', facing: DIR_NAME[L.startFacing]! };
  for (const b of L.boxes) cells[b]!.entity = { type: 'box' };
  for (const it of L.items)
    cells[it.cell]!.entity =
      it.kind === 'key' ? { type: 'key', color: color(it.color) } : { type: 'battery' };
  for (const g of L.guards) {
    cells[g.cell]!.entity = {
      type: 'guard',
      facing: DIR_NAME[g.facing]!,
      route: g.route.map((d) => ROUTE[d]).join(''),
      mode: g.mode,
      range: g.range,
    };
  }
  return {
    id: L.id,
    name: { ...L.name },
    width: L.width,
    height: L.height,
    cells,
    tickLimit: L.tickLimit,
    maxEchoes: L.maxEchoes,
    reverseEchoes: L.reverseEchoes,
    par: r.par ? { ...r.par } : { echoes: L.maxEchoes, ticks: L.tickLimit },
  };
}
