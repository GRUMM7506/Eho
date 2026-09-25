import type { Mechanic } from '../mechanic';
import { moveMover } from '../rules';
import type { Mover } from '../types';

/**
 * Конвейеры. В конце тика сдвигают на 1 клетку каждого актора (стоящего на полу) и каждый ящик
 * на ленте. Сдвиг не толкает ящики; если путь закрыт, сущность остаётся на месте.
 * Порядок: эхо по возрасту, игрок, затем ящики по номеру. Каждая сущность сдвигается не больше раза за тик.
 */
export const conveyors: Mechanic = {
  id: 'conveyors',
  fixtures: ['conveyor'],
  afterMoves(d) {
    if (!d.level.byType.conveyor.length) return;
    const queue: Mover[] = [];
    d.actors.forEach((a, index) => {
      const fx = d.level.fixtures[a.cell];
      if (fx && fx.type === 'conveyor' && !a.riding) queue.push({ kind: 'actor', index });
    });
    d.boxes.forEach((cell, index) => {
      const fx = cell >= 0 ? d.level.fixtures[cell] : null;
      if (fx && fx.type === 'conveyor') queue.push({ kind: 'box', index });
    });
    for (const m of queue) {
      const cell = m.kind === 'actor' ? d.actors[m.index]!.cell : d.boxes[m.index]!;
      const fx = cell >= 0 ? d.level.fixtures[cell] : null;
      if (!fx || fx.type !== 'conveyor') continue;
      moveMover(d, m, fx.dir, false, 'conveyor');
    }
  },
};
