import type { Mechanic } from '../mechanic';
import { conveyors } from './conveyors';
import { doors } from './doors';
import { fragile } from './fragile';
import { guards } from './guards';
import { height } from './height';
import { ice } from './ice';
import { items } from './items';
import { lasers } from './lasers';
import { levers } from './levers';
import { locks } from './locks';
import { plates } from './plates';
import { portals } from './portals';
import { sockets } from './sockets';
import { timerDoors } from './timerDoors';

/** Механика выхода: сама клетка проходима, победа проверяется в фазе 6 ядра. */
const exit: Mechanic = { id: 'exit', fixtures: ['exit'] };

/**
 * Реестр механик. Порядок важен для фазы 5: сначала источники сигналов (плиты, рычаги, гнёзда),
 * затем лазеры (приёмники читают уже собранные сигналы), затем потребители (двери, лифты).
 */
export const MECHANICS: readonly Mechanic[] = [
  plates,
  levers,
  sockets,
  items,
  locks,
  portals,
  ice,
  fragile,
  conveyors,
  guards,
  lasers,
  doors,
  timerDoors,
  height,
  exit,
];

type Fn<K extends keyof Mechanic> = NonNullable<Mechanic[K]>;

function collect<K extends keyof Mechanic>(key: K): Fn<K>[] {
  const out: Fn<K>[] = [];
  for (const m of MECHANICS) {
    const f = m[key];
    if (typeof f === 'function') out.push((f as (...a: unknown[]) => unknown).bind(m) as Fn<K>);
  }
  return out;
}

/**
 * Глобальные хуки, собранные в плоские списки один раз: обход без полиморфных
 * обращений к объектам механик — это горячий путь решателя.
 */
export const HOOKS = {
  afterMoves: collect('afterMoves'),
  emitSignals: collect('emitSignals'),
  applySignals: collect('applySignals'),
  finalize: collect('finalize'),
  check: collect('check'),
  /** Взаимодействие механик без приспособлений (перенос предметов). */
  looseInteract: MECHANICS.filter((m) => !m.fixtures.length && m.interact).map((m) => m.interact!.bind(m)),
};
