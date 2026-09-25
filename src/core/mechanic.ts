import type { Draft } from './world';
import type { Dir, FixtureType, Level, Mover } from './types';

/** Результат взаимодействия: выполнено, невозможно, либо механика здесь ни при чём. */
export type InteractOutcome = 'done' | 'fail' | 'skip';

/** Эффект входа в клетку. */
export type EnterEffect = { readonly teleport: number } | { readonly slide: true };

/**
 * Общий интерфейс механики. Новая механика — это один файл с объектом `Mechanic`
 * и одна строка в `mechanics/index.ts`. Все хуки необязательны.
 *
 * Хуки вызываются в фиксированном порядке фаз тика (см. `sim.ts`).
 */
export interface Mechanic {
  readonly id: string;
  /** Типы приспособлений, которыми владеет механика. */
  readonly fixtures: readonly FixtureType[];

  /** Начальное значение регистра клетки в начале петли. */
  initCell?(level: Level, cell: number): number;

  /** Фаза 2. Закрывает ли приспособление клетку для входа (двери, пьедесталы…). */
  blocksEntry?(d: Draft, cell: number, mover: Mover): boolean;
  /** Клетка — яма: актор не войдёт, ящик засыплет её. */
  isHole?(d: Draft, cell: number): boolean;
  fillHole?(d: Draft, cell: number): void;
  /** Высота пола (лифт). null — обычная высота из карты. */
  floorHeight?(d: Draft, cell: number): number | null;
  /** Через клетку можно перейти на соседний этаж (лестница). */
  isRamp?(d: Draft, cell: number): boolean;
  /** Клетка непрозрачна для луча и взгляда. */
  blocksSight?(d: Draft, cell: number): boolean;

  /** Фаза 3. Взаимодействие актора с клеткой перед собой. */
  interact?(d: Draft, actor: number, front: number): InteractOutcome;

  /** Фаза 4. Эффект входа в клетку (портал, лёд) — проверка до входа… */
  canArrive?(d: Draft, mover: Mover, cell: number, dir: Dir): boolean;
  /** …и сам эффект после входа. */
  onEnter?(d: Draft, mover: Mover, cell: number, dir: Dir): EnterEffect | null;
  onLeave?(d: Draft, mover: Mover, cell: number): void;
  /** Фаза 4, хвост: конвейеры, стражи. */
  afterMoves?(d: Draft): void;

  /** Фаза 5а. Источники сигналов цветов (плиты, рычаги, гнёзда, приёмники). */
  emitSignals?(d: Draft, sig: boolean[]): void;
  /** Фаза 5б. Реакция на сигналы (двери, лифты). */
  applySignals?(d: Draft, sig: boolean[]): void;
  /** Фаза 5в. Итог: события изменений, разрушение пола. */
  finalize?(d: Draft): void;

  /** Фаза 6. Проверки: смерть игрока. */
  check?(d: Draft): void;
}
