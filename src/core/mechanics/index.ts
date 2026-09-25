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
