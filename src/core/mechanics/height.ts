import type { Mechanic } from '../mechanic';
import { emit } from '../world';

/**
 * Высота. У каждой клетки есть этаж (карта высот). Шагнуть можно на клетку того же этажа;
 * на соседний этаж (разница 1) — только через лестницу. Лифт стоит на нижнем этаже `low`
 * и поднимается на `high`, пока активен сигнал его цвета; стоящие на нём едут вместе с ним.
 */
export const height: Mechanic = {
  id: 'height',
  fixtures: ['stairs', 'lift'],
  initCell: () => 0,
  isRamp: (d, cell) => d.level.fixtures[cell]?.type === 'stairs',
  floorHeight(d, cell) {
    const fx = d.level.fixtures[cell];
    if (!fx || fx.type !== 'lift') return null;
    return d.cells[cell] ? fx.high : fx.low;
  },
  applySignals(d, sig) {
    for (const cell of d.level.byType.lift) {
      const fx = d.level.fixtures[cell];
      if (fx?.type === 'lift') d.cells[cell] = sig[fx.color] ? 1 : 0;
    }
  },
  finalize(d) {
    for (const cell of d.level.byType.lift) {
      const was = d.prev.cells[cell] ?? 0;
      const now = d.cells[cell] ?? 0;
      if (was !== now) emit(d, { type: 'liftMove', cell, up: now === 1 });
    }
  },
};
