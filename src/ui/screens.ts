import { timeStarTicks } from '../core/session';
import type { Level } from '../core/types';
import type { SaveData, Settings } from '../data/save';
import { isLevelUnlocked, totalStars, worlds, type WorldInfo } from '../data/progress';
import { getLang, lt, t } from '../i18n';
import { BINDABLE, DEFAULT_KEYMAP, cloneKeymap, keyLabel, rebind, type Bindable } from '../input/keymap';
import { MECH_COLORS, PALETTE } from '../render/palette';
import { clear, h, icon } from './dom';
import type { Screen } from './router';

/** Что экраны могут попросить у приложения. */
export interface AppApi {
  readonly save: SaveData;
  readonly levels: readonly Level[];
  readonly customLevels: readonly Level[];
  readonly version: string;
  readonly isTouch: boolean;
  goMenu(): void;
  goWorlds(): void;
  goLevels(world: number): void;
  goSettings(fromGame: boolean): void;
  goAbout(): void;
  goEditor(): void;
  startLevel(level: Level): void;
  continueGame(): void;
  hasProgress(): boolean;
  updateSettings(patch: Partial<Settings>): void;
  resetProgress(): void;
  exportSave(): void;
  importSave(file: File): Promise<boolean>;
  toggleFullscreen(): void;
  closeOverlay(screen: Screen): void;
  uiSound(kind: 'click' | 'hover' | 'back'): void;
  unlockAudio(): void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const WORLD_ACCENT = [
  PALETTE.exit,
  PALETTE.pink,
  PALETTE.orange,
  PALETTE.cyan,
  PALETTE.paradox,
  PALETTE.violet,
];

function header(title: string, onBack: () => void, extra?: Node): HTMLElement {
  return h(
    'div.topbar',
    null,
    h(
      'button.btn.icon-only',
      { type: 'button', 'aria-label': t('menu.back'), onclick: onBack },
      icon('back'),
    ),
    h('h2', null, title),
    h('span.spacer'),
    extra ?? null,
  );
}

function starsLine(n: number, max = 3): HTMLElement {
  const el = h('span.s');
  for (let i = 0; i < max; i++) {
    const s = icon('star');
    if (i >= n) s.classList.add('off');
    el.append(s);
  }
  return el;
}

/** Базовый класс экрана с перерисовкой по языку. */
abstract class BaseScreen implements Screen {
  readonly el: HTMLElement;
  constructor(
    protected readonly app: AppApi,
    cls: string,
  ) {
    this.el = h('div.screen', { class: cls });
    this.el.hidden = true;
    this.el.addEventListener(
      'pointerenter',
      (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') app.uiSound('hover');
      },
      true,
    );
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) app.uiSound('click');
    });
  }
  abstract render(): void;
  enter(): void {
    this.render();
  }
  refresh(): void {
    this.render();
  }
}

// ————— сплэш —————

export class SplashScreen implements Screen {
  readonly el: HTMLElement;
  private done = false;
  constructor(private readonly app: AppApi) {
    this.el = h('div.screen.splash.interactive', { 'data-interactive': '1', tabindex: 0 });
    this.el.hidden = true;
    const go = () => {
      if (this.done) return;
      this.done = true;
      app.unlockAudio();
      app.goMenu();
    };
    // Слушаем окно, а не только сам экран: касание засчитывается, даже если попало в canvas.
    this.onPointer = () => go();
    this.onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') return;
      e.preventDefault();
      go();
    };
  }
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onPointer: () => void;
  enter(): void {
    this.done = false;
    clear(this.el);
    this.el.append(
      h('div.logo', { role: 'heading', 'aria-level': 1 }, t('app.title')),
      h('p.tag', null, t('app.tagline')),
      h('div.press', null, this.app.isTouch ? t('splash.tap') : t('splash.press')),
    );
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerdown', this.onPointer);
    this.pad = window.setInterval(() => {
      const pads = navigator.getGamepads?.() ?? [];
      if ([...pads].some((p) => p?.buttons.some((b) => b.pressed))) this.onKey(new KeyboardEvent('keydown'));
    }, 100);
  }
  private pad = 0;
  leave(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onPointer);
    clearInterval(this.pad);
  }
  refresh(): void {
    if (!this.el.hidden) this.enter();
  }
}

