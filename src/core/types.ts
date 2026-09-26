/**
 * Базовые типы симуляции «ЭХО».
 * Ядро не зависит от DOM и Three.js и полностью детерминировано.
 */

/** Сеточное направление: 0 — север (up), 1 — восток (right), 2 — юг (down), 3 — запад (left). */
export type Dir = 0 | 1 | 2 | 3;

/** Ввод игрока на тик. Направления — сеточные, не экранные. */
export type Action = 'none' | 'up' | 'right' | 'down' | 'left' | 'interact';

/**
 * Записанное действие в компактной форме, по одному символу на тик:
 * `.` — ничего, `U R D L` — шаг на север/восток/юг/запад,
 * `u r d l` — взаимодействие лицом на север/восток/юг/запад.
 */
export type RecChar = '.' | 'U' | 'R' | 'D' | 'L' | 'u' | 'r' | 'd' | 'l';

export const COLORS = ['pink', 'cyan', 'violet', 'orange'] as const;
export type Color = (typeof COLORS)[number];
export type ColorId = 0 | 1 | 2 | 3;

export type PlateFilter = 'any' | 'echo' | 'player';

export type Fixture =
  | { readonly type: 'plate'; readonly color: ColorId; readonly filter: PlateFilter }
  | { readonly type: 'door'; readonly color: ColorId; readonly inverse: boolean }
  | { readonly type: 'timerDoor'; readonly from: number; readonly to: number }
  | { readonly type: 'lever'; readonly color: ColorId; readonly on: boolean }
  | { readonly type: 'lock'; readonly color: ColorId }
  | { readonly type: 'socket'; readonly color: ColorId }
  | { readonly type: 'portal'; readonly color: ColorId; readonly pair: number }
  | { readonly type: 'conveyor'; readonly dir: Dir }
  | { readonly type: 'ice' }
  | { readonly type: 'fragile'; readonly durability: number }
  | { readonly type: 'pit' }
  | { readonly type: 'emitter'; readonly dir: Dir; readonly color: ColorId | -1; readonly invert: boolean }
  | { readonly type: 'mirror'; readonly orient: '/' | '\\'; readonly color: ColorId | -1 }
  | { readonly type: 'receiver'; readonly color: ColorId }
  | { readonly type: 'stairs' }
  | { readonly type: 'lift'; readonly color: ColorId; readonly low: number; readonly high: number }
  | { readonly type: 'exit' };

export type FixtureType = Fixture['type'];
export type FixtureOf<T extends FixtureType> = Extract<Fixture, { type: T }>;

export type Terrain = 'floor' | 'wall' | 'void';

export type ItemKind = 'key' | 'battery';

export interface ItemSpec {
  readonly kind: ItemKind;
  readonly color: ColorId;
  readonly cell: number;
}

export type GuardMode = 'patrol' | 'lure';

export interface GuardSpec {
  readonly cell: number;
  readonly facing: Dir;
  /** Маршрут: строка из `U R D L`, проходится по кругу. */
  readonly route: readonly Dir[];
  readonly mode: GuardMode;
  readonly range: number;
}

export interface LocalText {
  readonly ru: string;
  readonly en: string;
}

export interface Hint {
  readonly text: LocalText;
  /** Вариант текста для сенсорного управления. */
  readonly touch?: LocalText;
  /** Показывать, когда записано не меньше/не больше стольких эхо. */
  readonly minEchoes?: number;
  readonly maxEchoes?: number;
  /** Показывать после этого тика петли. */
  readonly afterTick?: number;
  /** Стрелка над клеткой. */
  readonly arrow?: number;
  /** Подсвеченные действия (ключи раскладки). */
  readonly keys?: readonly string[];
}

export interface Par {
  readonly echoes: number;
  readonly ticks: number;
}

/** Скомпилированный статический уровень. */
export interface Level {
  readonly id: string;
  readonly world: number;
  readonly index: number;
  readonly bonus: boolean;
  /** Сколько звёзд нужно, чтобы открыть бонусный уровень. */
  readonly starsRequired: number;
  readonly name: LocalText;
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly Terrain[];
  readonly heights: readonly number[];
  readonly fixtures: readonly (Fixture | null)[];
  readonly solidZone: readonly boolean[];
  readonly start: number;
  readonly startFacing: Dir;
  readonly exit: number;
  readonly boxes: readonly number[];
  readonly items: readonly ItemSpec[];
  readonly guards: readonly GuardSpec[];
  readonly tickLimit: number;
  readonly maxEchoes: number;
  readonly par: Par;
  readonly hints: readonly Hint[];
  readonly cameraYaw: number;
  readonly reverseEchoes: boolean;
  /** Клетки по типу приспособления, для быстрого обхода. */
  readonly byType: { readonly [K in FixtureType]: readonly number[] };
}

