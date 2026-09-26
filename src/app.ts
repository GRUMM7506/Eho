import pkg from '../package.json';
import type { AudioApi, SfxName } from './audio';
import { WebAudioEngine } from './audio/engine';
import { createLoop, step, inputToAction } from './core/sim';
import { isPerfect, starsFor } from './core/session';
import type { Hint, Level, SimEvent, WorldState } from './core/types';
import { loadBuiltinLevels, loadCustomLevels } from './data/levels';
import { createMenuScene, type MenuScene } from './data/menuRoom';
import { continueLevel, nextLevel, worlds } from './data/progress';
import { defaultSave, defaultSettings, loadSave, recordResult, writeSave, type SaveData, type Settings } from './data/save';
import { storage } from './data/storage';
import { GameController, TICK_MS, type WinInfo } from './game/controller';
import { predict } from './game/predict';
import { detectLang, lt, setLang, t } from './i18n';
import { InputHub, type Command } from './input/input';
import { Effects } from './render/effects';
import { GameView, type Quality, type ViewSettings } from './render/gameView';
import { vibrate } from './ui/dom';
import { Hud } from './ui/hud';
import { Router, type Screen } from './ui/router';
import { AboutScreen, LevelSelect, MainMenu, PauseScreen, SettingsScreen, SplashScreen, WinScreen, WorldMap, type AppApi } from './ui/screens';

type Mode = 'menu' | 'game';

export interface AppHooks {
  /** Эффекты поверх рендера (частицы и пр.), подключаются на этапе полировки. */
  onEvents?(app: App, prev: WorldState, next: WorldState, events: readonly SimEvent[]): void;
  onLoopRecorded?(app: App): void;
  onWin?(app: App): void;
  onParadox?(app: App): void;
}

export class App implements AppApi {
  readonly version = pkg.version;
  save: SaveData;
  levels: Level[];
  customLevels: Level[] = [];
  readonly isTouch: boolean;
  readonly view: GameView;
  readonly effects: Effects;
  readonly input = new InputHub();
  readonly router: Router;
  readonly hud: Hud;
  audio: AudioApi = new WebAudioEngine();
  hooks: AppHooks = {};
  private mode: Mode = 'menu';
  private controller: GameController | null = null;
  private menuScene: MenuScene | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly screens: {
    splash: SplashScreen;
    menu: MainMenu;
    worlds: WorldMap;
    levels: LevelSelect;
    pause: PauseScreen;
    win: WinScreen;
    settings: SettingsScreen;
    about: AboutScreen;
  };
  private hintOpen = false;
  private replay: { state: WorldState; inputs: string; acc: number; hold: number; records: WorldState['records'] } | null = null;
  private lastFrame = performance.now();
  private resolvedQuality: Quality = 'high';
  private fps = { frames: 0, time: 0, low: 0 };
  private lastWin: WinInfo | null = null;
  private editorScreen: Screen | null = null;

