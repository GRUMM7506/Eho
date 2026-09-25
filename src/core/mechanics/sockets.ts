import type { Mechanic } from '../mechanic';
import { emit } from '../world';

/**
 * Гнёзда для батареек. Гнездо на пьедестале непроходимо. Пока в нём лежит батарейка,
 * гнездо даёт сигнал своего цвета. Батарейку вставляют и вынимают «взаимодействием».
 * Регистр клетки: 0 — пусто, иначе номер предмета + 1.
 */
export const sockets: Mechanic = {
  id: 'sockets',
  fixtures: ['socket'],
  initCell: () => 0,
  blocksEntry: () => true,
  blocksSight: () => true,
  interact(d, actor, front) {
    const a = d.actors[actor]!;
    const reg = d.cells[front] ?? 0;
    if (a.carrying >= 0) {
      const it = d.items[a.carrying]!;
      if (reg !== 0 || it.kind !== 'battery') return 'fail';
      it.cell = front;
      it.carrier = -1;
      d.cells[front] = a.carrying + 1;
      emit(d, { type: 'socket', actor, item: a.carrying, cell: front, on: true });
      a.carrying = -1;
      return 'done';
    }
    if (reg === 0) return 'fail';
    const idx = reg - 1;
    const it = d.items[idx]!;
    it.cell = -1;
    it.carrier = actor;
    a.carrying = idx;
    d.cells[front] = 0;
    emit(d, { type: 'socket', actor, item: idx, cell: front, on: false });
    return 'done';
  },
  emitSignals(d, sig) {
    for (const cell of d.level.byType.socket) {
      const fx = d.level.fixtures[cell];
      if (fx && fx.type === 'socket' && d.cells[cell]) sig[fx.color] = true;
    }
  },
};