// ————— главное меню —————

export class MainMenu extends BaseScreen {
  constructor(app: AppApi) {
    super(app, 'menu');
  }
  render(): void {
    clear(this.el);
    const a = this.app;
    const list = h('div.menu-list');
    if (a.hasProgress())
      list.append(
        h(
          'button.btn.primary',
          { type: 'button', 'data-autofocus': true, onclick: () => a.continueGame() },
          icon('play'),
          t('menu.continue'),
        ),
      );
    else
      list.append(
        h(
          'button.btn.primary',
          { type: 'button', 'data-autofocus': true, onclick: () => a.continueGame() },
          icon('play'),
          t('menu.play'),
        ),
      );
    list.append(
      h('button.btn', { type: 'button', onclick: () => a.goWorlds() }, icon('grid'), t('menu.levels')),
      h('button.btn', { type: 'button', onclick: () => a.goEditor() }, icon('edit'), t('menu.editor')),
      h(
        'button.btn',
        { type: 'button', onclick: () => a.goSettings(false) },
        icon('gear'),
        t('menu.settings'),
      ),
      h('button.btn', { type: 'button', onclick: () => a.goAbout() }, icon('info'), t('menu.about')),
    );
    this.el.append(
      h('div.logo', { role: 'heading', 'aria-level': 1 }, t('app.title')),
      h('p.tag', null, t('app.tagline')),
      list,
      h(
        'div.menu-foot',
        null,
        h('span.stars-total', null, icon('star'), String(totalStars(a.save))),
        ' · v',
        a.version,
      ),
    );
  }
  back(): void {
    this.app.uiSound('back');
  }
}

// ————— карта миров —————

export class WorldMap extends BaseScreen {
  constructor(app: AppApi) {
    super(app, 'dim');
  }
  render(): void {
    clear(this.el);
    const a = this.app;
    const info = worlds(a.levels, a.save);
    const grid = h('div.worlds');
    info.forEach((w: WorldInfo, i: number) => {
      const accent = hex(WORLD_ACCENT[w.world] ?? PALETTE.echo);
      const done = w.completed;
      const total = w.levels.length;
      const card = h(
        `button.world-card${w.unlocked ? '' : '.locked'}` as 'button',
        {
          type: 'button',
          style: `--accent:${accent}`,
          'aria-disabled': w.unlocked ? null : 'true',
          onclick: () => w.unlocked && a.goLevels(w.world),
          'data-autofocus': i === lastUnlocked(info) ? true : null,
        },
        h('span.num', null, `${t('world.label').toUpperCase()} ${w.world}`),
        h('span.name', null, t(`world.${w.world}` as 'world.0')),
        h('span.desc', null, t(`world.desc.${w.world}` as 'world.desc.0')),
      );
      if (w.unlocked) {
        card.append(
          h(
            'span.meta',
            null,
            h('span', null, t('world.progress', { done, total })),
            h('span.stars-total', null, icon('star'), `${w.stars}/${w.maxStars}`),
          ),
          h('div.bar', null, h('i', { style: `width:${total ? (done / total) * 100 : 0}%` })),
        );
      } else {
        card.append(
          h(
            'span.lockmsg',
            null,
            icon('lock'),
            t('world.locked', { world: t(`world.${Math.max(0, w.world - 1)}` as 'world.0') }),
          ),
        );
      }
      grid.append(card);
    });
    const custom = h(
      'button.world-card',
      { type: 'button', style: `--accent:${hex(PALETTE.violet)}`, onclick: () => a.goLevels(-1) },
      h('span.num', null, 'EDITOR'),
      h('span.name', null, t('world.custom')),
      h('span.desc', null, t('world.desc.custom')),
      h('span.meta', null, h('span', null, String(a.customLevels.length))),
    );
    grid.append(custom);
    this.el.append(
      header(
        t('world.map'),
        () => this.back(),
        h('span.stars-total', null, icon('star'), String(totalStars(a.save))),
      ),
      h('div.scroll', { style: 'flex:1' }, grid),
    );
  }
  back(): void {
    this.app.uiSound('back');
    this.app.goMenu();
  }
}

