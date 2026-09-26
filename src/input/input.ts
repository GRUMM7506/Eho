import type { OrbitCamera } from '../camera/orbit';
import { swipeToScreenDir, type ScreenDir } from '../camera/relative';
import { actionForCode, DEFAULT_KEYMAP, cloneKeymap, type Bindable, type KeyMap } from './keymap';

export type Command = Exclude<Bindable, 'up' | 'down' | 'left' | 'right'> | 'restart';

/** Одно действие, взятое из буфера на тик: экранное направление, взаимодействие или ожидание. */
export type ScreenAction = ScreenDir | 'interact' | 'wait';

export type MenuNav = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back';

export interface StickState {
  /** Центр (точка касания) и текущее положение пальца, в пикселях экрана. */
  x0: number;
  y0: number;
  x: number;
  y: number;
  dir: ScreenDir | null;
}

/** Мёртвая зона джойстика в пикселях: ближе к центру — стоим. */
export const STICK_DEAD = 18;

const DIR_OF: Partial<Record<Bindable, ScreenDir>> = { up: 'up', down: 'down', left: 'left', right: 'right' };

/**
 * Единая точка ввода: клавиатура, мышь, тач-жесты, экранный D-pad и геймпад.
 * Нажатия между тиками копятся в буфере и не теряются; удержание даёт ход каждый тик.
 * Направления здесь экранные — в сеточные их переводит игровой цикл по углу камеры.
 */
export class InputHub {
  keymap: KeyMap = cloneKeymap(DEFAULT_KEYMAP);
  /** Игровой ввод включён (экран игры). */
  gameplay = false;
  onCommand: (cmd: Command) => void = () => undefined;
  onMenuNav: (nav: MenuNav) => void = () => undefined;
  /** Любое взаимодействие пользователя (для разблокировки звука, скрытия подсказок). */
  onAnyInput: (kind: 'keyboard' | 'touch' | 'mouse' | 'gamepad') => void = () => undefined;
  /** Кнопки вместо свайпов: одиночный палец не шагает. */
  dpadMode = false;
  /** Плавающий джойстик для пальца: центр — точка касания, направление держится, пока палец отведён. */
  stickMode = true;
  /** Состояние джойстика для отрисовки (null — скрыт). */
  onStick: (s: StickState | null) => void = () => undefined;
  lastDevice: 'keyboard' | 'touch' | 'mouse' | 'gamepad' = 'keyboard';

  private readonly queue: ScreenAction[] = [];
  private readonly heldKeys: ScreenDir[] = [];
  private heldPointer: ScreenDir | null = null;
  private heldPad: ScreenDir | null = null;
  private heldButtons: ScreenDir | null = null;
  private orbit: OrbitCamera | null = null;
  private canvas: HTMLElement | null = null;
  private readonly pointers = new Map<
    number,
    { x: number; y: number; x0: number; y0: number; t0: number; type: string; button: number; fired: boolean }
  >();
  private camGesture = false;
  private lastPinch = 0;
  private lastAngle = 0;
  private lastCentroid = { x: 0, y: 0 };
  private lastMoveTime = 0;
  private padPrev: boolean[] = [];
  private padNavCooldown = 0;
  private readonly cleanups: (() => void)[] = [];

