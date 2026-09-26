import type { Insets } from '../camera/orbit';
import { dpadRotation } from '../camera/relative';
import type { Hint, Level, WorldState } from '../core/types';
import type { Prediction } from '../game/predict';
import { getLang, lt, t } from '../i18n';
import type { ScreenAction } from '../input/input';
import { keyLabel, type Bindable, type KeyMap } from '../input/keymap';
import { MECH_COLORS } from '../render/palette';
import { clear, h, icon } from './dom';
import type { Screen } from './router';

export interface HudCallbacks {
  pause(): void;
  rewind(): void;
  record(): void;
  undo(): void;
  hint(): void;
  trails(): void;
  camLeft(): void;
  camRight(): void;
  camReset(): void;
  restartLoop(): void;
  press(a: ScreenAction): void;
  release(a: ScreenAction): void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Игровой HUD: заголовок, таймлайн петли, слоты эхо, кнопки, компас, подсказки, тосты. */
export class Hud implements Screen {
  readonly el: HTMLElement;
  readonly noAutoFocus = true;
  private readonly title = h('div.hud-title');
  private readonly clock = h('span.clock');
  private readonly loopLabel = h('span');
  private readonly fill = h('div.tl-fill');
  private readonly track = h('div.tl-track');
  private readonly lanes = h('div.tl-lanes');
  private readonly dots = h('div.dots');
  private readonly needle = h('div.needle');
  private readonly hintBubble = h('div.hint-bubble.panel.hide');
  private readonly startMsg = h('div.start-msg');
  private readonly toasts = h('div.toasts');
  private readonly deathBox = h('div.death.panel');
  private readonly topBar: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly touchPad: HTMLElement;
  private readonly dpad: HTMLElement;
  private dpadRot = 0;
  private readonly buttons = new Map<string, HTMLButtonElement[]>();
  private keymap: KeyMap;
  private touch = false;
  private level: Level | null = null;
  private tickMs = 170;
  private hintShown: Hint | null = null;
  private lastHintKey = '';

  constructor(
    private readonly cb: HudCallbacks,
    keymap: KeyMap,
  ) {
    this.keymap = keymap;
    const btn = (
      action: string,
      ico: Parameters<typeof icon>[0],
      label: string,
      key: Bindable | null,
      onClick: () => void,
      cls = '',
    ) => {
      const b = h(
        `button.btn${cls}` as 'button',
        {
          type: 'button',
          'aria-label': label,
          title: label,
          'data-action': action,
          onclick: (e: Event) => {
            onClick();
            (e.currentTarget as HTMLElement).blur();
          },
        },
        icon(ico),
      );
      if (key) b.append(h('kbd.kbd', { 'data-key': key }, ''));
      const list = this.buttons.get(action) ?? [];
      list.push(b);
      this.buttons.set(action, list);
      return b;
    };

    // Верх: название, таймлайн, слоты и пауза.
    this.track.append(h('div.tl-ticks'), this.fill);
    const timeline = h(
      'div.timeline.panel',
      null,
      h('div.row', null, this.loopLabel, this.clock),
      this.track,
      this.lanes,
    );
    const slots = h('div.slots.panel', null, h('span.label', null, ''), this.dots);
    const pauseBtn = btn('pause', 'pause', t('hud.pause'), null, () => cb.pause(), '.icon-only');
    this.topBar = h('div.hud-top', null, this.title, timeline, h('div.hud-right', null, slots, pauseBtn));

    // Низ (ПК): действия и камера.
    const actions = h(
      'div.hud-actions',
      null,
      btn('rewind', 'rewind', t('hud.rewind'), 'rewind', () => cb.rewind()),
      btn('record', 'record', t('hud.record'), 'record', () => cb.record()),
      btn('undoEcho', 'undo', t('hud.undo'), 'undoEcho', () => cb.undo()),
      btn('hint', 'hint', t('hud.hint'), 'hint', () => cb.hint()),
      btn('trails', 'trails', t('hud.trails'), 'trails', () => cb.trails()),
    );
    const compass = h(
      'div.compass.panel',
      { role: 'button', tabindex: 0, 'aria-label': t('hud.compass'), onclick: () => cb.camReset() },
      this.needle,
    );
    const cam = h(
      'div.hud-cam',
      null,
      btn('camLeft', 'camLeft', t('hud.camLeft'), 'camLeft', () => cb.camLeft()),
      compass,
      btn('camRight', 'camRight', t('hud.camRight'), 'camRight', () => cb.camRight()),
    );
    this.bottom = h('div.hud-bottom', null, actions, cam);

    // Тач: D-pad и крупные кнопки.
    const dirBtn = (d: 'up' | 'down' | 'left' | 'right') => {
      const b = h('button', { type: 'button', 'aria-label': t(`action.${d}`) }, icon(d));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        cb.press(d);
      });
      const up = () => {
        b.classList.remove('down');
        cb.release(d);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      return b;
    };
    this.dpad = h(
      'div.dpad',
      null,
      h('span'),
      dirBtn('up'),
      h('span'),
      dirBtn('left'),
      h('span'),
      dirBtn('right'),
      h('span'),
      dirBtn('down'),
      h('span'),
    );
    const tbtn = (action: string, ico: Parameters<typeof icon>[0], label: string, fn: () => void) => {
      const b = btn(action, ico, label, null, fn);
      b.append(h('span', null, label.split(' ')[0]!));
      return b;
    };
    const touchActions = h(
      'div.touch-actions',
      null,
      tbtn('hint', 'hint', t('hud.hint'), () => cb.hint()),
      tbtn('undoEcho', 'undo', t('hud.undo'), () => cb.undo()),
      tbtn('record', 'record', t('hud.record'), () => cb.record()),
      tbtn('rewind', 'rewind', t('hud.rewind'), () => cb.rewind()),
      tbtn('wait', 'wait', t('hud.wait'), () => cb.press('wait')),
      tbtn('interact', 'hand', t('hud.use'), () => cb.press('interact')),
    );
    this.touchPad = h('div.touch-pad', null, this.dpad, touchActions);

