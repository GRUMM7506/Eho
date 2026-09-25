import { z } from 'zod';
import type {
  ColorId,
  Dir,
  Fixture,
  FixtureType,
  GuardSpec,
  Hint,
  ItemSpec,
  Level,
  Terrain,
} from './types';
import { COLORS } from './types';

const color = z.enum(COLORS);
const dir = z.enum(['N', 'E', 'S', 'W']);
const text = z.object({ ru: z.string(), en: z.string() });

export const legendEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wall') }),
  z.object({ type: z.literal('floor') }),
  z.object({ type: z.literal('void') }),
  z.object({ type: z.literal('start'), facing: dir.optional() }),
  z.object({ type: z.literal('exit') }),
  z.object({ type: z.literal('box') }),
  z.object({ type: z.literal('key'), color }),
  z.object({ type: z.literal('battery') }),
  z.object({ type: z.literal('plate'), color, filter: z.enum(['any', 'echo', 'player']).optional() }),
  z.object({ type: z.literal('door'), color, inverse: z.boolean().optional() }),
  z.object({ type: z.literal('timerDoor'), from: z.number().int().min(0), to: z.number().int().min(0) }),
  z.object({ type: z.literal('lever'), color, on: z.boolean().optional() }),
  z.object({ type: z.literal('lock'), color }),
  z.object({ type: z.literal('socket'), color }),
  z.object({ type: z.literal('portal'), color }),
  z.object({ type: z.literal('conveyor'), dir }),
  z.object({ type: z.literal('ice') }),
  z.object({ type: z.literal('fragile'), durability: z.number().int().min(1).max(9).optional() }),
  z.object({ type: z.literal('pit') }),
  z.object({ type: z.literal('emitter'), dir, color: color.optional(), invert: z.boolean().optional() }),
  z.object({ type: z.literal('mirror'), orient: z.enum(['/', '\\']), color: color.optional() }),
  z.object({ type: z.literal('receiver'), color }),
  z.object({ type: z.literal('stairs') }),
  z.object({ type: z.literal('lift'), color, low: z.number().int().min(0).max(9).optional(), high: z.number().int().min(0).max(9) }),
  z.object({
    type: z.literal('guard'),
    route: z.string().regex(/^[URDL]*$/).optional(),
    mode: z.enum(['patrol', 'lure']).optional(),
    range: z.number().int().min(0).max(20).optional(),
    facing: dir.optional(),
  }),
  z.object({ type: z.literal('solid') }),
]);

export type LegendEntry = z.infer<typeof legendEntrySchema>;

const hintSchema = z.object({
  text,
  touch: text.optional(),
  minEchoes: z.number().int().optional(),
  maxEchoes: z.number().int().optional(),
  afterTick: z.number().int().optional(),
  arrow: z.tuple([z.number().int(), z.number().int()]).optional(),
  keys: z.array(z.string()).optional(),
});

export const rawLevelSchema = z.object({
  id: z.string().min(1),
  world: z.number().int().min(0),
  index: z.number().int().min(0),
  bonus: z.boolean().optional(),
  starsRequired: z.number().int().min(0).optional(),
  name: text,
  map: z.array(z.string()).min(1),
  heights: z.array(z.string()).optional(),
  legend: z.record(z.string(), z.union([legendEntrySchema, z.array(legendEntrySchema)])).optional(),
  tickLimit: z.number().int().min(1).max(200),
  maxEchoes: z.number().int().min(0).max(12),
  par: z.object({ echoes: z.number().int().min(0), ticks: z.number().int().min(0) }),
  hints: z.array(hintSchema).optional(),
  camera: z.object({ yaw: z.number() }).optional(),
  reverseEchoes: z.boolean().optional(),
});

export type RawLevel = z.infer<typeof rawLevelSchema>;

