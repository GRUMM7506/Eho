import type { Mechanic } from '../mechanic';
import { emit, isOccupied } from '../world';

/**
 * Двери и инверсные двери. Обычная дверь открыта, пока активен сигнал её цвета;
 * инверсная (штриховка) — наоборот. Дверь не закрывается, пока в проёме кто-то или что-то стоит.
 */
export const doors: Mechanic = {
  id: 'doors',
  fixtures: ['door'],
  initCell: () => 0,
  blocksEntry: (d, cell) => d.cells[cell] === 0,
  blocksSight: (d, cell) => d.cells[cell] === 0,
  applySignals(d, sig) {
    for (const cell of d.level.byType.door) {
      const fx = d.level.fixtures[cell];
      if (!fx || fx.type !== 'door') continue;
      const want = fx.inverse ? !sig[fx.color] : !!sig[fx.color];
      d.cells[cell] = want || (d.cells[cell] === 1 && isOccupied(d, cell)) ? 1 : 0;
    }
  },
  finalize(d) {
    for (const cell of d.level.byType.door) {
      const was = d.prev.cells[cell] ?? 0;
      const now = d.cells[cell] ?? 0;
      if (was !== now) emit(d, { type: now ? 'doorOpen' : 'doorClose', cell });
    }
  },
};
