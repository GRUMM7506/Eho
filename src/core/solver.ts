import { guardSight } from './mechanics/guards';
import { createLoop, INPUT_CHARS, inputToAction, recordOf, step } from './sim';
import { toDraft } from './world';
import type { Action, EchoRecord, Level, WorldState } from './types';

/**
 * Решатель уровней. Ищет решение с минимальным числом копий: перебор «последовательностей
 * записей» с итеративным углублением по числу эхо.
 *
 * Кандидаты в эхо — состояния петли, достижимые поиском в ширину: для каждой различной
 * конфигурации мира (позиция, предметы, рычаги, ящики, хрупкий пол…) берётся самое раннее
 * прибытие, после которого копия стоит. Кандидаты фильтруются эвристикой «полезности»
 * (особые клетки — плиты, двери, лифты, лучи, зоны; изменённый мир), а при неудаче — с
 * вариантами задержки старта. Финальная петля — поиск в ширину по состояниям с тиком
 * (мемоизация по полному состоянию). Ограничения по глубине и времени.
 */

export interface SolveOptions {
  /** Максимум копий (по умолчанию — maxEchoes уровня). */
  maxEchoes?: number;
  /** Общий лимит времени, мс. */
  timeLimitMs?: number;
  /** Сколько ещё искать после первого решения, чтобы сократить тики (мс). */
  improveMs?: number;
  /** Колбэк прогресса. */
  onProgress?: (info: { depth: number; nodes: number; elapsed: number }) => void;
  /** Источник времени (в воркере и в Node — performance.now). */
  now?: () => number;
}

export interface SolveResult {
  solved: boolean;
  /** Ввод каждой петли; последняя — финальная. */
  loops: string[];
  echoes: number;
  ticks: number;
  /** Минимальность числа копий доказана полным перебором меньших глубин. */
  provenMinimal: boolean;
  nodes: number;
  timeMs: number;
  timedOut: boolean;
}

const ACTIONS: readonly Action[] = ['none', 'up', 'right', 'down', 'left', 'interact'];

interface Node {
  state: WorldState;
  inputs: string;
}

class Timeout extends Error {}

/** Есть ли в уровне то, с чем можно взаимодействовать (иначе направление взгляда не важно). */
function hasInteractables(level: Level): boolean {
  const b = level.byType;
  return b.lever.length + b.lock.length + b.socket.length > 0 || level.items.length > 0;
}

/** Клетки с меняющимся регистром (исключая производные плиты/приёмники). */
function stateCells(level: Level): number[] {
  const out: number[] = [];
  level.fixtures.forEach((f, c) => {
    if (!f) return;
    if (['lever', 'lock', 'socket', 'fragile', 'pit', 'door', 'timerDoor'].includes(f.type)) out.push(c);
  });
  return out;
}

export class Solver {
  readonly level: Level;
  private readonly interactive: boolean;
  private readonly regCells: number[];
  private readonly special: Set<number>;
  private nodes = 0;
  /** Статическое расстояние до выхода (нижняя оценка) или null, если оценка недопустима. */
  private readonly exitDist: Int32Array | null;
  /** После этого тика всё, что не зависит от игрока, неподвижно (записи эхо кончились, таймеры отработали). */
  private staticAfter = Infinity;
  private deadline = Infinity;
  private readonly now: () => number;

  constructor(level: Level, now: () => number = () => globalThis.performance.now()) {
    this.level = level;
    this.interactive = hasInteractables(level);
    this.regCells = stateCells(level);
    this.now = now;
    this.special = new Set<number>();
    const b = level.byType;
    for (const c of [...b.plate, ...b.door, ...b.lift, ...b.timerDoor, ...b.portal, ...b.conveyor])
      this.special.add(c);
    level.solidZone.forEach((z, c) => {
      if (z) this.special.add(c);
    });
    this.exitDist = b.ice.length || b.conveyor.length || b.portal.length ? null : this.distanceToExit();
  }