/** Стандартная легенда. Уровень может переопределить любой символ. */
export const DEFAULT_LEGEND: Readonly<Record<string, LegendEntry | LegendEntry[]>> = {
  '#': { type: 'wall' },
  '.': { type: 'floor' },
  ' ': { type: 'void' },
  S: { type: 'start' },
  X: { type: 'exit' },
  o: { type: 'box' },
  _: { type: 'pit' },
  '~': { type: 'ice' },
  '%': { type: 'fragile', durability: 1 },
  '=': { type: 'stairs' },
  '>': { type: 'conveyor', dir: 'E' },
  '<': { type: 'conveyor', dir: 'W' },
  '^': { type: 'conveyor', dir: 'N' },
  v: { type: 'conveyor', dir: 'S' },
  ':': [{ type: 'floor' }, { type: 'solid' }],
  a: { type: 'plate', color: 'pink' },
  b: { type: 'plate', color: 'cyan' },
  c: { type: 'plate', color: 'violet' },
  d: { type: 'plate', color: 'orange' },
  A: { type: 'door', color: 'pink' },
  B: { type: 'door', color: 'cyan' },
  C: { type: 'door', color: 'violet' },
  D: { type: 'door', color: 'orange' },
  '1': { type: 'door', color: 'pink', inverse: true },
  '2': { type: 'door', color: 'cyan', inverse: true },
  '3': { type: 'door', color: 'violet', inverse: true },
  '4': { type: 'door', color: 'orange', inverse: true },
};

const DIR_OF: Record<'N' | 'E' | 'S' | 'W', Dir> = { N: 0, E: 1, S: 2, W: 3 };
const ROUTE_DIR: Record<string, Dir> = { U: 0, R: 1, D: 2, L: 3 };

function colorId(c: (typeof COLORS)[number]): ColorId {
  return COLORS.indexOf(c) as ColorId;
}

export class LevelError extends Error {}

const FIXTURE_TYPES: readonly FixtureType[] = [
  'plate',
  'door',
  'timerDoor',
  'lever',
  'lock',
  'socket',
  'portal',
  'conveyor',
  'ice',
  'fragile',
  'pit',
  'emitter',
  'mirror',
  'receiver',
  'stairs',
  'lift',
  'exit',
];

/** Разбор и проверка JSON уровня. Бросает `LevelError` с понятным сообщением. */
export function parseRawLevel(json: unknown): RawLevel {
  const r = rawLevelSchema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new LevelError(`Неверный формат уровня: ${issue?.path.join('.')}: ${issue?.message}`);
  }
  return r.data;
}