function lastUnlocked(info: WorldInfo[]): number {
  let idx = 0;
  info.forEach((w, i) => {
    if (w.unlocked) idx = i;
  });
  return idx;
}

// ————— выбор уровня —————

export class LevelSelect extends BaseScreen {
  world = 0;
  constructor(app: AppApi) {
    super(app, 'dim');
  }
  render(): void {
    clear(this.el);
    const a = this.app;
    const custom = this.world < 0;
    const list = custom ? a.customLevels : a.levels.filter((l) => l.world === this.world);
    const mainList = list.filter((l) => !l.bonus);
    const exam = mainList[mainList.length - 1];
    const grid = h('div.level-grid');
    let focused = false;
    for (const l of list) {
      const unlocked = custom || isLevelUnlocked(a.levels, a.save, l);
      const r = a.save.levels[l.id];
      const tile = h(
        `button.level-tile${unlocked ? '' : '.locked'}${a.save.lastLevel === l.id ? '.current' : ''}` as 'button',
        {
          type: 'button',
          'aria-disabled': unlocked ? null : 'true',
          onclick: () => unlocked && a.startLevel(l),
        },
        h('span.n', null, l.bonus ? '★' : String(l.index)),
        h('span.t', null, lt(l.name)),
      );
      if (!focused && unlocked && !r?.completed) {
        tile.setAttribute('data-autofocus', '');
        focused = true;
      }
      if (l.bonus) tile.append(h('span.badge.bonus', null, t('levels.bonus')));
      else if (!custom && l === exam) tile.append(h('span.badge.exam', null, t('levels.exam')));
      if (r?.perfect) tile.append(h('span.badge', { style: 'top:auto;bottom:10px' }, t('levels.perfect')));
      if (!unlocked) {
        tile.append(
          h(
            'span.best',
            null,
            icon('lock'),
            ' ',
            l.bonus ? t('levels.needStars', { n: l.starsRequired }) : t('levels.locked'),
          ),
        );
      } else {
        tile.append(starsLine(r?.stars ?? 0));
        if (r?.completed)
          tile.append(h('span.best', null, t('levels.best', { echoes: r.bestEchoes, ticks: r.bestTicks })));
      }
      grid.append(tile);
    }
    const title = custom ? t('world.custom') : `${this.world}. ${t(`world.${this.world}` as 'world.0')}`;
    const body = list.length ? grid : h('p.muted', null, t('levels.none'));
    this.el.append(
      header(title, () => this.back(), h('span.stars-total', null, icon('star'), String(totalStars(a.save)))),
      h('div.scroll', { style: 'flex:1' }, body),
    );
  }
  back(): void {
    this.app.uiSound('back');
    this.app.goWorlds();
  }
}

// ————— пауза —————

export class PauseScreen implements Screen {
  readonly el: HTMLElement;
  readonly overlay = true;
  constructor(
    private readonly app: AppApi,
    private readonly actions: {
      resume(): void;
      restartLoop(): void;
      resetRoom(): void;
      settings(): void;
      exit(): void;
    },
  ) {
    this.el = h('div.screen.scrim.center');
    this.el.hidden = true;
  }
  enter(): void {
    clear(this.el);
    const A = this.actions;
    this.el.append(
      h(
        'div.dialog',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pause.title') },
        h('h2', null, t('pause.title')),
        h(
          'button.btn.primary',
          { type: 'button', 'data-autofocus': true, onclick: () => A.resume() },
          icon('play'),
          t('pause.resume'),
        ),
        h(
          'button.btn',
          { type: 'button', onclick: () => A.restartLoop() },
          icon('replay'),
          t('pause.restartLoop'),
        ),
        h('button.btn', { type: 'button', onclick: () => A.resetRoom() }, icon('undo'), t('pause.restart')),
        h('button.btn', { type: 'button', onclick: () => A.settings() }, icon('gear'), t('pause.settings')),
        h('button.btn.ghost', { type: 'button', onclick: () => A.exit() }, icon('back'), t('pause.exit')),
      ),
    );
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.app.uiSound('click');
    });
  }
  back(): void {
    this.actions.resume();
  }
  refresh(): void {
    if (!this.el.hidden) this.enter();
  }
}