  private distanceToExit(): Int32Array {
    const L = this.level;
    const n = L.width * L.height;
    const dist = new Int32Array(n).fill(1 << 20);
    dist[L.exit] = 0;
    const q = [L.exit];
    for (let i = 0; i < q.length; i++) {
      const c = q[i]!;
      const x = c % L.width;
      const y = Math.floor(c / L.width);
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= L.width || ny >= L.height) continue;
        const nc = ny * L.width + nx;
        if (L.terrain[nc] !== 'floor' || dist[nc]! <= dist[c]! + 1) continue;
        dist[nc] = dist[c]! + 1;
        q.push(nc);
      }
    }
    return dist;
  }

  /** Ключ мира без акторов-эхо и тика — «что изменило эхо». */
  private worldKey(s: WorldState): string {
    let k = s.boxes.join(',') + '|';
    for (const it of s.items) k += `${it.cell}:${it.carrier}:${it.consumed ? 1 : 0},`;
    k += '|';
    for (const c of this.regCells) {
      const f = this.level.fixtures[c]!;
      if (f.type === 'door' || f.type === 'timerDoor') continue;
      k += `${s.cells[c]},`;
    }
    return k;
  }

  private setRecords(records: readonly EchoRecord[]): void {
    let t = 0;
    for (const r of records) t = Math.max(t, r.actions.length);
    for (const c of this.level.byType.timerDoor) {
      const f = this.level.fixtures[c];
      if (f?.type === 'timerDoor') t = Math.max(t, f.to + 1);
    }
    // Стражи ходят бесконечно, но их состояние уже входит в ключ.
    this.staticAfter = t;
  }

  private key(s: WorldState, withTick: boolean): string {
    let k = withTick ? `${Math.min(s.tick, this.staticAfter)}#` : '';
    for (const a of s.actors) {
      k += `${a.cell}.${a.status[0]}.${a.carrying}.${a.riding ? 1 : 0}`;
      if (this.interactive && a.kind === 'player') k += `.${a.facing}`;
      k += ';';
    }
    k += s.boxes.join(',') + '|';
    for (const it of s.items) k += `${it.cell}:${it.carrier}:${it.consumed ? 1 : 0},`;
    k += '|';
    for (const c of this.regCells) k += `${s.cells[c]},`;
    for (const g of s.guards) k += `g${g.cell}.${g.facing}.${g.routeIdx}`;
    return k;
  }

  /** Ключ кандидата: игрок, мир и статусы старших эхо — без их позиций и без тика. */
  private candKey(s: WorldState): string {
    const p = s.actors[s.actors.length - 1]!;
    let k = `${p.cell}.${p.status[0]}.${p.carrying}.${p.riding ? 1 : 0}`;
    for (let i = 0; i < s.actors.length - 1; i++) k += s.actors[i]!.status[0];
    return k + '|' + this.worldKey(s);
  }

  /**
   * Насколько копия изменила мир: 0 — никак, 1 — сдвинула ящик куда-то, 2 — переложила предмет,
   * 3 — «использовала» механизм (рычаг, гнездо, замок, хрупкий пол, яма, ящик на особой клетке).
   */
  private changeKind(s: WorldState, base: WorldState): 0 | 1 | 2 | 3 {
    for (const c of this.regCells) {
      const f = this.level.fixtures[c]!;
      if (f.type === 'door' || f.type === 'timerDoor') continue;
      if (s.cells[c] !== base.cells[c]) return 3;
    }
    for (let i = 0; i < s.items.length; i++) {
      const it = s.items[i]!;
      const b = base.items[i]!;
      if (it.consumed !== b.consumed) return 3;
    }
    let kind: 0 | 1 | 2 = 0;
    for (let i = 0; i < s.items.length; i++) {
      const it = s.items[i]!;
      if (it.carrier < 0 && it.cell !== base.items[i]!.cell) kind = 2;
    }
    for (let i = 0; i < s.boxes.length; i++) {
      const c = s.boxes[i]!;
      const b = base.boxes[i]!;
      if (c === b) continue;
      if (c < 0 || this.special.has(c) || b < 0 || this.special.has(b)) return 3;
      if (kind === 0) kind = 1;
    }
    return kind;
  }

  /** Подпись «что задействовано»: регистры механизмов, израсходованные предметы, ящики на особых клетках. */
  private useKey(s: WorldState): string {
    let k = '';
    for (const c of this.regCells) {
      const f = this.level.fixtures[c]!;
      if (f.type !== 'door' && f.type !== 'timerDoor') k += `${s.cells[c]},`;
    }
    for (const it of s.items) k += it.consumed ? 'x' : '-';
    for (const b of s.boxes) k += b < 0 || this.special.has(b) ? `${b},` : '_,';
    return k;
  }

  private tickCheck(): void {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && this.now() > this.deadline) throw new Timeout();
  }

  private expand(n: Node, out: (child: Node) => void): void {
    const p = n.state.actors[n.state.actors.length - 1]!;
    for (const a of ACTIONS) {
      if (a === 'interact' && !this.interactive) continue;
      this.tickCheck();
      const r = step(n.state, a);
      // Упор без смены взгляда = то же, что ждать.
      if (a !== 'none' && a !== 'interact' && r.performed === '.') {
        const np = r.state.actors[r.state.actors.length - 1]!;
        if (!this.interactive || np.facing === p.facing) continue;
      }
      if (a === 'interact' && r.performed === '.') continue;
      out({ state: r.state, inputs: n.inputs + INPUT_CHARS[a] });
    }
  }

  /** Финальная петля: кратчайший по тикам путь к выходу. */
  finalRun(records: readonly EchoRecord[]): Node | null {
    this.setRecords(records);
    const start: Node = { state: createLoop(this.level, records), inputs: '' };
    const seen = new Set<string>([this.key(start.state, true)]);
    let frontier: Node[] = [start];
    while (frontier.length) {
      const next: Node[] = [];
      for (const n of frontier) {
        let found: Node | null = null;
        this.expand(n, (c) => {
          if (found) return;
          if (c.state.outcome === 'won') {
            found = c;
            return;
          }
          if (c.state.outcome !== 'playing') return;
          if (this.exitDist) {
            const pc = c.state.actors[c.state.actors.length - 1]!.cell;
            if (c.state.tick + this.exitDist[pc]! > this.level.tickLimit) return;
          }
          const k = this.key(c.state, true);
          if (seen.has(k)) return;
          seen.add(k);
          next.push(c);
        });
        if (found) return found;
      }
      frontier = next;
    }
    return null;
  }

  /** Кандидаты в следующее эхо при заданных записях. */
  candidates(records: readonly EchoRecord[], wide: boolean): Node[] {
    this.setRecords(records);
    const startState = createLoop(this.level, records);
    // Опорная траектория: что было бы, если бы игрок просто ждал. С ней сравниваются изменения.
    const baseline: WorldState[] = [startState];
    while (baseline[baseline.length - 1]!.outcome === 'playing')
      baseline.push(step(baseline[baseline.length - 1]!, 'none').state);
    const baseAt = (t: number) => baseline[Math.min(t, baseline.length - 1)]!;
    // Клетки под взглядом стражей на опорной траектории — «особые»: там копия заслоняет обзор.
    const sightCells = new Set<number>();
    if (this.level.guards.length) {
      for (const b of baseline) {
        const d = toDraft(b);
        for (let gi = 0; gi < b.guards.length; gi++) for (const c of guardSight(d, gi)) sightCells.add(c);
      }
    }
    const seenT = new Set<string>([this.key(startState, true)]);
    const earliest = new Map<string, Node>();
    const beamCells = new Set<number>();
    const note = (n: Node) => {
      for (const b of n.state.beams) for (const c of b.cells) beamCells.add(c);
      const k = this.candKey(n.state);
      if (!earliest.has(k)) earliest.set(k, n);
    };
    let frontier: Node[] = [{ state: startState, inputs: '' }];
    note(frontier[0]!);
    while (frontier.length) {
      const next: Node[] = [];
      for (const n of frontier) {
        this.expand(n, (c) => {
          const k = this.key(c.state, true);
          if (seenT.has(k)) return;
          seenT.add(k);
          if (c.state.outcome === 'won') return;
          note(c);
          if (c.state.outcome === 'playing') next.push(c);
        });
      }
      frontier = next;
    }
    const scored: { n: Node; score: number }[] = [];
    const byWorld = new Set<string>();
    const lure = this.level.guards.some((g) => g.mode === 'lure');
    for (const n of earliest.values()) {
      if (!n.inputs.length) continue;
      const s = n.state;
      const p = s.actors[s.actors.length - 1]!;
      const special = this.special.has(p.cell) || beamCells.has(p.cell) || sightCells.has(p.cell);
      const change = this.changeKind(s, baseAt(s.tick));
      let score = (special ? 3 : 0) + change + (lure ? 1 : 0) - (p.carrying >= 0 ? 1 : 0);
      if (!wide) {
        if (special) {
          let w = `${p.cell}.${p.carrying >= 0 ? 1 : 0}|${this.useKey(s)}`;
          for (let i = 0; i < s.actors.length - 1; i++) w += s.actors[i]!.status[0];
          if (byWorld.has(w)) continue;
          byWorld.add(w);
        } else {
          // Вне особых клеток интересно только осмысленное изменение мира — по одному
          // кандидату на каждое такое состояние мира, где бы ни стояла копия.
          if (change < 3 || p.carrying >= 0) continue;
          let w = this.useKey(s);
          for (let i = 0; i < s.actors.length - 1; i++) w += s.actors[i]!.status[0];
          if (byWorld.has(w)) continue;
          byWorld.add(w);
        }
      }
      score -= n.inputs.length * 0.001;
      scored.push({ n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.n);
  }

  /**
   * Цепочки: копия доходит до особой клетки, ждёт несколько тиков и идёт к другой особой клетке
   * (например, держит одну плиту, пока игрок стоит в проёме, а потом переходит на другую).
   */
  private chains(base: Node[]): Node[] {
    const out: Node[] = [];
    const firsts = base
      .filter((n) => this.special.has(n.state.actors[n.state.actors.length - 1]!.cell))
      .slice(0, 8);
    for (const first of firsts) {
      const from = first.state.actors[first.state.actors.length - 1]!.cell;
      for (const w of [0, 1, 2, 3, 5]) {
        let st = first.state;
        let inputs = first.inputs;
        for (let i = 0; i < w && st.outcome === 'playing'; i++) {
          st = step(st, 'none').state;
          inputs += '.';
        }
        if (st.outcome !== 'playing') continue;
        // Поиск в ширину от середины петли: самое раннее прибытие на каждую другую особую клетку.
        const seen = new Set<string>([this.key(st, true)]);
        const got = new Set<number>([from]);
        let frontier: Node[] = [{ state: st, inputs }];
        while (frontier.length) {
          const next: Node[] = [];
          for (const n of frontier) {
            this.expand(n, (c) => {
              const k = this.key(c.state, true);
              if (seen.has(k) || c.state.outcome === 'won') return;
              seen.add(k);
              const cell = c.state.actors[c.state.actors.length - 1]!.cell;
              if (this.special.has(cell) && !got.has(cell)) {
                got.add(cell);
                out.push(c);
              }
              if (c.state.outcome === 'playing') next.push(c);
            });
          }
          frontier = next;
        }
      }
    }
    return out;
  }

  /**
   * Варианты с задержкой: ожидание вставляется в начало пути или прямо перед последним действием,
   * которое изменило мир (так находятся «придержать, а потом отпустить» и приход к сроку).
   */
  private delayed(records: readonly EchoRecord[], base: Node[], delays: readonly number[]): Node[] {
    const out: Node[] = [];
    const limit = this.level.tickLimit;
    const start = createLoop(this.level, records);
    const startUse = this.useKey(start);
    const run = (inputs: string) => {
      let s = start;
      for (const c of inputs) {
        if (s.outcome !== 'playing') break;
        s = step(s, inputToAction(c)).state;
      }
      return s;
    };
    for (const n of base) {
      const p = n.state.actors[n.state.actors.length - 1]!;
      const onSpecial = this.special.has(p.cell);
      const use = this.useKey(n.state);
      // Индекс последнего хода, после которого подпись мира изменилась, и начала «осмысленных»
      // промежуточных отрезков (механизм задействован или копия стоит на особой клетке).
      let lastChange = -1;
      const entries: number[] = [];
      let s = start;
      let prevUse = startUse;
      let wasMeaningful = false;
      for (let i = 0; i < n.inputs.length && s.outcome === 'playing'; i++) {
        s = step(s, inputToAction(n.inputs[i]!)).state;
        const u = this.useKey(s);
        if (u !== prevUse) lastChange = i;
        prevUse = u;
        const meaningful = u !== startUse || this.special.has(s.actors[s.actors.length - 1]!.cell);
        if (meaningful && !wasMeaningful && i + 1 < n.inputs.length) entries.push(i + 1);
        wasMeaningful = meaningful;
      }
      if (!onSpecial && use === startUse && !entries.length) continue;
      const positions = [...new Set([0, ...(lastChange > 0 ? [lastChange] : []), ...entries.slice(-2)])];
      // Обратное эхо проигрывает запись с конца: ожидание в конце записи — это стоянка в начале петли.
      if (this.level.reverseEchoes) positions.push(n.inputs.length);
      for (const pos of positions) {
        for (const d of delays) {
          if (n.inputs.length + d > limit) continue;
          const inputs = n.inputs.slice(0, pos) + '.'.repeat(d) + n.inputs.slice(pos);
          const r = run(inputs);
          const q = r.actors[r.actors.length - 1]!;
          if (onSpecial ? q.cell !== p.cell : this.useKey(r) !== use) continue;
          out.push({ state: r, inputs });
        }
      }
    }
    return out;
  }

  solve(opts: SolveOptions = {}): SolveResult {
    const t0 = this.now();
    const maxK = Math.min(opts.maxEchoes ?? this.level.maxEchoes, this.level.maxEchoes);
    this.deadline = t0 + (opts.timeLimitMs ?? 20000);
    this.nodes = 0;
    let best: { loops: string[]; echoes: number; ticks: number } | null = null;
    let proven = true;
    let timedOut = false;

    const tryDepth = (k: number, mode: 'narrow' | 'wide' | 'delay' | 'chain', stopAt: number): boolean => {
      const visited = new Set<string>();
      const dfs = (records: EchoRecord[], loops: string[]): boolean => {
        if (records.length === k) {
          const f = this.finalRun(records);
          if (!f) return false;
          if (!best || best.echoes > k || f.state.tick < best.ticks)
            best = { loops: [...loops, f.inputs], echoes: k, ticks: f.state.tick };
          return this.now() > stopAt;
        }
        let cands = this.candidates(records, mode === 'wide');
        if (mode === 'chain') cands = this.chains(cands);
        else if (mode !== 'narrow')
          cands = [...cands, ...this.delayed(records, cands, [1, 2, 3, 4, 6, 8, 10, 13])];
        for (const c of cands) {
          const rec = recordOf(c.state);
          const sig = [...records, rec].map((r) => `${r.actions}@${r.endCell}`).join('/');
          if (visited.has(sig)) continue;
          visited.add(sig);
          if (dfs([...records, rec], [...loops, c.inputs])) return true;
          opts.onProgress?.({ depth: k, nodes: this.nodes, elapsed: this.now() - t0 });
        }
        return false;
      };
      dfs([], []);
      return best !== null && best.echoes === k;
    };

    try {
      // Сначала узкий набор кандидатов на всех глубинах, затем с задержками, затем широкий.
      // Найдя решение с k копиями, более широкие режимы проверяют только глубины меньше k —
      // это и есть проверка минимальности.
      for (const mode of ['narrow', 'delay', 'chain', 'wide'] as const) {
        const limit = best ? (best as { echoes: number }).echoes - 1 : maxK;
        for (let k = mode === 'narrow' ? 0 : 1; k <= limit; k++) {
          if (tryDepth(k, mode, this.now() + (opts.improveMs ?? 1500))) break;
        }
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      timedOut = true;
      proven = false;
    }
    const b = best as { loops: string[]; echoes: number; ticks: number } | null;
    return {
      solved: !!b,
      loops: b?.loops ?? [],
      echoes: b?.echoes ?? -1,
      ticks: b?.ticks ?? -1,
      provenMinimal: !!b && proven && !timedOut,
      nodes: this.nodes,
      timeMs: this.now() - t0,
      timedOut,
    };
  }
}

export function solveLevel(level: Level, opts: SolveOptions = {}): SolveResult {
  return new Solver(level, opts.now).solve(opts);
}
