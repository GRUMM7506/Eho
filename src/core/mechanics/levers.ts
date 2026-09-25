import type { Mechanic } from '../mechanic';
import { emit } from '../world';

/**
 * Рычаги. Стоят на пьедестале (клетка непроходима), переключаются «взаимодействием»,
 * когда актор смотрит на рычаг. Состояние держится до конца петли и сбрасывается в её начале.
 */
export const levers: Mechanic = {
  id: 'levers',
  fixtures: ['lever'],
  initCell(level, cell) {
    const fx = level.fixtures[cell];
    return fx && fx.type === 'lever' && fx.on ? 1 : 0;
  },
  blocksEntry: () => true,
  blocksSight: () => true,
  interact(d, actor, front) {
    const on = d.cells[front] ? 0 : 1;
    d.cells[front] = on;
    emit(d, { type: 'lever', actor, cell: front, on: on === 1 });
    return 'done';
  },
  emitSignals(d, sig) {
    for (const cell of d.level.byType.lever) {
      const fx = d.level.fixtures[cell];
      if (fx && fx.type === 'lever' && d.cells[cell]) sig[fx.color] = true;
    }
  },
};