    this.deathBox.hidden = true;
    this.el = h(
      'div.screen.hud',
      null,
      this.topBar,
      this.bottom,
      this.touchPad,
      this.startMsg,
      this.hintBubble,
      this.deathBox,
      this.toasts,
    );
    this.refreshKeys();
  }

  setKeymap(k: KeyMap): void {
    this.keymap = k;
    this.refreshKeys();
  }

  keyText(b: Bindable): string {
    return keyLabel(this.keymap[b]?.[0] ?? '?');
  }

  private refreshKeys(): void {
    this.el.querySelectorAll<HTMLElement>('kbd[data-key]').forEach((k) => {
      k.textContent = this.keyText(k.dataset.key as Bindable);
    });
  }

  setTouch(touch: boolean, dpad: boolean): void {
    this.touch = touch;
    document.body.classList.toggle('touch', touch);
    this.dpad.hidden = !dpad;
  }

  setTickMs(ms: number): void {
    this.tickMs = ms;
  }

  /** Новый уровень. */
  setLevel(level: Level): void {
    this.level = level;
    clear(this.title);
    const world =
      level.world >= 0 && level.world <= 5 ? t(`world.${level.world}` as 'world.0') : t('world.custom');
    this.title.append(
      h('span.w', null, `${world} · ${level.bonus ? t('levels.bonus') : level.index}`),
      h('span.n', null, lt(level.name)),
    );
    this.track.style.setProperty('--tick', `${100 / level.tickLimit}%`);
    (this.el.querySelector('.slots .label') as HTMLElement).textContent = t('hud.echoes');
    this.hideDeath();
    this.lastHintKey = '';
  }

  /** Обновление каждый кадр/тик. */
  update(
    s: WorldState,
    echoes: number,
    loop: number,
    running: boolean,
    progress: number,
    canRecord: boolean,
    yaw: number,
    inputYaw = yaw,
  ): void {
    const L = s.level;
    const tick = Math.min(L.tickLimit, s.tick - 1 + (running || s.tick > 0 ? progress : 1));
    const p = Math.max(0, tick) / L.tickLimit;
    this.fill.style.width = `${Math.min(100, p * 100)}%`;
    const remain = ((L.tickLimit - s.tick) * this.tickMs) / 1000;
    this.clock.textContent = `${remain.toFixed(1)} ${getLang() === 'ru' ? 'с' : 's'}`;
    this.clock.classList.toggle('low', running && remain <= 3);
    this.loopLabel.textContent = t('hud.loop', { n: loop });
    // Слоты эхо.
    if (this.dots.childElementCount !== L.maxEchoes) {
      clear(this.dots);
      for (let i = 0; i < L.maxEchoes; i++) this.dots.append(h('i'));
    }
    [...this.dots.children].forEach((d, i) => {
      const actor = s.actors[i];
      d.classList.toggle('on', i < echoes);
      d.classList.toggle('broken', i < echoes && actor?.kind === 'echo' && actor.status === 'broken');
    });
    this.needle.style.transform = `rotate(${yaw}deg)`;
    // При диагональной камере крестовина встаёт «ромбом» — стрелки вдоль плиток.
    const rot = dpadRotation(inputYaw);
    if (rot !== this.dpadRot) {
      this.dpadRot = rot;
      this.dpad.style.transform = rot ? `rotate(${rot}deg) scale(0.8)` : '';
    }
    this.startMsg.textContent = this.touch ? t('hud.startTouch') : t('hud.start');
    this.startMsg.hidden = running || s.tick > 0 || s.outcome !== 'playing';
    for (const b of this.buttons.get('record') ?? []) b.classList.toggle('disabled', !canRecord);
    for (const b of this.buttons.get('rewind') ?? []) b.classList.toggle('disabled', s.tick === 0);
  }