// ————— победа —————

export interface WinView {
  level: Level;
  stars: number;
  echoes: number;
  ticks: number;
  paradoxes: number;
  perfect: boolean;
  newBest: boolean;
  isLast: boolean;
  hasNext: boolean;
  unlockedWorld: number | null;
}

export class WinScreen implements Screen {
  readonly el: HTMLElement;
  readonly overlay = true;
  data: WinView | null = null;
  private timers: number[] = [];
  constructor(
    private readonly app: AppApi,
    private readonly actions: { next(): void; replay(): void; levels(): void; star(i: number): void },
  ) {
    this.el = h('div.screen.win');
    this.el.hidden = true;
  }
  enter(): void {
    const d = this.data;
    clear(this.el);
    if (!d) return;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const stars = h('div.win-stars');
    const starEls = [0, 1, 2].map((i) => {
      const s = h(`span.star${i < d.stars ? '.on' : ''}` as 'span', null, icon('star'));
      stars.append(s);
      return s;
    });
    const A = this.actions;
    const buttons = h('div.row');
    if (d.hasNext)
      buttons.append(
        h(
          'button.btn.primary',
          { type: 'button', 'data-autofocus': true, onclick: () => A.next() },
          t('win.next'),
          icon('next'),
        ),
      );
    buttons.append(
      h(
        'button.btn',
        { type: 'button', onclick: () => A.replay(), 'data-autofocus': d.hasNext ? null : true },
        icon('replay'),
        t('win.replay'),
      ),
      h('button.btn', { type: 'button', onclick: () => A.levels() }, icon('grid'), t('win.levels')),
    );
    const dialog = h(
      'div.dialog',
      { role: 'dialog', 'aria-label': t('win.title') },
      h('h2', null, d.isLast ? t('win.final') : t('win.title')),
      h('p.muted', null, lt(d.level.name)),
      stars,
      d.perfect ? h('div.perfect', null, t('win.perfect')) : null,
      h(
        'div.stats',
        null,
        h('div.stat', null, h('b', null, String(d.echoes)), h('span', null, t('win.copies'))),
        h('div.stat', null, h('b', null, String(d.ticks)), h('span', null, t('win.ticks'))),
        h('div.stat', null, h('b', null, String(d.paradoxes)), h('span', null, t('win.paradoxes'))),
      ),
      h(
        'p.muted',
        { style: 'font-size:12px' },
        t('win.par', { echoes: d.level.par.echoes, ticks: timeStarTicks(d.level) }),
        d.newBest ? ` · ${t('win.newBest')}` : '',
      ),
      d.unlockedWorld !== null
        ? h(
            'p',
            { style: `color:${hex(MECH_COLORS[1]!)}` },
            t('win.worldUnlocked', { world: t(`world.${d.unlockedWorld}` as 'world.0') }),
          )
        : null,
      buttons,
    );
    this.el.append(dialog);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.app.uiSound('click');
    });
    starEls.forEach((s, i) => {
      this.timers.push(
        window.setTimeout(
          () => {
            s.classList.add('show');
            if (i < d.stars) A.star(i);
          },
          350 + i * 380,
        ),
      );
    });
  }
  leave(): void {
    this.timers.forEach(clearTimeout);
  }
  back(): void {
    this.actions.levels();
  }
  refresh(): void {
    if (!this.el.hidden) this.enter();
  }
}

// ————— настройки —————

export class SettingsScreen extends BaseScreen {
  fromGame = false;
  onClose: () => void = () => undefined;
  private capture: { action: Bindable; slot: number } | null = null;
  private confirmReset = false;
  constructor(app: AppApi) {
    super(app, 'scrim');
    window.addEventListener('keydown', (e) => this.captureKey(e), true);
  }

