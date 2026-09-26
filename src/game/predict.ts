import { decodeRec } from '../core/grid';
import { echoAction, step } from '../core/sim';
import type { WorldState } from '../core/types';

export type MarkerKind = 'plate' | 'use' | 'paradox';

export interface Marker {
  readonly echo: number;
  readonly tick: number;
  readonly kind: MarkerKind;
}

export interface Prediction {
  /** Тик начала прогноза. */
  readonly from: number;
  /** cells[k][echo] — клетка эхо на тике from + k (игрок стоит на месте). */
  readonly cells: readonly (readonly number[])[];
  readonly markers: readonly Marker[];
}

/**
 * Прогноз петли: куда пойдут копии, если игрок будет просто ждать. Используется для таймлайна
 * (кто когда нажмёт плиту), траекторий и «призрака будущего». Чистая функция.
 */
export function predict(state: WorldState): Prediction {
  const echoes = state.actors.length - 1;
  const cells: number[][] = [state.actors.slice(0, echoes).map((a) => a.cell)];
  const markers: Marker[] = [];
  let s = state;
  while (s.outcome === 'playing' && s.tick < s.level.tickLimit) {
    const t = s.tick;
    for (let e = 0; e < echoes; e++) {
      if (s.actors[e]!.status === 'ok' && decodeRec(echoAction(s, e, t)).kind === 'use')
        markers.push({ echo: e, tick: t + 1, kind: 'use' });
    }
    const r = step(s, 'none');
    for (const ev of r.events)
      if (ev.type === 'paradox') markers.push({ echo: ev.actor, tick: r.state.tick, kind: 'paradox' });
    for (let e = 0; e < echoes; e++) {
      const a = r.state.actors[e]!;
      const before = s.actors[e]!;
      if (a.cell !== before.cell && s.level.fixtures[a.cell]?.type === 'plate')
        markers.push({ echo: e, tick: r.state.tick, kind: 'plate' });
    }
    cells.push(r.state.actors.slice(0, echoes).map((a) => a.cell));
    s = r.state;
  }
  return { from: state.tick, cells, markers };
}
