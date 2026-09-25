import type { Mechanic } from '../mechanic';
import { emit, isOccupied } from '../world';

export const FRAGILE_BROKEN = 100;
export const HOLE_FILLED = 200;

/**
 * Хрупкий пол и ямы. Хрупкая плитка выдерживает N уходов с неё за петлю; после N-го она
 * рушится в яму, как только на ней никого не останется. В яму нельзя войти, а ящик засыпает её
 * и превращается в пол. Регистр: число уходов; 100 — яма; 200 — засыпано.
 */
export const fragile: Mechanic = {
  id: 'fragile',
  fixtures: ['fragile', 'pit'],
  initCell: () => 0,
  isHole(d, cell) {
    const fx = d.level.fixtures[cell];
    const reg = d.cells[cell] ?? 0;
    if (fx?.type === 'pit') return reg !== HOLE_FILLED;
    return reg === FRAGILE_BROKEN;
  },
  fillHole(d, cell) {
    d.cells[cell] = HOLE_FILLED;
  },
  onLeave(d, _mover, cell) {
    const fx = d.level.fixtures[cell];
    const reg = d.cells[cell] ?? 0;
    if (fx?.type !== 'fragile' || reg >= FRAGILE_BROKEN) return;
    d.cells[cell] = reg + 1;
    emit(d, { type: 'crack', cell });
  },
  finalize(d) {
    for (const cell of d.level.byType.fragile) {
      const fx = d.level.fixtures[cell];
      const reg = d.cells[cell] ?? 0;
      if (fx?.type !== 'fragile' || reg < fx.durability || reg >= FRAGILE_BROKEN) continue;
      if (isOccupied(d, cell)) continue;
      d.cells[cell] = FRAGILE_BROKEN;
      emit(d, { type: 'break', cell });
    }
  },
};
