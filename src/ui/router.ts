import type { MenuNav } from '../input/input';

export interface Screen {
  readonly el: HTMLElement;
  /** Экран-наложение (пауза, победа, диалог): рисуется поверх базового. */
  readonly overlay?: boolean;
  enter?(): void;
  leave?(): void;
  /** Esc / кнопка B. */
  back?(): void;
  /** Перерисовать тексты при смене языка. */
  refresh?(): void;
  /** Не ставить фокус на первый элемент (игровой HUD). */
  readonly noAutoFocus?: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/** Роутер экранов: один базовый экран и стопка наложений, анимированные переходы. */
export class Router {
  private base: Screen | null = null;
  private readonly stack: Screen[] = [];
  private readonly root: HTMLElement;
  /** Экраны, которые должны быть видны (защита от гонки анимаций при медленных кадрах). */
  private readonly showing = new Set<Screen>();

  constructor(root: HTMLElement) {
    this.root = root;
    window.addEventListener('keydown', (e) => this.keyNav(e));
  }

  get top(): Screen | null {
    return this.stack[this.stack.length - 1] ?? this.base;
  }

  get current(): Screen | null {
    return this.base;
  }

  /** Сменить базовый экран (наложения закрываются). */
  go(screen: Screen): void {
    while (this.stack.length) this.hide(this.stack.pop()!);
    if (this.base === screen) {
      screen.refresh?.();
      return;
    }
    if (this.base) this.hide(this.base);
    this.base = screen;
    this.show(screen);
  }

  push(screen: Screen): void {
    if (this.stack.includes(screen)) return;
    this.stack.push(screen);
    this.show(screen);
  }

  pop(screen?: Screen): void {
    const s = screen ?? this.stack[this.stack.length - 1];
    if (!s) return;
    const i = this.stack.indexOf(s);
    if (i < 0) return;
    this.stack.splice(i, 1);
    this.hide(s);
    this.focusFirst(this.top);
  }

  has(screen: Screen): boolean {
    return this.stack.includes(screen) || this.base === screen;
  }

  refreshAll(): void {
    this.base?.refresh?.();
    this.stack.forEach((s) => s.refresh?.());
  }

  private show(s: Screen): void {
    if (!s.el.isConnected) this.root.append(s.el);
    this.showing.add(s);
    s.el.hidden = false;
    s.el.classList.remove('shown');
    s.enter?.();
    // Кадр задержки, чтобы сработал CSS-переход.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.showing.has(s)) s.el.classList.add('shown');
      }),
    );
    setTimeout(() => this.focusFirst(s), 60);
  }

  private hide(s: Screen): void {
    this.showing.delete(s);
    s.el.classList.remove('shown');
    s.leave?.();
    setTimeout(() => {
      if (!this.showing.has(s)) s.el.hidden = true;
    }, 340);
  }

  private focusFirst(s: Screen | null): void {
    if (!s) return;
    if (s.noAutoFocus) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    const preferred = s.el.querySelector<HTMLElement>('[data-autofocus]');
    const el = preferred ?? s.el.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus({ preventScroll: true });
  }

  /** Навигация в меню стрелками, геймпадом: ближайший элемент в направлении. */
  nav(dir: MenuNav): void {
    const top = this.top;
    if (!top) return;
    if (dir === 'back') {
      top.back?.();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (dir === 'accept') {
      if (active && top.el.contains(active)) active.click();
      return;
    }
    const items = [...top.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null);
    if (!items.length) return;
    if (!active || !top.el.contains(active)) {
      items[0]!.focus();
      return;
    }
    if (
      active instanceof HTMLInputElement &&
      active.type === 'range' &&
      (dir === 'left' || dir === 'right')
    ) {
      const step = Number(active.step || 0.05);
      active.value = String(Number(active.value) + (dir === 'right' ? step : -step));
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const a = active.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === active) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - ax;
      const dy = y - ay;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 2) continue;
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      best.focus();
      best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  private keyNav(e: KeyboardEvent): void {
    if (document.body.dataset.gameplay === '1' && !this.stack.length) return;
    if (document.body.dataset.capturing === '1') return;
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
    if (t?.tagName === 'TEXTAREA') return;
    const map: Record<string, MenuNav> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const dir = map[e.code];
    if (dir) {
      if (t instanceof HTMLInputElement && t.type === 'range') return;
      e.preventDefault();
      this.nav(dir);
    } else if (e.code === 'Escape') {
      e.preventDefault();
      this.nav('back');
    }
  }
}