  constructor(root: HTMLElement) {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const defaults = defaultSettings({
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      language: detectLang(),
      touch: this.isTouch,
    });
    this.save = loadSave(storage, defaults);
    setLang(this.save.settings.language);
    this.levels = loadBuiltinLevels();
    this.customLevels = loadCustomLevels(this.save.customLevels);

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'stage';
    this.canvas.setAttribute('aria-label', t('app.title'));
    this.canvas.tabIndex = -1;
    const ui = document.createElement('div');
    ui.id = 'ui';
    root.append(this.canvas, ui);

    this.resolvedQuality = this.resolveQuality(this.save.settings.quality);
    this.view = new GameView(this.canvas, this.viewSettings());
    this.effects = new Effects(this.view);
    this.input.attach(this.canvas, this.view.orbit);
    this.router = new Router(ui);
    this.hud = new Hud(
      {
        pause: () => this.pause(),
        rewind: () => this.command('rewind'),
        record: () => this.command('record'),
        undo: () => this.command('undoEcho'),
        hint: () => this.command('hint'),
        trails: () => this.command('trails'),
        camLeft: () => this.command('camLeft'),
        camRight: () => this.command('camRight'),
        camReset: () => this.command('camReset'),
        restartLoop: () => this.command('restart'),
        press: (a) => this.input.pressButton(a),
        release: (a) => this.input.releaseButton(a),
      },
      this.save.settings.keymap,
    );
    this.hud.el.hidden = true;
    ui.append(this.hud.el);
    this.screens = {
      splash: new SplashScreen(this),
      menu: new MainMenu(this),
      worlds: new WorldMap(this),
      levels: new LevelSelect(this),
      pause: new PauseScreen(this, {
        resume: () => this.resume(),
        restartLoop: () => {
          this.resume();
          this.command('restart');
        },
        resetRoom: () => {
          this.resume();
          this.controller?.resetRoom();
        },
        settings: () => this.goSettings(true),
        exit: () => this.exitToMenu(),
      }),
      win: new WinScreen(this, {
        next: () => this.nextFromWin(),
        replay: () => this.replayLevel(),
        levels: () => this.levelsFromWin(),
        star: (i) => {
          this.audio.play('star', 0, 0.8 + i * 0.1);
          vibrate(30, this.save.settings.vibration);
        },
      }),
      settings: new SettingsScreen(this),
      about: new AboutScreen(this),
    };

    this.input.onCommand = (c) => this.command(c);
    this.input.onMenuNav = (nav) => {
      document.body.classList.add('using-pad');
      this.router.nav(nav);
    };
    this.input.onAnyInput = (kind) => {
      if (kind !== 'gamepad') this.audio.unlock();
      if (kind !== 'gamepad') document.body.classList.remove('using-pad');
      const touch = kind === 'touch' || (this.isTouch && kind !== 'keyboard' && kind !== 'mouse' && kind !== 'gamepad');
      if (touch !== document.body.classList.contains('touch')) {
        this.hud.setTouch(touch, this.save.settings.dpad);
        this.onResize();
      }
    };

    this.applySettings();
    window.addEventListener('resize', () => this.onResize());
    window.visualViewport?.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onBackground();
      else this.audio.resume();
    });
    window.addEventListener('blur', () => this.onBackground());
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.onResize(), 50));
  }

  // ————— запуск —————

  start(): void {
    this.enterMenuScene();
    this.router.go(this.screens.splash);
    this.onResize();
    requestAnimationFrame((now) => this.loop(now));
  }

  private loop(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (!document.hidden) {
      this.frame(dt);
      this.monitorFps(dt);
    }
    requestAnimationFrame((n) => this.loop(n));
  }

  private frame(dt: number): void {
    if (this.mode === 'menu') {
      this.input.pollGamepad(dt);
      const r = this.menuScene?.frame(dt);
      if (r) {
        if (r.next.tick === 0) this.view.setState(r.next);
        else this.view.setTick(r.prev, r.next, r.events);
      }
      this.view.render(dt, Math.min(1, this.menuAlpha += dt / 0.32));
      if (r) this.menuAlpha = 0;
      return;
    }
    const c = this.controller;
    if (!c) return;
    if (this.replay) {
      this.input.pollGamepad(dt);
      this.frameReplay(dt);
      return;
    }
    c.frame(dt);
    this.hud.update(c.state, c.session.records.length, c.session.loops, c.isRunning, c.tickProgress, c.canRecord, this.view.orbit.yaw);
    this.updateHint();
  }

  private menuAlpha = 1;

  // ————— настройки —————

  private resolveQuality(q: Settings['quality']): Quality {
    const forced = new URLSearchParams(location.search).get('q');
    if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
    if (q !== 'auto') return q;
    const mobile = this.isTouch || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    return mobile ? 'medium' : 'high';
  }

  private viewSettings(): ViewSettings {
    const s = this.save.settings;
    return {
      quality: this.resolvedQuality,
      colorblind: s.colorblind,
      reducedMotion: s.reducedMotion,
      perspective: s.perspective,
      freeCamera: s.freeCamera,
      isMobile: this.isTouch,
    };
  }

  private applySettings(): void {
    const s = this.save.settings;
    setLang(s.language);
    this.input.keymap = s.keymap;
    this.input.dpadMode = s.dpad;
    this.hud.setKeymap(s.keymap);
    this.hud.setTouch(document.body.classList.contains('touch') || (this.isTouch && !matchMedia('(pointer: fine)').matches), s.dpad);
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    const prevColorblind = this.view.viewSettings.colorblind;
    this.view.applySettings(this.viewSettings());
    this.effects.configure(this.resolvedQuality, s.reducedMotion);
    const tick = TICK_MS[s.tickSpeed];
    this.hud.setTickMs(tick);
    if (this.controller) this.controller.tickMs = tick;
    this.audio.setVolumes(s.volumeMaster, s.volumeMusic, s.volumeSfx);
    // Режим дальтоников меняет модели — пересобрать уровень.
    if (prevColorblind !== s.colorblind) this.rebuildLevelView();
    this.router.refreshAll();
    this.onResize();
  }

  private rebuildLevelView(): void {
    if (this.mode === 'game' && this.controller) {
      this.view.setLevel(this.controller.level, this.controller.state);
      this.onLoopReset();
    } else if (this.menuScene) this.view.setLevel(this.menuScene.level, this.menuScene.state);
  }

  updateSettings(patch: Partial<Settings>): void {
    const qualityChanged = patch.quality !== undefined && patch.quality !== this.save.settings.quality;
    Object.assign(this.save.settings, patch);
    if (qualityChanged) this.resolvedQuality = this.resolveQuality(this.save.settings.quality);
    this.persist();
    this.applySettings();
  }

  private persist(): void {
    writeSave(storage, this.save);
  }

  private monitorFps(dt: number): void {
    if (this.save.settings.quality !== 'auto' || this.resolvedQuality === 'low') return;
    this.fps.frames++;
    this.fps.time += dt;
    if (this.fps.time < 3) return;
    const fps = this.fps.frames / this.fps.time;
    this.fps.frames = 0;
    this.fps.time = 0;
    this.fps.low = fps < 45 ? this.fps.low + 1 : 0;
    if (this.fps.low >= 2) {
      this.fps.low = 0;
      this.resolvedQuality = this.resolvedQuality === 'high' ? 'medium' : 'low';
      this.view.applySettings(this.viewSettings());
      this.rebuildLevelView();
    }
  }

  onResize(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const insets =
      this.mode === 'game'
        ? this.hud.insets()
        : w > 700
          ? { top: 0, right: 0, bottom: 0, left: Math.min(w * 0.42, 460) }
          : { top: hgt * 0.45, right: 0, bottom: 0, left: 0 };
    this.view.resize(w, hgt, insets);
  }

  // ————— навигация (AppApi) —————

  private enterMenuScene(): void {
    this.mode = 'menu';
    this.controller = null;
    this.replay = null;
    this.hud.el.hidden = true;
    this.input.gameplay = false;
    document.body.dataset.gameplay = '0';
    this.menuScene ??= createMenuScene();
    const s = this.menuScene.reset();
    this.view.setLevel(this.menuScene.level, s);
    this.view.orbit.orbitSpeed = this.save.settings.reducedMotion ? 0 : 5;
    this.view.orbit.userZoom = 0.95;
    this.audio.setWorld(-1);
    this.audio.setLayers(3);
    this.onResize();
  }

  goMenu(): void {
    if (this.mode !== 'menu') this.enterMenuScene();
    this.router.go(this.screens.menu);
    this.onResize();
  }

  goWorlds(): void {
    if (this.mode !== 'menu') this.enterMenuScene();
    this.router.go(this.screens.worlds);
  }

  goLevels(world: number): void {
    if (this.mode !== 'menu') this.enterMenuScene();
    this.screens.levels.world = world;
    this.router.go(this.screens.levels);
  }

  goSettings(fromGame: boolean): void {
    const s = this.screens.settings;
    s.fromGame = fromGame;
    if (fromGame) {
      s.onClose = () => this.router.pop(s);
      this.router.push(s);
    } else {
      s.onClose = () => this.goMenu();
      this.router.go(s);
    }
  }

  goAbout(): void {
    this.router.go(this.screens.about);
  }

  goEditor(): void {
    void import('./editor/editor').then(({ createEditorScreen }) => {
      this.editorScreen ??= createEditorScreen(this);
      if (this.mode !== 'menu') this.enterMenuScene();
      this.router.go(this.editorScreen);
    });
  }

  hasProgress(): boolean {
    return Object.keys(this.save.levels).length > 0;
  }

  continueGame(): void {
    const l = continueLevel(this.levels, this.save);
    if (l) this.startLevel(l);
  }

  toggleFullscreen(): void {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || d.webkitFullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
      d.webkitExitFullscreen?.();
    } else {
      const p = el.requestFullscreen?.({ navigationUI: 'hide' });
      if (p) {
        void p
          .then(() => {
            const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
            if (this.isTouch) void o.lock?.('landscape').catch(() => undefined);
          })
          .catch(() => undefined);
      } else el.webkitRequestFullscreen?.();
    }
  }

  resetProgress(): void {
    const settings = this.save.settings;
    this.save = { ...defaultSave(settings), customLevels: this.save.customLevels };
    this.persist();
    this.router.refreshAll();
  }

  exportSave(): void {
    const blob = new Blob([JSON.stringify(this.save, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `echo-save-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importSave(file: File): Promise<boolean> {
    try {
      const text = await file.text();
      const kv = { get: () => text, set: () => undefined, remove: () => undefined };
      const data = loadSave(kv, this.save.settings);
      this.save = data;
      this.customLevels = loadCustomLevels(this.save.customLevels);
      this.persist();
      this.applySettings();
      return true;
    } catch {
      return false;
    }
  }

  closeOverlay(screen: Screen): void {
    this.router.pop(screen);
  }

  uiSound(kind: 'click' | 'hover' | 'back'): void {
    this.audio.play(kind);
  }

  unlockAudio(): void {
    this.audio.unlock();
  }

  /** Пользовательские уровни изменились (редактор). */
  setCustomLevels(raw: SaveData['customLevels']): void {
    this.save.customLevels = raw;
    this.customLevels = loadCustomLevels(raw);
    this.persist();
  }

  // ————— игра —————

  startLevel(level: Level, testPlay = false): void {
    this.mode = 'game';
    this.menuScene = this.menuScene ?? null;
    this.replay = null;
    this.hintOpen = false;
    this.testPlay = testPlay;
    this.view.orbit.orbitSpeed = 0;
    const c = new GameController(
      this.view,
      this.input,
      {
        onTick: (prev, next, events) => this.onTick(prev, next, events),
        onReset: (_s, reason) => this.onLoopReset(reason),
        onWin: (info) => this.onWin(info),
        onDeath: (s) => this.onDeath(s),
        onLoopEnd: (kind) => {
          if (kind === 'recorded') {
            this.hud.toast(t('toast.recorded', { n: c.session.records.length }), 'good');
            this.audio.play('record');
            this.hooks.onLoopRecorded?.(this);
          } else if (kind === 'full') this.hud.toast(t('toast.full', { key: this.hud.keyText('undoEcho') }), 'hot', 3200);
          this.audio.setLayers(c.session.records.length);
        },
        onLoopStart: () => this.audio.play('loopStart'),
      },
      level,
    );
    c.tickMs = TICK_MS[this.save.settings.tickSpeed];
    this.controller = c;
    this.router.go(this.hud);
    this.hud.el.hidden = false;
    this.hud.setLevel(level);
    this.input.gameplay = true;
    document.body.dataset.gameplay = '1';
    c.load(level);
    this.audio.setWorld(level.world);
    this.audio.setLayers(0);
    if (!testPlay) {
      this.save.lastLevel = level.id;
      this.persist();
    }
    requestAnimationFrame(() => this.onResize());
  }

  private testPlay = false;
  onTestPlayExit: (() => void) | null = null;

  get game(): GameController | null {
    return this.controller;
  }

  private command(c: Command): void {
    const ctl = this.controller;
    if (this.mode !== 'game' || !ctl) return;
    if (this.replay && c !== 'pause') return;
    switch (c) {
      case 'pause':
        this.pause();
        break;
      case 'record':
        if (ctl.state.tick === 0) this.hud.toast(t('toast.cantRecord'));
        else if (!ctl.record()) this.hud.toast(t('toast.noSlots'), 'hot');
        this.hud.flash('record');
        break;
      case 'undoEcho':
        if (ctl.undoEcho()) {
          this.hud.toast(t('toast.undo'));
          this.audio.play('rewind');
          this.audio.setLayers(ctl.session.records.length);
        }
        this.hud.flash('undoEcho');
        break;
      case 'rewind':
        if (ctl.rewind()) this.audio.play('rewind', 0, 0.6);
        this.hud.flash('rewind');
        break;
      case 'restart':
        ctl.restartLoop();
        this.hud.toast(t('toast.restart'));
        break;
      case 'hint':
        this.hintOpen = !this.hintOpen;
        this.hud.setActive('hint', this.hintOpen);
        if (this.hintOpen && !this.pickHint()) this.hud.toast(t('hud.noHint'));
        break;
      case 'trails':
        this.updateSettings({ trails: !this.save.settings.trails });
        this.hud.setActive('trails', this.save.settings.trails);
        this.onLoopReset();
        break;
      case 'camLeft':
        this.view.orbit.turn(-1);
        break;
      case 'camRight':
        this.view.orbit.turn(1);
        break;
      case 'camReset':
        this.view.orbit.reset();
        break;
      default:
        break;
    }
  }

  private pause(): void {
    if (this.mode !== 'game' || !this.controller || this.router.has(this.screens.pause) || this.router.has(this.screens.win)) return;
    this.controller.paused = true;
    this.input.gameplay = false;
    this.input.releaseAll();
    this.audio.setDucked(true);
    this.router.push(this.screens.pause);
  }

  private resume(): void {
    if (!this.controller) return;
    this.router.pop(this.screens.settings);
    this.router.pop(this.screens.pause);
    this.controller.paused = false;
    this.input.gameplay = true;
    this.audio.setDucked(false);
  }

  private onBackground(): void {
    this.input.releaseAll();
    if (this.mode === 'game' && this.controller && !this.controller.isWon && !this.replay) this.pause();
    this.audio.suspend();
  }

  exitToMenu(): void {
    this.router.pop(this.screens.pause);
    if (this.testPlay && this.onTestPlayExit) {
      const f = this.onTestPlayExit;
      this.onTestPlayExit = null;
      this.enterMenuScene();
      f();
      return;
    }
    this.goLevelsOf(this.controller?.level ?? null);
  }

  private goLevelsOf(level: Level | null): void {
    this.enterMenuScene();
    if (level && level.world >= 0 && level.world <= 5 && !this.testPlay) this.goLevels(level.world);
    else if (level && this.customLevels.some((l) => l.id === level.id)) this.goLevels(-1);
    else this.goMenu();
  }

  /** Новая петля/перемотка: прогноз, траектории, призраки, подсказка. */
  private onLoopReset(reason?: string): void {
    const c = this.controller;
    if (!c) return;
    this.hud.hideDeath();
    const s = c.state;
    const start = s.tick === 0 ? s : createLoop(c.level, s.records);
    const pred = predict(start);
    this.hud.setPrediction(pred, s.records.length);
    const lv = this.view.level;
    if (lv) {
      const paths = s.records.map((_, e) => pred.cells.map((row) => row[e]!));
      const broken = s.records.map((_, e) => pred.markers.some((m) => m.echo === e && m.kind === 'paradox'));
      lv.setTrails(this.save.settings.trails ? paths : null, broken);
      this.updateGhosts(s);
    }
    this.hud.setActive('trails', this.save.settings.trails);
    if (reason === 'reset') this.hud.toast(t('toast.reset'));
    if (reason === 'record' || reason === 'timeout') this.effects.vhs(0.5);
  }

  private updateGhosts(s: WorldState): void {
    const lv = this.view.level;
    if (!lv) return;
    if (!this.save.settings.trails || !s.records.length || s.outcome !== 'playing') {
      lv.setGhosts(null);
      return;
    }
    let f = s;
    for (let i = 0; i < 3 && f.outcome === 'playing'; i++) f = step(f, inputToAction('.')).state;
    lv.setGhosts(f.actors.slice(0, -1).map((a) => a.cell));
  }

  private onTick(prev: WorldState, next: WorldState, events: readonly SimEvent[]): void {
    this.updateGhosts(next);
    const pan = (cell: number) => {
      const lv = this.view.level;
      if (!lv) return 0;
      const p = this.view.project(lv.cellPos(cell));
      return Math.max(-1, Math.min(1, (p.x / window.innerWidth) * 2 - 1));
    };
    const pi = next.actors.length - 1;
    for (const e of events) {
      const sfx = eventSound(e, pi);
      if (sfx) this.audio.play(sfx.name, 'cell' in e ? pan(e.cell) : 0, sfx.gain);
      if (e.type === 'paradox') {
        this.hud.toast(t('toast.paradox', { n: e.actor + 1 }), 'hot');
        vibrate([40, 30, 60], this.save.settings.vibration);
        if (this.save.settings.screenShake) this.view.orbit.shake(0.12);
        this.view.post.aberration = 1;
        this.view.post.glitch = 0.9;
        this.hooks.onParadox?.(this);
      }
      if (e.type === 'death' && this.save.settings.screenShake) this.view.orbit.shake(0.2);
    }
    const remain = next.level.tickLimit - next.tick;
    const tickMs = this.controller?.tickMs ?? 170;
    if (next.outcome === 'playing' && remain * tickMs <= 3000 && remain > 0) this.audio.play('tick', 0, 0.5);
    this.effects.onEvents(prev, next, events);
    this.hooks.onEvents?.(this, prev, next, events);
  }

  private onDeath(s: WorldState): void {
    this.hud.showDeath(s.deathCause);
    vibrate([80, 40, 80], this.save.settings.vibration);
  }

  // ————— подсказки —————

  private pickHint(): Hint | null {
    const c = this.controller;
    if (!c) return null;
    const s = c.state;
    const echoes = s.records.length;
    for (const h of c.level.hints) {
      if (h.minEchoes !== undefined && echoes < h.minEchoes) continue;
      if (h.maxEchoes !== undefined && echoes > h.maxEchoes) continue;
      if (h.afterTick !== undefined && s.tick < h.afterTick) continue;
      return h;
    }
    return null;
  }

  private updateHint(): void {
    const c = this.controller;
    if (!c) return;
    const auto = c.level.world === 0;
    const hint = (auto || this.hintOpen) && !c.isWon ? this.pickHint() : null;
    this.hud.setHint(hint);
    this.view.level?.setHintArrow(hint?.arrow ?? null);
  }

  // ————— победа и повтор —————

  private onWin(info: WinInfo): void {
    const c = this.controller;
    if (!c) return;
    const level = c.level;
    this.lastWin = info;
    this.hud.setHint(null);
    this.view.level?.setHintArrow(null);
    const stars = starsFor(level, info.echoes, info.ticks);
    const perfect = isPerfect(level, info.echoes, info.ticks);
    const before = worlds(this.levels, this.save).map((w) => w.unlocked);
    let newBest = false;
    if (!this.testPlay) {
      newBest = recordResult(this.save, level.id, stars, info.echoes, info.ticks, perfect);
      this.persist();
    }
    const after = worlds(this.levels, this.save).map((w) => w.unlocked);
    const unlockedWorld = after.findIndex((u, i) => u && !before[i]);
    const next = this.testPlay ? null : nextLevel(this.levels, this.save, level);
    const isBuiltin = this.levels.includes(level);
    this.screens.win.data = {
      level,
      stars,
      echoes: info.echoes,
      ticks: info.ticks,
      paradoxes: info.paradoxes,
      perfect,
      newBest,
      isLast: isBuiltin && !next && level.world === 5,
      hasNext: !!next,
      unlockedWorld: unlockedWorld >= 0 ? unlockedWorld : null,
    };
    this.audio.play('win');
    vibrate([30, 40, 30, 40, 120], this.save.settings.vibration);
    this.hooks.onWin?.(this);
    this.input.gameplay = false;
    setTimeout(() => {
      if (this.controller !== c) return;
      this.router.push(this.screens.win);
      this.startReplay(info);
    }, 900);
  }

  /** Повтор решения в ускоренной перемотке с облётом камеры. */
  private startReplay(info: WinInfo): void {
    const c = this.controller;
    if (!c) return;
    const state = createLoop(c.level, c.state.records);
    this.replay = { state, inputs: info.loops[info.loops.length - 1] ?? '', acc: 0, hold: 0.6, records: c.state.records };
    this.view.setState(state);
    this.view.level?.setTrails(null);
    this.view.level?.setGhosts(null);
    if (!this.save.settings.reducedMotion) this.view.orbit.orbitSpeed = 14;
    this.hud.el.hidden = true;
  }

  private frameReplay(dt: number): void {
    const r = this.replay!;
    const tick = (this.controller?.tickMs ?? 170) / 1000 / 3;
    if (r.hold > 0) {
      r.hold -= dt;
      if (r.hold <= 0 && r.state.outcome !== 'playing') {
        r.state = createLoop(r.state.level, r.records);
        this.view.setState(r.state);
        r.hold = 0.4;
      }
    } else {
      r.acc += dt;
      while (r.acc >= tick && r.hold <= 0) {
        r.acc -= tick;
        const prev = r.state;
        const res = step(prev, inputToAction(r.inputs[prev.tick] ?? '.'));
        r.state = res.state;
        this.view.setTick(prev, res.state, res.events);
        this.effects.onEvents(prev, res.state, res.events);
        if (res.state.outcome !== 'playing' || res.state.tick >= r.inputs.length) r.hold = 1.4;
      }
    }
    this.view.render(dt, r.hold > 0 ? 1 : Math.min(1, r.acc / tick));
  }

  private stopReplay(): void {
    this.replay = null;
    this.view.orbit.orbitSpeed = 0;
    this.hud.el.hidden = false;
  }

  private nextFromWin(): void {
    const c = this.controller;
    if (!c) return;
    const next = nextLevel(this.levels, this.save, c.level);
    this.router.pop(this.screens.win);
    this.stopReplay();
    if (next) this.startLevel(next);
    else this.goLevelsOf(c.level);
  }

  private replayLevel(): void {
    const c = this.controller;
    if (!c) return;
    this.router.pop(this.screens.win);
    this.stopReplay();
    this.startLevel(c.level, this.testPlay);
  }

  private levelsFromWin(): void {
    const c = this.controller;
    this.router.pop(this.screens.win);
    this.stopReplay();
    if (this.testPlay && this.onTestPlayExit) {
      this.exitToMenu();
      return;
    }
    this.goLevelsOf(c?.level ?? null);
  }

  get lastWinInfo(): WinInfo | null {
    return this.lastWin;
  }

  levelName(level: Level): string {
    return lt(level.name);
  }
}

/** Какой звук играет событие симуляции. */
function eventSound(e: SimEvent, playerIndex: number): { name: SfxName; gain?: number } | null {
  switch (e.type) {
    case 'step':
      return { name: 'step', gain: e.actor === playerIndex ? 1 : 0.35 };
    case 'bump':
      return { name: 'bump', gain: 0.6 };
    case 'push':
      return { name: 'push' };
    case 'slide':
      return e.mover.kind === 'actor' && e.mover.index === playerIndex ? { name: 'slide', gain: 0.5 } : null;
    case 'teleport':
      return { name: 'portal' };
    case 'pickup':
      return { name: 'pickup' };
    case 'drop':
      return { name: 'drop' };
    case 'socket':
      return { name: 'socket' };
    case 'unlock':
      return { name: 'unlock' };
    case 'lever':
      return { name: 'lever' };
    case 'plateDown':
      return { name: 'plateDown' };
    case 'plateUp':
      return { name: 'plateUp', gain: 0.6 };
    case 'doorOpen':
      return { name: 'doorOpen' };
    case 'doorClose':
      return { name: 'doorClose' };
    case 'crack':
      return { name: 'crack', gain: 0.6 };
    case 'break':
      return { name: 'break' };
    case 'paradox':
      return { name: 'paradox' };
    case 'death':
      return { name: 'death' };
    case 'receiver':
      return e.on ? { name: 'laser', gain: 0.5 } : null;
    case 'guardMove':
      return { name: 'guard', gain: 0.25 };
    case 'liftMove':
      return { name: 'lift' };
    default:
      return null;
  }
}
