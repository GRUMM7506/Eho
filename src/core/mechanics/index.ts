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
 *
 * Реестр строится лениво, при первом обращении: механики импортируют правила движения, а
 * правила — реестр, и при разном порядке загрузки модулей (например, в воркере) обращение к
 * ещё не инициализированной механике на уровне модуля ломало бы запуск.
 */
function build(): readonly Mechanic[] {
  return [
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
}

type Fn<K extends keyof Mechanic> = NonNullable<Mechanic[K]>;

function collect<K extends keyof Mechanic>(list: readonly Mechanic[], key: K): Fn<K>[] {
  const out: Fn<K>[] = [];
  for (const m of list) {
    const f = m[key];
    if (typeof f === 'function') out.push((f as (...a: unknown[]) => unknown).bind(m) as Fn<K>);
  }
  return out;
}

interface Hooks {
  afterMoves: Fn<'afterMoves'>[];
  emitSignals: Fn<'emitSignals'>[];
  applySignals: Fn<'applySignals'>[];
  finalize: Fn<'finalize'>[];
  check: Fn<'check'>[];
  /** Взаимодействие механик без приспособлений (перенос предметов). */
  looseInteract: Fn<'interact'>[];
}

let mechanics: readonly Mechanic[] | null = null;
let hooks: Hooks | null = null;

export function getMechanics(): readonly Mechanic[] {
  return (mechanics ??= build());
}

/**
 * Глобальные хуки, собранные в плоские списки один раз: обход без полиморфных
 * обращений к объектам механик — это горячий путь решателя.
 */
export function getHooks(): Hooks {
  if (!hooks) {
    const list = getMechanics();
    hooks = {
      afterMoves: collect(list, 'afterMoves'),
      emitSignals: collect(list, 'emitSignals'),
      applySignals: collect(list, 'applySignals'),
      finalize: collect(list, 'finalize'),
      check: collect(list, 'check'),
      looseInteract: list.filter((m) => !m.fixtures.length && m.interact).map((m) => m.interact!.bind(m)),
    };
  }
  return hooks;
}
