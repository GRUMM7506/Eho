import type { Mechanic } from '../mechanic';
import { emit, type Draft } from '../world';

/** Кто нажимает плиту: 1 — игрок, 2 — эхо, 3 — ящик, 0 — никто. */
function presser(d: Draft, cell: number): 0 | 1 | 2 | 3 {
  const fx = d.level.fixtures[cell];
  if (!fx || fx.type !== 'plate') return 0;
  let echo = false;
  for (const a of d.actors) {
    if (a.cell !== cell || a.riding) continue;
    if (a.kind === 'player' && fx.filter !== 'echo') return 1;
    if (a.kind === 'echo' && fx.filter !== 'player') echo = true;
  }
  if (echo) return 2;
  if (fx.filter === 'any' && d.boxes.includes(cell)) return 3;
  return 0;
}

/**
 * Плиты. Плита держит сигнал своего цвета, пока на ней стоит актор или ящик.
 * Плита эха реагирует только на копии, плита игрока — только на настоящего игрока.
 * Ящики нажимают только обычные плиты. Несколько плит одного цвета работают по ИЛИ.
 */
export const plates: Mechanic = {
  id: 'plates',
  fixtures: ['plate'],
  initCell: () => 0,
  emitSignals(d, sig) {
    for (const cell of d.level.byType.plate) {
      const fx = d.level.fixtures[cell];
      if (!fx || fx.type !== 'plate') continue;
      const p = presser(d, cell);
      d.cells[cell] = p;
      if (p) sig[fx.color] = true;
    }
  },
  finalize(d) {
    for (const cell of d.level.byType.plate) {
      const was = d.prev.cells[cell] ?? 0;
      const now = d.cells[cell] ?? 0;
      if (!was && now)
        emit(d, { type: 'plateDown', cell, by: now === 1 ? 'player' : now === 2 ? 'echo' : 'box' });
      else if (was && !now) emit(d, { type: 'plateUp', cell });
    }
  },
};