  attach(canvas: HTMLElement, orbit: OrbitCamera): void {
    this.canvas = canvas;
    this.orbit = orbit;
    const on = <K extends keyof WindowEventMap>(
      t: EventTarget,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e) => this.keyDown(e));
    on(window, 'keyup', (e) => this.keyUp(e));
    on(window, 'blur', () => this.releaseAll());
    on(canvas, 'pointerdown', (e) => this.pointerDown(e));
    on(canvas, 'pointermove', (e) => this.pointerMove(e));
    on(canvas, 'pointerup', (e) => this.pointerUp(e));
    on(canvas, 'pointercancel', (e) => this.pointerUp(e));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => this.wheel(e), { passive: false });
  }

  detach(): void {
    this.cleanups.splice(0).forEach((f) => f());
  }

  // ————— буфер действий —————

  /** Есть ли что делать прямо сейчас (для старта петли). */
  hasPending(): boolean {
    return this.queue.length > 0 || this.held() !== null;
  }

  /** Взять действие на тик: сперва буфер нажатий, затем удерживаемое направление. */
  take(): ScreenAction | null {
    const q = this.queue.shift();
    if (q) return q;
    return this.held();
  }

  private held(): ScreenDir | null {
    return (
      this.heldButtons ?? this.heldPad ?? this.heldPointer ?? this.heldKeys[this.heldKeys.length - 1] ?? null
    );
  }

  clear(): void {
    this.queue.length = 0;
  }

  releaseAll(): void {
    this.heldKeys.length = 0;
    this.heldPointer = null;
    this.heldPad = null;
    this.heldButtons = null;
    this.onStick(null);
  }

  private enqueue(a: ScreenAction): void {
    if (this.queue.length < 3) this.queue.push(a);
  }

  /** Экранные кнопки D-pad / действия. */
  pressButton(a: ScreenAction): void {
    if (!this.gameplay) return;
    this.enqueue(a);
    if (a !== 'interact' && a !== 'wait') this.heldButtons = a;
  }

  releaseButton(a: ScreenAction): void {
    if (this.heldButtons === a) this.heldButtons = null;
  }

  // ————— клавиатура —————

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    )
      return;
    if (document.body.dataset.capturing === '1') return;
    this.lastDevice = 'keyboard';
    this.onAnyInput('keyboard');
    const act = actionForCode(this.keymap, e.code);
    // В меню клавиатурой управляет роутер экранов.
    if (!this.gameplay) return;
    if (!act) return;
    const onButton = target?.tagName === 'BUTTON';
    const dir = DIR_OF[act];
    if (dir) {
      e.preventDefault();
      if (!this.heldKeys.includes(dir)) this.heldKeys.push(dir);
      if (!e.repeat) this.enqueue(dir);
      return;
    }
    if ((act === 'interact' || act === 'next') && onButton && (e.code === 'Space' || e.code === 'Enter'))
      return;
    if (e.repeat && act !== 'rewind') return;
    e.preventDefault();
    if (act === 'interact') this.enqueue('interact');
    else if (act === 'wait') this.enqueue('wait');
    else this.onCommand(act as Command);
  }

  private keyUp(e: KeyboardEvent): void {
    const act = actionForCode(this.keymap, e.code);
    const dir = act ? DIR_OF[act] : undefined;
    if (!dir) return;
    const i = this.heldKeys.indexOf(dir);
    if (i >= 0) this.heldKeys.splice(i, 1);
  }

  // ————— указатель: мышь и тач —————

  private pointerDown(e: PointerEvent): void {
    this.canvas?.setPointerCapture?.(e.pointerId);
    const kind = e.pointerType === 'touch' ? 'touch' : 'mouse';
    this.lastDevice = kind;
    this.onAnyInput(kind);
    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      x0: e.clientX,
      y0: e.clientY,
      t0: performance.now(),
      type: e.pointerType,
      button: e.button,
      fired: false,
    });
    this.lastMoveTime = performance.now();
    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (touches.length >= 2) {
      // Второй палец — жест камеры, шаг отменяется.
      this.heldPointer = null;
      this.camGesture = true;
      this.orbit?.beginDrag();
      const [a, b] = touches as [(typeof touches)[0], (typeof touches)[0]];
      this.lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.lastAngle = Math.atan2(b.y - a.y, b.x - a.x);
      this.lastCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.onStick(null);
    } else if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1)) {
      this.orbit?.beginDrag();
    } else if (this.useStick(e.pointerType)) {
      this.onStick({ x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dir: null });
    }
  }

  private useStick(type: string): boolean {
    return type === 'touch' && this.stickMode && this.gameplay && !this.dpadMode;
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const now = performance.now();
    const dt = Math.max(0.001, (now - this.lastMoveTime) / 1000);
    this.lastMoveTime = now;
    const orbit = this.orbit;
    if (!orbit) return;
    if (p.type === 'mouse') {
      if (p.button === 2) {
        orbit.rotateBy(-dx * 0.35, dy * 0.25, dt);
        return;
      }
      if (p.button === 1) {
        orbit.panBy(dx, dy);
        return;
      }
    }
    const touches = [...this.pointers.values()].filter((q) => q.type === 'touch');
    if (this.camGesture && touches.length >= 2) {
      const [a, b] = touches as [(typeof touches)[0], (typeof touches)[0]];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (this.lastPinch > 0) orbit.zoomBy(this.lastPinch / Math.max(1, dist));
      let dAng = ang - this.lastAngle;
      if (dAng > Math.PI) dAng -= Math.PI * 2;
      if (dAng < -Math.PI) dAng += Math.PI * 2;
      orbit.rotateBy(
        -(cx - this.lastCentroid.x) * 0.3 - (dAng * 180) / Math.PI,
        (cy - this.lastCentroid.y) * 0.25,
        dt,
      );
      this.lastPinch = dist;
      this.lastAngle = ang;
      this.lastCentroid = { x: cx, y: cy };
      return;
    }
    // Один палец / левая кнопка мыши — свайп-шаг.
    if (!this.gameplay || this.dpadMode) return;
    if (this.useStick(p.type)) {
      this.stickMove(p);
      return;
    }
    const tx = p.x - p.x0;
    const ty = p.y - p.y0;
    const threshold = p.type === 'touch' ? 22 : 30;
    if (Math.hypot(tx, ty) < threshold) return;
    // Направление — по тому, как плитки лежат на экране при текущем угле камеры.
    const dir = swipeToScreenDir(tx, ty, orbit.inputYaw, orbit.pitch);
    if (!p.fired || dir !== this.heldPointer) {
      this.enqueue(dir);
      this.heldPointer = dir;
      p.fired = true;
      // Новая точка отсчёта: смена направления без отрыва пальца.
      p.x0 = p.x;
      p.y0 = p.y;
    }
  }

  /** Джойстик: центр не сдвигается, направление — куда отведён палец; в мёртвой зоне — стоим. */
  private stickMove(p: { x: number; y: number; x0: number; y0: number; fired: boolean }): void {
    const orbit = this.orbit!;
    const tx = p.x - p.x0;
    const ty = p.y - p.y0;
    let dir: ScreenDir | null = null;
    if (Math.hypot(tx, ty) >= STICK_DEAD) dir = swipeToScreenDir(tx, ty, orbit.inputYaw, orbit.pitch);
    if (dir && dir !== this.heldPointer) {
      this.enqueue(dir);
      p.fired = true;
    }
    this.heldPointer = dir;
    this.onStick({ x0: p.x0, y0: p.y0, x: p.x, y: p.y, dir });
  }

  private pointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    if (p.type === 'mouse' && (p.button === 2 || p.button === 1)) {
      this.orbit?.endDrag();
      return;
    }
    if (this.camGesture) {
      if (![...this.pointers.values()].some((q) => q.type === 'touch')) {
        this.camGesture = false;
        this.orbit?.endDrag();
      }
      return;
    }
    this.heldPointer = null;
    this.onStick(null);
    const dur = performance.now() - p.t0;
    if (this.gameplay && !p.fired && dur < 350 && Math.hypot(p.x - p.x0, p.y - p.y0) < 14) {
      this.enqueue('wait');
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.onAnyInput('mouse');
    this.orbit?.zoomBy(Math.exp(e.deltaY * 0.0012));
  }

  // ————— геймпад —————

  /** Опрос геймпада раз в кадр. */
  pollGamepad(dt: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p): p is Gamepad => !!p && p.connected);
    if (!pad) {
      this.heldPad = null;
      return;
    }
    const b = pad.buttons.map((x) => x.pressed);
    const edge = (i: number) => !!b[i] && !this.padPrev[i];
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    let dir: ScreenDir | null = null;
    if (b[12]) dir = 'up';
    else if (b[13]) dir = 'down';
    else if (b[14]) dir = 'left';
    else if (b[15]) dir = 'right';
    else if (Math.hypot(ax, ay) > 0.55)
      dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up';
    const anyPressed = b.some(Boolean) || dir !== null;
    if (anyPressed) {
      this.lastDevice = 'gamepad';
      this.onAnyInput('gamepad');
    }
    if (this.gameplay) {
      if (dir && dir !== this.heldPad) this.enqueue(dir);
      this.heldPad = dir;
      if (edge(0)) this.enqueue('interact');
      if (edge(2)) this.onCommand('record');
      if (edge(3)) this.onCommand('undoEcho');
      if (edge(1)) this.onCommand('rewind');
      if (edge(9)) this.onCommand('pause');
      if (edge(8)) this.onCommand('trails');
      if (edge(4)) this.onCommand('camLeft');
      if (edge(5)) this.onCommand('camRight');
      if (edge(10) || edge(11)) this.onCommand('camReset');
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (this.orbit && Math.hypot(rx, ry) > 0.2) {
        this.orbit.beginDrag();
        this.orbit.rotateBy(-rx * 140 * dt, ry * 90 * dt, dt);
      } else if (this.orbit && this.padPrevStick) {
        this.orbit.endDrag();
      }
      this.padPrevStick = Math.hypot(rx, ry) > 0.2;
    } else {
      this.heldPad = null;
      this.padNavCooldown -= dt;
      if (dir && this.padNavCooldown <= 0) {
        this.onMenuNav(dir);
        this.padNavCooldown = 0.22;
      }
      if (!dir) this.padNavCooldown = 0;
      if (edge(0)) this.onMenuNav('accept');
      if (edge(1)) this.onMenuNav('back');
      if (edge(9)) this.onMenuNav('back');
    }
    this.padPrev = b;
  }

  private padPrevStick = false;
}