export type ActorKind = 'player' | 'echo';
export type ActorStatus = 'ok' | 'broken' | 'dead';

export interface ActorState {
  readonly kind: ActorKind;
  /** Номер эхо (возраст), у игрока −1. */
  readonly echo: number;
  readonly cell: number;
  readonly facing: Dir;
  /** Индекс переносимого предмета или −1. */
  readonly carrying: number;
  readonly status: ActorStatus;
  /** Стоит на крыше твёрдого эхо (на этаж выше пола). */
  readonly riding: boolean;
  /** Тик, на котором эхо сбилось. */
  readonly brokenAt: number;
}

export interface ItemState {
  readonly kind: ItemKind;
  readonly color: ColorId;
  /** Клетка, где лежит предмет (или гнездо), −1 если несут или израсходован. */
  readonly cell: number;
  /** Кто несёт (индекс актора) или −1. */
  readonly carrier: number;
  readonly consumed: boolean;
}

export interface GuardState {
  readonly cell: number;
  readonly facing: Dir;
  readonly routeIdx: number;
}

export interface BeamPath {
  readonly emitter: number;
  /** Клетки, через которые идёт луч (включая клетку остановки). */
  readonly cells: readonly number[];
  /** Чем закончился луч. */
  readonly end: 'edge' | 'block' | 'receiver' | 'echo' | 'player';
}

export interface EchoRecord {
  readonly actions: string;
  /** Где закончилась запись (нужно для обратного эхо). */
  readonly endCell: number;
  readonly endFacing: Dir;
}

export type Outcome = 'playing' | 'won' | 'dead' | 'timeout';

/** Неизменяемый снимок мира. */
export interface WorldState {
  readonly level: Level;
  readonly records: readonly EchoRecord[];
  readonly tick: number;
  /** Эхо по возрасту, игрок — последний. */
  readonly actors: readonly ActorState[];
  readonly boxes: readonly number[];
  readonly items: readonly ItemState[];
  /** Регистр состояния приспособления в каждой клетке (рычаг, дверь, счётчик хрупкого пола…). */
  readonly cells: readonly number[];
  readonly guards: readonly GuardState[];
  readonly signals: readonly boolean[];
  readonly beams: readonly BeamPath[];
  readonly outcome: Outcome;
  readonly deathCause: 'laser' | 'guard' | null;
  /** Фактически выполненные действия игрока в этой петле. */
  readonly record: string;
  readonly paradoxes: number;
}

export type Mover =
  { readonly kind: 'actor'; readonly index: number } | { readonly kind: 'box'; readonly index: number };

export type SimEvent =
  | { type: 'step'; actor: number; from: number; to: number }
  | { type: 'bump'; actor: number; cell: number }
  | { type: 'push'; box: number; from: number; to: number }
  | { type: 'slide'; mover: Mover; from: number; to: number }
  | { type: 'teleport'; mover: Mover; from: number; to: number }
  | { type: 'conveyor'; mover: Mover; from: number; to: number }
  | { type: 'boxFill'; box: number; cell: number }
  | { type: 'pickup'; actor: number; item: number; cell: number }
  | { type: 'drop'; actor: number; item: number; cell: number }
  | { type: 'socket'; actor: number; item: number; cell: number; on: boolean }
  | { type: 'unlock'; actor: number; item: number; cell: number }
  | { type: 'lever'; actor: number; cell: number; on: boolean }
  | { type: 'plateDown'; cell: number; by: 'player' | 'echo' | 'box' }
  | { type: 'plateUp'; cell: number }
  | { type: 'doorOpen'; cell: number }
  | { type: 'doorClose'; cell: number }
  | { type: 'liftMove'; cell: number; up: boolean }
  | { type: 'crack'; cell: number }
  | { type: 'break'; cell: number }
  | { type: 'receiver'; cell: number; on: boolean }
  | { type: 'guardMove'; guard: number; from: number; to: number }
  | { type: 'paradox'; actor: number; cell: number; reason: ParadoxReason }
  | { type: 'death'; cause: 'laser' | 'guard'; cell: number }
  | { type: 'win'; cell: number }
  | { type: 'timeout' }
  | { type: 'ride'; actor: number; cell: number }
  | { type: 'drop-down'; actor: number; cell: number };

export type ParadoxReason = 'blocked' | 'nothing-to-take' | 'cannot-place' | 'nothing-to-use';

export interface StepResult {
  readonly state: WorldState;
  readonly events: readonly SimEvent[];
  /** Что фактически выполнил игрок (заблокированный ход записывается как `.`). */
  readonly performed: RecChar;
}
