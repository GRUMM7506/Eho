import type { Mechanic } from '../mechanic';
import { canPlaceItem } from '../rules';
import { emit, itemAt } from '../world';

/**
 * Перенос предметов (ключи, батарейки). «Взаимодействие» поднимает предмет с клетки перед собой
 * или кладёт несомый. Если поднимать нечего или положить некуда, действие невозможно
 * (для эхо это парадокс).
 */
export const items: Mechanic = {
  id: 'items',
  fixtures: [],
  interact(d, actor, front) {
    const a = d.actors[actor]!;
    if (a.carrying >= 0) {
      if (!canPlaceItem(d, actor, front)) return 'fail';
      const it = d.items[a.carrying]!;
      it.cell = front;
      it.carrier = -1;
      emit(d, { type: 'drop', actor, item: a.carrying, cell: front });
      a.carrying = -1;
      return 'done';
    }
    const i = itemAt(d, front);
    if (i < 0) return 'fail';
    const it = d.items[i]!;
    it.cell = -1;
    it.carrier = actor;
    a.carrying = i;
    emit(d, { type: 'pickup', actor, item: i, cell: front });
    return 'done';
  },
};