  private captureKey(e: KeyboardEvent): void {
    if (!this.capture || this.el.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, slot } = this.capture;
    this.capture = null;
    document.body.dataset.capturing = '0';
    if (e.code !== 'Escape')
      this.app.updateSettings({ keymap: rebind(this.app.save.settings.keymap, action, slot, e.code) });
    this.render();
  }

  render(): void {
    const s = this.app.save.settings;
    const up = (p: Partial<Settings>) => {
      this.app.updateSettings(p);
      this.render();
    };
    const scrollTop = this.el.querySelector('.scroll')?.scrollTop ?? 0;
    clear(this.el);
    const toggle = (label: string, value: boolean, key: keyof Settings) =>
      h(
        'div.setting',
        null,
        h('span.lbl', { id: `lbl-${key}` }, label),
        h('button.toggle', {
          type: 'button',
          role: 'switch',
          'aria-checked': String(value),
          'aria-labelledby': `lbl-${key}`,
          onclick: () => up({ [key]: !value } as Partial<Settings>),
        }),
      );
    const slider = (label: string, value: number, key: 'volumeMaster' | 'volumeMusic' | 'volumeSfx') => {
      const input = h('input', {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value,
        'aria-label': label,
        id: `rng-${key}`,
      });
      input.addEventListener('input', () => this.app.updateSettings({ [key]: Number(input.value) }));
      return h('div.setting', null, h('label', { for: `rng-${key}` }, label), input);
    };
    const seg = <T extends string>(label: string, value: T, options: [T, string][], apply: (v: T) => void) =>
      h(
        'div.setting',
        null,
        h('span.lbl', null, label),
        h(
          'div.seg',
          { role: 'group', 'aria-label': label },
          ...options.map(([v, text]) =>
            h(
              'button',
              { type: 'button', 'aria-pressed': String(v === value), onclick: () => apply(v) },
              text,
            ),
          ),
        ),
      );

    const keys = h('div.keys-grid.panel');
    for (const b of BINDABLE) {
      keys.append(h('span', null, t(`action.${b}` as 'action.up')));
      for (let slot = 0; slot < 2; slot++) {
        const code = s.keymap[b]?.[slot];
        const cap = this.capture?.action === b && this.capture.slot === slot;
        keys.append(
          h(
            `button.keybtn${cap ? '.capture' : ''}` as 'button',
            {
              type: 'button',
              onclick: () => {
                this.capture = { action: b, slot };
                document.body.dataset.capturing = '1';
                this.render();
              },
            },
            cap ? t('settings.pressKey') : code ? keyLabel(code) : '—',
          ),
        );
      }
    }

    const reset = this.confirmReset
      ? h(
          'div.setting',
          { role: 'alertdialog', 'aria-label': t('settings.resetConfirm') },
          h('span.lbl', { style: 'color:var(--paradox)' }, t('settings.resetConfirm')),
          h(
            'div.confirm-inline',
            null,
            h(
              'button.btn.danger',
              {
                type: 'button',
                onclick: () => {
                  this.app.resetProgress();
                  this.confirmReset = false;
                  this.render();
                },
              },
              t('settings.yes'),
            ),
            h(
              'button.btn',
              {
                type: 'button',
                'data-autofocus': true,
                onclick: () => {
                  this.confirmReset = false;
                  this.render();
                },
              },
              t('settings.no'),
            ),
          ),
        )
      : h(
          'div.setting',
          null,
          h('span.lbl', null, t('settings.resetProgress')),
          h(
            'button.btn.danger',
            {
              type: 'button',
              onclick: () => {
                this.confirmReset = true;
                this.render();
              },
            },
            t('settings.resetProgress'),
          ),
        );

    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void this.app.importSave(f).then(() => this.render());
    });

    const body = h(
      'div.settings-body',
      null,
      h(
        'div.settings-group',
        null,
        h('h3', null, t('settings.audio')),
        slider(t('settings.master'), s.volumeMaster, 'volumeMaster'),
        slider(t('settings.music'), s.volumeMusic, 'volumeMusic'),
        slider(t('settings.sfx'), s.volumeSfx, 'volumeSfx'),
      ),
      h(
        'div.settings-group',
        null,
        h('h3', null, t('settings.gameplay')),
        seg(
          t('settings.tickSpeed'),
          s.tickSpeed,
          [
            ['slow', t('settings.slow')],
            ['normal', t('settings.normal')],
            ['fast', t('settings.fast')],
          ],
          (v) => up({ tickSpeed: v }),
        ),
        seg(
          t('settings.language'),
          getLang(),
          [
            ['ru', 'Русский'],
            ['en', 'English'],
          ],
          (v) => up({ language: v }),
        ),
        toggle(t('settings.dpad'), s.dpad, 'dpad'),
        toggle(t('settings.vibration'), s.vibration, 'vibration'),
      ),
      h(
        'div.settings-group',
        null,
        h('h3', null, t('settings.graphics')),
        seg(
          t('settings.quality'),
          s.quality,
          [
            ['auto', t('settings.auto')],
            ['low', t('settings.low')],
            ['medium', t('settings.medium')],
            ['high', t('settings.high')],
          ],
          (v) => up({ quality: v }),
        ),
        toggle(t('settings.perspective'), s.perspective, 'perspective'),
        toggle(t('settings.freeCamera'), s.freeCamera, 'freeCamera'),
        h(
          'div.setting',
          null,
          h('span.lbl', null, t('settings.fullscreen')),
          h(
            'button.btn',
            { type: 'button', onclick: () => this.app.toggleFullscreen() },
            icon('fullscreen'),
            t('settings.fullscreen'),
          ),
        ),
      ),
      h(
        'div.settings-group',
        null,
        h('h3', null, t('settings.accessibility')),
        toggle(t('settings.reducedMotion'), s.reducedMotion, 'reducedMotion'),
        toggle(t('settings.colorblind'), s.colorblind, 'colorblind'),
        toggle(t('settings.shake'), s.screenShake, 'screenShake'),
      ),
      h(
        'div.settings-group',
        null,
        h('h3', null, t('settings.controls')),
        keys,
        h(
          'div',
          null,
          h(
            'button.btn',
            { type: 'button', onclick: () => up({ keymap: cloneKeymap(DEFAULT_KEYMAP) }) },
            t('settings.resetKeys'),
          ),
        ),
      ),
      h(
        'div.settings-group',
        null,
        h('h3', null, t('settings.data')),
        h(
          'div.setting',
          null,
          h('span.lbl', null, t('settings.data')),
          h(
            'div.confirm-inline',
            null,
            h('button.btn', { type: 'button', onclick: () => this.app.exportSave() }, t('settings.export')),
            h('button.btn', { type: 'button', onclick: () => fileInput.click() }, t('settings.import')),
            fileInput,
          ),
        ),
        reset,
      ),
    );
    const scroll = h('div.scroll', { style: 'flex:1' }, body);
    this.el.append(
      header(t('settings.title'), () => this.back()),
      scroll,
    );
    scroll.scrollTop = scrollTop;
  }

  back(): void {
    if (this.capture) return;
    this.confirmReset = false;
    this.app.uiSound('back');
    this.onClose();
  }
}

// ————— об игре —————

export class AboutScreen extends BaseScreen {
  constructor(app: AppApi) {
    super(app, 'scrim');
  }
  render(): void {
    clear(this.el);
    this.el.append(
      header(t('about.title'), () => this.back()),
      h(
        'div.scroll',
        { style: 'flex:1' },
        h(
          'div.about-body',
          null,
          h('div.logo', { style: 'font-size:72px' }, t('app.title')),
          h('p', null, t('about.body')),
          h('h3', null, t('about.controls')),
          h('p.muted', null, t('about.pc')),
          h('p.muted', null, t('about.touch')),
          h('p.muted', null, t('about.pad')),
          h('p.muted', { style: 'font-size:12px' }, t('about.credits')),
          h('p.muted', { style: 'font-size:12px' }, t('about.version', { v: this.app.version })),
          h(
            'div',
            null,
            h(
              'button.btn',
              { type: 'button', 'data-autofocus': true, onclick: () => this.back() },
              icon('back'),
              t('menu.back'),
            ),
          ),
        ),
      ),
    );
  }
  back(): void {
    this.app.uiSound('back');
    this.app.goMenu();
  }
}