  /** Метки копий на таймлайне из прогноза петли. */
  setPrediction(pred: Prediction | null, echoes: number): void {
    clear(this.lanes);
    if (!pred || !this.level || !echoes) return;
    const L = this.level;
    for (let e = 0; e < echoes; e++) {
      const lane = h('div.tl-lane', { title: t('hud.echoN', { n: e + 1 }) });
      for (const m of pred.markers) {
        if (m.echo !== e) continue;
        const fx = m.kind === 'plate' ? L.fixtures[pred.cells[m.tick - pred.from]?.[e] ?? -1] : null;
        const color =
          m.kind === 'paradox' ? '' : fx && fx.type === 'plate' ? hex(MECH_COLORS[fx.color]!) : '#8C9EFF';
        const dot = h(`i${m.kind === 'paradox' ? '.paradox' : ''}` as 'i', {
          style: `left:${(m.tick / L.tickLimit) * 100}%;${color ? `--c:${color}` : ''}`,
        });
        lane.append(dot);
      }
      this.lanes.append(lane);
    }
  }

  /** Подсказка: текст, клавиши, подсветка кнопок. */
  setHint(hint: Hint | null): void {
    const key = hint ? JSON.stringify(hint.text) : '';
    if (key === this.lastHintKey) return;
    this.lastHintKey = key;
    this.hintShown = hint;
    this.el.querySelectorAll('.hinted').forEach((e) => e.classList.remove('hinted'));
    if (!hint) {
      this.hintBubble.classList.add('hide');
      return;
    }
    clear(this.hintBubble);
    const text = this.touch && hint.touch ? lt(hint.touch) : lt(hint.text);
    this.hintBubble.append(h('span', null, text));
    if (hint.keys?.length && !this.touch) {
      const keys = h('span.keys');
      for (const k of hint.keys) {
        const b = k as Bindable;
        if (this.keymap[b]) keys.append(h('span.kbd.hot', null, this.keyText(b)));
      }
      this.hintBubble.append(keys);
    }
    for (const k of hint.keys ?? []) for (const b of this.buttons.get(k) ?? []) b.classList.add('hinted');
    this.hintBubble.classList.remove('hide');
  }

  get currentHint(): Hint | null {
    return this.hintShown;
  }

  toast(text: string, kind: '' | 'hot' | 'good' = '', ms = 2200): void {
    const el = h(`div.toast${kind ? `.${kind}` : ''}` as 'div', null, text);
    this.toasts.append(el);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, ms);
  }

  showDeath(cause: 'laser' | 'guard' | null): void {
    clear(this.deathBox);
    this.deathBox.append(
      h('h2', null, cause === 'guard' ? t('death.guard') : t('death.laser')),
      h('p.muted', null, t('death.hint', { rewind: this.keyText('rewind'), record: this.keyText('record') })),
      h(
        'div.row',
        null,
        h(
          'button.btn',
          { type: 'button', onclick: () => this.cb.rewind() },
          icon('rewind'),
          t('death.rewind'),
        ),
        h('button.btn', { type: 'button', onclick: () => this.cb.record() }, icon('record'), t('hud.record')),
        h(
          'button.btn',
          { type: 'button', onclick: () => this.cb.restartLoop() },
          icon('replay'),
          t('death.restart'),
        ),
      ),
    );
    this.deathBox.hidden = false;
  }

  hideDeath(): void {
    this.deathBox.hidden = true;
  }

  flash(action: string): void {
    for (const b of this.buttons.get(action) ?? []) {
      b.classList.remove('flash');
      void b.offsetWidth;
      b.classList.add('flash');
    }
  }

  setActive(action: string, on: boolean): void {
    for (const b of this.buttons.get(action) ?? []) b.classList.toggle('active', on);
  }

  /** Сколько места занимает HUD — камера вписывает уровень в остаток. */
  insets(): Insets {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const top = this.topBar.getBoundingClientRect().bottom + 6;
    let bottom = 0;
    let left = 0;
    let right = 0;
    if (this.touch) {
      const r = this.touchPad.getBoundingClientRect();
      const landscape = vw > vh;
      if (landscape) {
        const d = this.dpad.hidden ? null : this.dpad.getBoundingClientRect();
        if (d) left = d.right + 6;
        const actions = this.touchPad.querySelector('.touch-actions')!.getBoundingClientRect();
        right = vw - actions.left + 6;
      } else if (r.height) bottom = vh - r.top + 6;
    } else {
      const r = this.bottom.getBoundingClientRect();
      if (r.height) bottom = vh - r.top + 6;
    }
    return { top: Math.min(top, vh * 0.35), bottom: Math.min(bottom, vh * 0.4), left, right };
  }

  back(): void {
    this.cb.pause();
  }
}
