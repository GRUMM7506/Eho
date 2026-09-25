import { compileLevel } from '../core/level';
import { createLoop, inputToAction, recordOf, runInputs, step } from '../core/sim';
import type { EchoRecord, Level, SimEvent, WorldState } from '../core/types';

/** Живой фон главного меню: комната, по которой ходят копии и открывают друг другу двери. */
const MENU_ROOM = {
  id: 'menu',
  world: 99,
  index: 0,
  name: { ru: 'Меню', en: 'Menu' },
  map: [
    '###########',
    '#S...#....#',
    '#.a..A..b.#',
    '#....#....#',
    '###B###.###',
    '#.........#',
    '#..c...X..#',
    '#.........#',
    '###########',
  ],
  tickLimit: 40,
  maxEchoes: 4,
  par: { echoes: 3, ticks: 30 },
};

const LOOPS = ['DRD', 'RRRRRRRRD', 'RRRRRRRRDDDDLLDLLL', 'DDRRRRRRRDDDDDLLLLLLL'];

export interface MenuScene {
  readonly level: Level;
  frame(dt: number): { prev: WorldState; next: WorldState; events: readonly SimEvent[] } | null;
  readonly state: WorldState;
  reset(): WorldState;
}

export function createMenuScene(): MenuScene {
  const level = compileLevel(MENU_ROOM);
  const records: EchoRecord[] = [];
  for (const l of LOOPS.slice(0, 3)) records.push(recordOf(runInputs(level, records, l)));
  const final = LOOPS[3]!;
  let state = createLoop(level, records);
  let acc = 0;
  let hold = 0;
  const TICK = 0.32;
  return {
    level,
    get state() {
      return state;
    },
    reset() {
      state = createLoop(level, records);
      acc = 0;
      hold = 0;
      return state;
    },
    frame(dt) {
      if (hold > 0) {
        hold -= dt;
        if (hold <= 0) {
          const prev = state;
          state = createLoop(level, records);
          return { prev, next: state, events: [] };
        }
        return null;
      }
      acc += dt;
      if (acc < TICK) return null;
      acc -= TICK;
      const prev = state;
      const input = final[state.tick] ?? '.';
      const r = step(state, inputToAction(input));
      state = r.state;
      if (state.outcome !== 'playing' || state.tick >= final.length + 4) hold = 1.5;
      return { prev, next: state, events: r.events };
    },
  };
}
