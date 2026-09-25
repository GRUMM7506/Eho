import type { Mechanic } from '../mechanic';
import { emit, isOccupied } from '../world';

/** Таймерные двери: открыты с тика `from` по тик `to` включительно в каждой петле. */
export const timerDoors: Mechanic = {
  id: 'timerDoors',
  fixtures: ['timerDoor'],
  initCell: () => 0,
  blocksEntry: (d, cell) => d.cells[cell] === 0,
  blocksSight: (d, cell) => d.cells[cell] === 0,
  applySignals(d) {
    for (const cell of d.level.byType.timerDoor) {
      const fx = d.level.fixtures[cell];
      if (!fx || fx.type !== 'timerDoor') continue;
      const want = d.tick >= fx.from && d.tick <= fx.to;
      d.cells[cell] = want || (d.cells[cell] === 1 && isOccupied(d, cell)) ? 1 : 0;
    }
  },
  finalize(d) {
    for (const cell of d.level.byType.timerDoor) {
      const was = d.prev.cells[cell] ?? 0;
      const now = d.cells[cell] ?? 0;
      if (was !== now) emit(d, { type: now ? 'doorOpen' : 'doorClose', cell });
    }
  },
};
