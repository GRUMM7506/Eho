import type { Mechanic } from '../mechanic';
import { emit } from '../world';

/** Замки. Закрытый замок непроходим; ключ того же цвета открывает его до конца петли (ключ расходуется). */
export const locks: Mechanic = {
  id: 'locks',
  fixtures: ['lock'],
  initCell: () => 0,
  blocksEntry: (d, cell) => d.cells[cell] === 0,
  blocksSight: (d, cell) => d.cells[cell] === 0,
  interact(d, actor, front) {
    if (d.cells[front] === 1) return 'skip';
    const fx = d.level.fixtures[front];
    const a = d.actors[actor]!;
    if (!fx || fx.type !== 'lock' || a.carrying < 0) return 'fail';
    const it = d.items[a.carrying]!;
    if (it.kind !== 'key' || it.color !== fx.color) return 'fail';
    it.consumed = true;
    it.carrier = -1;
    d.cells[front] = 1;
    emit(d, { type: 'unlock', actor, item: a.carrying, cell: front });
    a.carrying = -1;
    return 'done';
  },
};