/** Компиляция уровня из JSON в статическую структуру для симуляции. */
export function compileLevel(json: unknown): Level {
  const raw = parseRawLevel(json);
  const height = raw.map.length;
  const width = Math.max(...raw.map.map((r) => [...r].length));
  const n = width * height;
  const terrain: Terrain[] = new Array<Terrain>(n).fill('void');
  const heights: number[] = new Array<number>(n).fill(0);
  const fixtures: (Fixture | null)[] = new Array<Fixture | null>(n).fill(null);
  const solidZone: boolean[] = new Array<boolean>(n).fill(false);
  const boxes: number[] = [];
  const items: ItemSpec[] = [];
  const guards: GuardSpec[] = [];
  const portalsByColor = new Map<ColorId, number[]>();
  let start = -1;
  let startFacing: Dir = 2;
  let exit = -1;
  const legend = { ...DEFAULT_LEGEND, ...(raw.legend ?? {}) };

  for (let y = 0; y < height; y++) {
    const row = [...(raw.map[y] ?? '')];
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ' ';
      const cell = y * width + x;
      const spec = legend[ch];
      if (spec === undefined) throw new LevelError(`Символ «${ch}» (${x},${y}) не описан в легенде`);
      const entries = Array.isArray(spec) ? spec : [spec];
      terrain[cell] = 'floor';
      const setFixture = (f: Fixture) => {
        if (fixtures[cell]) throw new LevelError(`Два приспособления в клетке (${x},${y})`);
        fixtures[cell] = f;
      };
      for (const e of entries) {
        switch (e.type) {
          case 'wall':
            terrain[cell] = 'wall';
            break;
          case 'void':
            terrain[cell] = 'void';
            break;
          case 'floor':
            break;
          case 'solid':
            solidZone[cell] = true;
            break;
          case 'start':
            if (start >= 0) throw new LevelError('Больше одного старта');
            start = cell;
            startFacing = e.facing ? DIR_OF[e.facing] : 2;
            break;
          case 'exit':
            if (exit >= 0) throw new LevelError('Больше одного выхода');
            exit = cell;
            setFixture({ type: 'exit' });
            break;
          case 'box':
            boxes.push(cell);
            break;
          case 'key':
            items.push({ kind: 'key', color: colorId(e.color), cell });
            break;
          case 'battery':
            items.push({ kind: 'battery', color: 0, cell });
            break;
          case 'guard':
            guards.push({
              cell,
              facing: e.facing ? DIR_OF[e.facing] : 2,
              route: [...(e.route ?? '')].map((c) => ROUTE_DIR[c]!),
              mode: e.mode ?? 'patrol',
              range: e.range ?? 4,
            });
            break;
          case 'plate':
            setFixture({ type: 'plate', color: colorId(e.color), filter: e.filter ?? 'any' });
            break;
          case 'door':
            setFixture({ type: 'door', color: colorId(e.color), inverse: e.inverse ?? false });
            break;
          case 'timerDoor':
            setFixture({ type: 'timerDoor', from: e.from, to: e.to });
            break;
          case 'lever':
            setFixture({ type: 'lever', color: colorId(e.color), on: e.on ?? false });
            break;
          case 'lock':
            setFixture({ type: 'lock', color: colorId(e.color) });
            break;
          case 'socket':
            setFixture({ type: 'socket', color: colorId(e.color) });
            break;
          case 'portal': {
            const c = colorId(e.color);
            const list = portalsByColor.get(c) ?? [];
            list.push(cell);
            portalsByColor.set(c, list);
            setFixture({ type: 'portal', color: c, pair: -1 });
            break;
          }
          case 'conveyor':
            setFixture({ type: 'conveyor', dir: DIR_OF[e.dir] });
            break;
          case 'ice':
            setFixture({ type: 'ice' });
            break;
          case 'fragile':
            setFixture({ type: 'fragile', durability: e.durability ?? 1 });
            break;
          case 'pit':
            setFixture({ type: 'pit' });
            break;
          case 'emitter':
            setFixture({
              type: 'emitter',
              dir: DIR_OF[e.dir],
              color: e.color ? colorId(e.color) : -1,
              invert: e.invert ?? false,
            });
            break;
          case 'mirror':
            setFixture({ type: 'mirror', orient: e.orient, color: e.color ? colorId(e.color) : -1 });
            break;
          case 'receiver':
            setFixture({ type: 'receiver', color: colorId(e.color) });
            break;
          case 'stairs':
            setFixture({ type: 'stairs' });
            break;
          case 'lift':
            setFixture({ type: 'lift', color: colorId(e.color), low: e.low ?? 0, high: e.high });
            break;
        }
      }
    }
  }
  if (start < 0) throw new LevelError('Нет старта (S)');
  if (exit < 0) throw new LevelError('Нет выхода (X)');

  for (const [c, list] of portalsByColor) {
    if (list.length !== 2) throw new LevelError(`Порталов цвета ${COLORS[c]} должно быть ровно два`);
    const [p, q] = list as [number, number];
    fixtures[p] = { type: 'portal', color: c, pair: q };
    fixtures[q] = { type: 'portal', color: c, pair: p };
  }

  if (raw.heights) {
    for (let y = 0; y < height; y++) {
      const row = [...(raw.heights[y] ?? '')];
      for (let x = 0; x < width; x++) {
        const ch = row[x] ?? '0';
        const h = ch === '.' || ch === ' ' ? 0 : Number(ch);
        if (!Number.isInteger(h) || h < 0 || h > 9) throw new LevelError(`Неверная высота «${ch}» (${x},${y})`);
        heights[y * width + x] = h;
      }
    }
  }

  const byType = Object.fromEntries(FIXTURE_TYPES.map((t) => [t, [] as number[]])) as Record<FixtureType, number[]>;
  fixtures.forEach((f, cell) => {
    if (f) byType[f.type].push(cell);
  });

  const hints: Hint[] = (raw.hints ?? []).map((h) => ({
    text: h.text,
    touch: h.touch,
    minEchoes: h.minEchoes,
    maxEchoes: h.maxEchoes,
    afterTick: h.afterTick,
    arrow: h.arrow ? h.arrow[1] * width + h.arrow[0] : undefined,
    keys: h.keys,
  }));

  return {
    id: raw.id,
    world: raw.world,
    index: raw.index,
    bonus: raw.bonus ?? false,
    starsRequired: raw.starsRequired ?? 0,
    name: raw.name,
    width,
    height,
    terrain,
    heights,
    fixtures,
    solidZone,
    start,
    startFacing,
    exit,
    boxes,
    items,
    guards,
    tickLimit: raw.tickLimit,
    maxEchoes: raw.maxEchoes,
    par: raw.par,
    hints,
    cameraYaw: raw.camera?.yaw ?? 45,
    reverseEchoes: raw.reverseEchoes ?? false,
    byType,
  };
}
