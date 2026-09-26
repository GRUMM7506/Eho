import { screenActionToGrid } from '../camera/relative';
import {
  advance,
  canRecord,
  current,
  newSession,
  recordEcho,
  resetRoom,
  restartLoop,
  rewind,
  undoEcho,
  type Session,
} from '../core/session';
import { inputToAction } from '../core/sim';
import type { Action, Level, SimEvent, WorldState } from '../core/types';
import type { InputHub, ScreenAction } from '../input/input';
import type { GameView } from '../render/gameView';

export type LoopEndKind = 'recorded' | 'restarted' | 'full';

export interface WinInfo {
  echoes: number;
  ticks: number;
  paradoxes: number;
  loops: string[];
}

export interface ControllerEvents {
  /** События тика (звук, эффекты, HUD). */
  onTick(prev: WorldState, next: WorldState, events: readonly SimEvent[]): void;
  /** Снимок сменился без тика (новая петля, перемотка, сброс). */
  onReset(
    state: WorldState,
    reason: 'load' | 'record' | 'undo' | 'rewind' | 'reset' | 'restart' | 'timeout',
  ): void;
  onWin(info: WinInfo): void;
  onDeath(state: WorldState): void;
  onLoopEnd(kind: LoopEndKind): void;
  onLoopStart(): void;
}

/** Длительность тика по уровню скорости (мс). */
export const TICK_MS = { slow: 230, normal: 170, fast: 115 } as const;
export type TickSpeed = keyof typeof TICK_MS;

/**
 * Игровой цикл: фиксированный шаг симуляции и интерполяция рендера.
 * Петля «стоит», пока игрок не сделает первый ход; дальше тики идут в реальном времени.
 */
export class GameController {
  session: Session;
  tickMs: number = TICK_MS.normal;
  paused = false;
  private running = false;
  private acc = 0;
  private animAcc = 0;
  private endLock = 0;
  private won = false;

  constructor(
    private readonly view: GameView,
    private readonly input: InputHub,
    private readonly events: ControllerEvents,
    level: Level,
  ) {
    this.session = newSession(level);
  }

  get state(): WorldState {
    return current(this.session);
  }

  get level(): Level {
    return this.session.level;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isWon(): boolean {
    return this.won;
  }

  /** Доля текущего тика для интерполяции. */
  get tickProgress(): number {
    return Math.min(1, this.animAcc / this.tickMs);
  }

  load(level: Level, keepSession?: Session): void {
    this.session = keepSession ?? newSession(level);
    this.running = false;
    this.won = false;
    this.acc = 0;
    this.animAcc = this.tickMs;
    this.input.clear();
    this.view.setLevel(level, this.state);
    this.events.onReset(this.state, 'load');
  }

  /** Кадр игры. */
  frame(dt: number): void {
    this.input.pollGamepad(dt);
    const ms = dt * 1000;
    this.animAcc += ms;
    if (this.endLock > 0) this.endLock -= ms;
    if (!this.paused && !this.won && this.endLock <= 0) {
      if (!this.running) {
        if (this.input.hasPending() && this.state.outcome === 'playing') {
          this.running = true;
          this.acc = 0;
          this.events.onLoopStart();
          this.doTick();
        }
      } else {
        this.acc += ms;
        // Не больше двух тиков за кадр, чтобы не «проматывать» после подвисания.
        let n = 0;
        while (this.acc >= this.tickMs && this.running && n < 2) {
          this.acc -= this.tickMs;
          this.doTick();
          n++;
        }
        if (n === 2) this.acc = Math.min(this.acc, this.tickMs);
      }
    }
    const alpha = Math.min(1, this.animAcc / this.tickMs);
    this.view.render(dt, alpha);
  }

  /** Отладка: выполнить тики с заданным вводом немедленно (строка . U R D L E, сеточные направления). */
  debugRun(inputs: string): void {
    for (const c of inputs) {
      if (this.state.outcome !== 'playing') break;
      this.forced = c;
      this.running = true;
      this.doTick();
    }
    this.forced = null;
  }

  private forced: string | null = null;

  private toAction(a: ScreenAction | null): Action {
    if (this.forced !== null) return inputToAction(this.forced);
    if (!a || a === 'wait') return 'none';
    if (a === 'interact') return 'interact';
    // Экранное направление → сеточное по углу камеры, до записи в симуляцию.
    return screenActionToGrid(a, this.view.orbit.inputYaw);
  }

  private doTick(): void {
    const prev = this.state;
    const action = this.toAction(this.forced !== null ? null : this.input.take());
    const r = advance(this.session, action);
    this.session = r.session;
    const next = this.state;
    this.animAcc = 0;
    this.view.setTick(prev, next, r.events);
    this.events.onTick(prev, next, r.events);
    switch (next.outcome) {
      case 'won':
        this.running = false;
        this.won = true;
        this.events.onWin({
          echoes: this.session.records.length,
          ticks: next.tick,
          paradoxes: this.session.paradoxes,
          loops: [...this.session.echoInputs, this.session.inputs],
        });
        break;
      case 'dead':
        this.running = false;
        this.input.clear();
        this.input.releaseAll();
        this.events.onDeath(next);
        break;
      case 'timeout':
        this.running = false;
        this.input.clear();
        this.endLock = this.tickMs * 2;
        if (canRecord(this.session)) {
          this.session = recordEcho(this.session);
          this.events.onLoopEnd('recorded');
          this.events.onReset(this.state, 'timeout');
        } else {
          this.session = restartLoop(this.session);
          this.events.onLoopEnd('full');
          this.events.onReset(this.state, 'timeout');
        }
        this.view.setState(this.state, true);
        break;
      default:
        break;
    }
  }

  // ————— команды —————

  /** Записать эхо сейчас. */
  record(): boolean {
    if (this.won || !canRecord(this.session)) return false;
    this.session = recordEcho(this.session);
    this.afterReset('record');
    this.events.onLoopEnd('recorded');
    return true;
  }

  undoEcho(): boolean {
    if (!this.session.records.length && this.state.tick === 0) return false;
    this.session = undoEcho(this.session);
    this.won = false;
    this.afterReset('undo');
    return true;
  }

  rewind(): boolean {
    if (this.session.history.length <= 1) return false;
    this.session = rewind(this.session);
    this.won = false;
    this.afterReset('rewind');
    return true;
  }

  resetRoom(): void {
    this.session = resetRoom(this.session);
    this.won = false;
    this.afterReset('reset');
  }

  restartLoop(): void {
    this.session = restartLoop(this.session);
    this.won = false;
    this.afterReset('restart');
  }

  private afterReset(reason: 'record' | 'undo' | 'rewind' | 'reset' | 'restart'): void {
    this.running = false;
    this.acc = 0;
    this.animAcc = this.tickMs;
    this.input.clear();
    this.view.setState(
      this.state,
      reason === 'record' || reason === 'undo' || reason === 'reset' || reason === 'restart',
    );
    this.events.onReset(this.state, reason);
  }

  get canRecord(): boolean {
    return canRecord(this.session);
  }
}
