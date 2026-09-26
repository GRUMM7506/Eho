import type { App } from '../app';
import { compileLevel, parseRawLevel, type RawLevel } from '../core/level';
import { createLoop, inputToAction, playSolution, step } from '../core/sim';
import type { SolveResult } from '../core/solver';
import { COLORS, type Color, type Level, type WorldState } from '../core/types';
import { lt, t, type TKey } from '../i18n';
import { COLOR_HEX } from '../render/debug2d';
import { clear, h, icon } from '../ui/dom';
import type { Screen } from '../ui/router';
import {
  applyTool,
  fromRaw,
  newDoc,
  resize,
  toRaw,
  type Dir4,
  type EdCell,
  type EdDoc,
  type Tool,
} from './model';
import type { SolveRequest, SolveResponse } from './solver.worker';

interface Opts {
  color: Color;
  optColor: Color | null;
  filter: 'any' | 'echo' | 'player';
  dir: Dir4;
  orient: '/' | '\\';
  durability: number;
  from: number;
  to: number;
  low: number;
  high: number;
  range: number;
  route: string;
  mode: 'patrol' | 'lure';
}

interface ToolDef {
  id: string;
  label: TKey;
  group: 'base' | 'entity' | 'fixture' | 'zone';
  /** Какие параметры показывать. */
  params: (keyof Opts)[];
  make(o: Opts): Tool;
  once?: boolean;
}

const TOOLS: ToolDef[] = [
  {
    id: 'floor',
    label: 'ed.floor',
    group: 'base',
    params: [],
    make: () => ({ kind: 'base', base: 'floor' }),
  },
  { id: 'wall', label: 'ed.wall', group: 'base', params: [], make: () => ({ kind: 'base', base: 'wall' }) },
  { id: 'void', label: 'ed.void', group: 'base', params: [], make: () => ({ kind: 'base', base: 'void' }) },
  { id: 'erase', label: 'ed.erase', group: 'base', params: [], make: () => ({ kind: 'erase' }) },
  {
    id: 'start',
    label: 'ed.start',
    group: 'entity',
    params: ['dir'],
    once: true,
    make: (o) => ({ kind: 'entity', entity: { type: 'start', facing: o.dir } }),
  },
  {
    id: 'exit',
    label: 'ed.exit',
    group: 'fixture',
    params: [],
    once: true,
    make: () => ({ kind: 'fixture', fx: { type: 'exit' } }),
  },
  {
    id: 'box',
    label: 'ed.box',
    group: 'entity',
    params: [],
    make: () => ({ kind: 'entity', entity: { type: 'box' } }),
  },
  {
    id: 'key',
    label: 'ed.key',
    group: 'entity',
    params: ['color'],
    make: (o) => ({ kind: 'entity', entity: { type: 'key', color: o.color } }),
  },
  {
    id: 'battery',
    label: 'ed.battery',
    group: 'entity',
    params: [],
    make: () => ({ kind: 'entity', entity: { type: 'battery' } }),
  },
  {
    id: 'guard',
    label: 'ed.guard',
    group: 'entity',
    params: ['dir', 'route', 'mode', 'range'],
    make: (o) => ({
      kind: 'entity',
      entity: {
        type: 'guard',
        facing: o.dir,
        route: o.route.replace(/[^URDL]/g, ''),
        mode: o.mode,
        range: o.range,
      },
    }),
  },
  {
    id: 'plate',
    label: 'ed.plate',
    group: 'fixture',
    params: ['color', 'filter'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'plate', color: o.color, filter: o.filter } }),
  },
  {
    id: 'door',
    label: 'ed.door',
    group: 'fixture',
    params: ['color'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'door', color: o.color, inverse: false } }),
  },
  {
    id: 'inverse',
    label: 'ed.inverse',
    group: 'fixture',
    params: ['color'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'door', color: o.color, inverse: true } }),
  },
  {
    id: 'timer',
    label: 'ed.timer',
    group: 'fixture',
    params: ['from', 'to'],
    make: (o) => ({
      kind: 'fixture',
      fx: { type: 'timerDoor', from: Math.min(o.from, o.to), to: Math.max(o.from, o.to) },
    }),
  },
  {
    id: 'lever',
    label: 'ed.lever',
    group: 'fixture',
    params: ['color'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'lever', color: o.color } }),
  },
  {
    id: 'lock',
    label: 'ed.lock',
    group: 'fixture',
    params: ['color'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'lock', color: o.color } }),
  },
  {
    id: 'socket',
    label: 'ed.socket',
    group: 'fixture',
    params: ['color'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'socket', color: o.color } }),
  },
  {
    id: 'portal',
    label: 'ed.portal',
    group: 'fixture',
    params: ['color'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'portal', color: o.color } }),
  },
  {
    id: 'conveyor',
    label: 'ed.conveyor',
    group: 'fixture',
    params: ['dir'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'conveyor', dir: o.dir } }),
  },
  {
    id: 'ice',
    label: 'ed.ice',
    group: 'fixture',
    params: [],
    make: () => ({ kind: 'fixture', fx: { type: 'ice' } }),
  },
  {
    id: 'fragile',
    label: 'ed.fragile',
    group: 'fixture',
    params: ['durability'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'fragile', durability: o.durability } }),
  },
  {
    id: 'pit',
    label: 'ed.pit',
    group: 'fixture',
    params: [],
    make: () => ({ kind: 'fixture', fx: { type: 'pit' } }),
  },
  {
    id: 'emitter',
    label: 'ed.emitter',
    group: 'fixture',
    params: ['dir', 'optColor'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'emitter', dir: o.dir, color: o.optColor } }),
  },
  {
    id: 'mirror',
    label: 'ed.mirror',
    group: 'fixture',
    params: ['orient', 'optColor'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'mirror', orient: o.orient, color: o.optColor } }),
  },
  {
    id: 'receiver',
    label: 'ed.receiver',
    group: 'fixture',
    params: ['color'],
    make: (o) => ({ kind: 'fixture', fx: { type: 'receiver', color: o.color } }),
  },
  {
    id: 'stairs',
    label: 'ed.stairs',
    group: 'fixture',
    params: [],
    make: () => ({ kind: 'fixture', fx: { type: 'stairs' } }),
  },
  {
    id: 'lift',
    label: 'ed.lift',
    group: 'fixture',
    params: ['color', 'low', 'high'],
    make: (o) => ({
      kind: 'fixture',
      fx: { type: 'lift', color: o.color, low: o.low, high: Math.max(o.high, o.low) },
    }),
  },
  { id: 'solid', label: 'ed.solid', group: 'zone', params: [], make: () => ({ kind: 'solid', on: true }) },
  {
    id: 'unsolid',
    label: 'ed.unsolid',
    group: 'zone',
    params: [],
    make: () => ({ kind: 'solid', on: false }),
  },
  { id: 'up', label: 'ed.up', group: 'zone', params: [], make: () => ({ kind: 'height', delta: 1 }) },
  { id: 'down', label: 'ed.down', group: 'zone', params: [], make: () => ({ kind: 'height', delta: -1 }) },
];

const ARROW: Record<Dir4, string> = { N: '↑', E: '→', S: '↓', W: '←' };

/** Рисунок клетки документа в 2D (не требует, чтобы уровень компилировался). */
function drawCell(g: CanvasRenderingContext2D, c: EdCell, x: number, y: number, cs: number): void {
  const px = x * cs;
  const py = y * cs;
  const center = (ch: string, color: string, size = 0.5) => {
    g.fillStyle = color;
    g.font = `600 ${Math.round(cs * size)}px "IBM Plex Mono", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, px + cs / 2, py + cs / 2 + 1);
  };
  if (c.base === 'wall') {
    g.fillStyle = '#221D45';
    g.fillRect(px, py, cs, cs);
    g.fillStyle = '#342C69';
    g.fillRect(px + 1, py + 1, cs - 2, cs * 0.25);
    return;
  }
  if (c.base === 'void') {
    g.fillStyle = '#07060f';
    g.fillRect(px, py, cs, cs);
    return;
  }
  g.fillStyle = c.height
    ? `rgb(${40 + c.height * 12},${34 + c.height * 10},${80 + c.height * 14})`
    : '#1f1a45';
  g.fillRect(px + 1, py + 1, cs - 2, cs - 2);
  if (c.solid) {
    g.strokeStyle = 'rgba(179,136,255,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 4; i++) {
      g.moveTo(px + (i * cs) / 4, py);
      g.lineTo(px + (i * cs) / 4, py + cs);
      g.moveTo(px, py + (i * cs) / 4);
      g.lineTo(px + cs, py + (i * cs) / 4);
    }
    g.stroke();
  }
  const f = c.fx;
  if (f) {
    const col = 'color' in f && f.color ? COLOR_HEX[f.color] : '#ECE8FF';
    switch (f.type) {
      case 'exit':
        g.strokeStyle = '#5CF2B5';
        g.lineWidth = 3;
        g.strokeRect(px + cs * 0.18, py + cs * 0.18, cs * 0.64, cs * 0.64);
        break;
      case 'plate':
        g.strokeStyle = col;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(px + cs / 2, py + cs / 2, cs * 0.3, 0, Math.PI * 2);
        g.stroke();
        if (f.filter !== 'any') center(f.filter === 'echo' ? 'e' : 'p', col, 0.36);
        break;
      case 'door':
        g.fillStyle = col;
        g.fillRect(px + cs * 0.15, py + cs * 0.15, cs * 0.7, cs * 0.7);
        if (f.inverse) center('/', '#0D0B1E', 0.6);
        break;
      case 'timerDoor':
        g.fillStyle = '#ECE8FF';
        g.fillRect(px + cs * 0.15, py + cs * 0.15, cs * 0.7, cs * 0.7);
        center(`${f.from}-${f.to}`, '#0D0B1E', 0.26);
        break;
      case 'lever':
        center('⇅', col);
        break;
      case 'lock':
        center('▣', col);
        break;
      case 'socket':
        center('◎', col);
        break;
      case 'portal':
        center('◯', col, 0.62);
        break;
      case 'conveyor':
        center(ARROW[f.dir], '#9C95C9');
        break;
      case 'ice':
        g.fillStyle = 'rgba(159,232,255,0.35)';
        g.fillRect(px + 2, py + 2, cs - 4, cs - 4);
        break;
      case 'fragile':
        center(`%${f.durability}`, '#b9a6ff', 0.34);
        break;
      case 'pit':
        g.fillStyle = '#000';
        g.fillRect(px + 4, py + 4, cs - 8, cs - 8);
        break;
      case 'emitter':
        center(ARROW[f.dir], f.color ? col : '#FF4D5E');
        break;
      case 'mirror':
        center(f.orient, f.color ? col : '#ECE8FF', 0.6);
        break;
      case 'receiver':
        center('◆', col);
        break;
      case 'stairs':
        center('≡', '#9C95C9');
        break;
      case 'lift':
        center('⇕', col);
        break;
    }
  }
  const e = c.entity;
  if (e) {
    switch (e.type) {
      case 'start':
        g.fillStyle = '#FFE45E';
        g.beginPath();
        g.arc(px + cs / 2, py + cs / 2, cs * 0.26, 0, Math.PI * 2);
        g.fill();
        center(ARROW[e.facing], '#1A1500', 0.34);
        break;
      case 'box':
        g.fillStyle = '#6b5a8e';
        g.fillRect(px + cs * 0.2, py + cs * 0.2, cs * 0.6, cs * 0.6);
        break;
      case 'key':
        center('ꗃ', COLOR_HEX[e.color], 0.45);
        break;
      case 'battery':
        g.fillStyle = '#5CF2B5';
        g.fillRect(px + cs * 0.38, py + cs * 0.22, cs * 0.24, cs * 0.56);
        break;
      case 'guard':
        g.fillStyle = e.mode === 'lure' ? '#ff9f43' : '#FF4D5E';
        g.beginPath();
        g.arc(px + cs / 2, py + cs / 2, cs * 0.28, 0, Math.PI * 2);
        g.fill();
        center(ARROW[e.facing], '#0D0B1E', 0.34);
        break;
    }
  }
  if (c.height) {
    g.fillStyle = '#ECE8FF';
    g.font = `600 ${Math.round(cs * 0.24)}px "IBM Plex Mono", monospace`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(String(c.height), px + 3, py + 2);
  }
}

class EditorScreen implements Screen {
  readonly el: HTMLElement;
  private doc: EdDoc = newDoc();
  private toolId = 'wall';
  private opts: Opts = {
    color: 'pink',
    optColor: null,
    filter: 'any',
    dir: 'E',
    orient: '/',
    durability: 1,
    from: 3,
    to: 8,
    low: 0,
    high: 1,
    range: 4,
    route: '',
    mode: 'patrol',
  };
  private readonly canvas = h('canvas.ed-grid', { 'aria-label': t('ed.title') });
  private readonly panel = h('div.ed-panel.scroll');
  private readonly status = h('div.ed-status', { role: 'status', 'aria-live': 'polite' });
  private readonly history: string[] = [];
  private painting = false;
  private lastCell = -1;
  private previewTimer = 0;
  private worker: Worker | null = null;
  private solution: SolveResult | null = null;
  private replayTimer = 0;
  private show3d = false;

  constructor(private readonly app: App) {
    this.el = h('div.screen.ed');
    this.el.hidden = true;
    this.canvas.addEventListener('pointerdown', (e) => this.pointer(e, true));
    this.canvas.addEventListener('pointermove', (e) => this.pointer(e, false));
    const stop = () => {
      if (this.painting) this.changed();
      this.painting = false;
      this.lastCell = -1;
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden || !this.el.classList.contains('shown')) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        this.undo();
      }
    });
    window.addEventListener('resize', () => {
      if (!this.el.hidden) this.drawGrid();
    });
  }

  enter(): void {
    this.app.enterEditorMode();
    this.render();
    this.refreshPreview(true);
  }

  leave(): void {
    clearInterval(this.replayTimer);
    this.worker?.terminate();
    this.worker = null;
  }

  back(): void {
    this.app.exitEditor();
  }

  refresh(): void {
    if (!this.el.hidden) this.render();
  }

  /** Открыть документ (из «Моих уровней» или импорта). */
  open(doc: EdDoc): void {
    this.doc = doc;
    this.history.length = 0;
    this.solution = null;
    this.render();
    this.refreshPreview(true);
  }

  // ————— рисование —————

  private cellAt(e: PointerEvent): number {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.doc.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.doc.height);
    if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return -1;
    return y * this.doc.width + x;
  }

  private pointer(e: PointerEvent, down: boolean): void {
    if (down) {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.history.push(JSON.stringify(this.doc));
      if (this.history.length > 60) this.history.shift();
      this.painting = true;
    }
    if (!this.painting) return;
    const cell = this.cellAt(e);
    if (cell < 0 || cell === this.lastCell) return;
    const def = TOOLS.find((x) => x.id === this.toolId)!;
    if (def.once && !down) return;
    this.lastCell = cell;
    if (applyTool(this.doc, cell, def.make(this.opts))) {
      this.solution = null;
      this.drawGrid();
      this.refreshPreview(false);
    }
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.doc = JSON.parse(prev) as EdDoc;
    this.changed();
    this.render();
  }

  private changed(): void {
    this.refreshPreview(false);
    this.validate();
  }

  // ————— предпросмотр —————

  private compile(): Level | null {
    try {
      return compileLevel(toRaw(this.doc));
    } catch {
      return null;
    }
  }

  private validate(): void {
    try {
      compileLevel(toRaw(this.doc));
      if (!this.solution) this.setStatus(t('ed.hint'));
    } catch (e) {
      this.setStatus(t('ed.error', { msg: (e as Error).message }), true);
    }
  }

  private refreshPreview(immediate: boolean): void {
    clearTimeout(this.previewTimer);
    const run = () => {
      const level = this.compile();
      if (!level) return;
      clearInterval(this.replayTimer);
      this.app.previewLevel(level, createLoop(level, []));
    };
    if (immediate) run();
    else this.previewTimer = window.setTimeout(run, 180);
  }

  private drawGrid(): void {
    const d = this.doc;
    const wrap = this.canvas.parentElement;
    const availW = Math.max(120, (wrap?.clientWidth ?? 400) - 4);
    const availH = Math.max(120, (wrap?.clientHeight ?? 400) - 4);
    const cs = Math.max(12, Math.min(44, Math.floor(Math.min(availW / d.width, availH / d.height))));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = d.width * cs * dpr;
    this.canvas.height = d.height * cs * dpr;
    this.canvas.style.width = `${d.width * cs}px`;
    this.canvas.style.height = `${d.height * cs}px`;
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0D0B1E';
    g.fillRect(0, 0, d.width * cs, d.height * cs);
    for (let y = 0; y < d.height; y++)
      for (let x = 0; x < d.width; x++) drawCell(g, d.cells[y * d.width + x]!, x, y, cs);
  }

  private setStatus(text: string, bad = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('bad', bad);
  }

  // ————— интерфейс —————

  private render(): void {
    clear(this.el);
    clear(this.panel);
    const palette = h('div.ed-palette');
    for (const def of TOOLS) {
      palette.append(
        h(
          `button.ed-tool${def.id === this.toolId ? '.on' : ''}` as 'button',
          {
            type: 'button',
            'aria-pressed': String(def.id === this.toolId),
            onclick: () => {
              this.toolId = def.id;
              this.render();
            },
          },
          t(def.label),
        ),
      );
    }
    this.panel.append(h('h3', null, t('ed.tools')), palette);
    const params = this.paramsUI();
    if (params) this.panel.append(h('h3', null, t('ed.options')), params);
    this.panel.append(
      h('h3', null, t('ed.level')),
      this.levelUI(),
      h('h3', null, t('ed.actions')),
      this.actionsUI(),
      h('h3', null, t('ed.mine')),
      this.mineUI(),
    );

    const gridWrap = h('div.ed-gridwrap', null, this.canvas);
    const top = h(
      'div.topbar',
      null,
      h(
        'button.btn.icon-only',
        { type: 'button', 'aria-label': t('ed.back'), onclick: () => this.back() },
        icon('back'),
      ),
      h('h2', null, t('ed.title')),
      h('span.spacer'),
      h(
        'button.btn',
        { type: 'button', onclick: () => this.undo(), title: 'Ctrl+Z' },
        icon('undo'),
        t('ed.undo'),
      ),
      h(
        'button.btn.ed-toggle3d',
        {
          type: 'button',
          onclick: () => {
            this.show3d = !this.show3d;
            this.el.classList.toggle('view3d', this.show3d);
            this.app.onResize();
          },
        },
        this.show3d ? t('ed.viewGrid') : t('ed.view3d'),
      ),
    );
    this.el.append(top, h('div.ed-body', null, this.panel, gridWrap), this.status);
    this.el.classList.toggle('view3d', this.show3d);
    requestAnimationFrame(() => {
      this.drawGrid();
      this.app.onResize();
    });
    this.validate();
  }

  private num(label: TKey, value: number, min: number, max: number, set: (v: number) => void): HTMLElement {
    const input = h('input', { type: 'number', min, max, value, inputmode: 'numeric' });
    input.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, Math.round(Number(input.value) || 0)));
      input.value = String(v);
      set(v);
    });
    return h('label.ed-field', null, h('span', null, t(label)), input);
  }

  private seg<T extends string>(
    label: TKey,
    value: T,
    options: [T, string][],
    set: (v: T) => void,
  ): HTMLElement {
    return h(
      'div.ed-field',
      null,
      h('span', null, t(label)),
      h(
        'div.seg',
        null,
        ...options.map(([v, text]) =>
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(v === value),
              onclick: () => {
                set(v);
                this.render();
              },
            },
            text,
          ),
        ),
      ),
    );
  }

  private paramsUI(): HTMLElement | null {
    const def = TOOLS.find((x) => x.id === this.toolId)!;
    if (!def.params.length) return null;
    const o = this.opts;
    const box = h('div.ed-params');
    const swatches = (current: Color | null, allowNone: boolean, set: (c: Color | null) => void) =>
      h(
        'div.ed-swatches',
        null,
        ...(allowNone
          ? [
              h(
                `button.sw${current === null ? '.on' : ''}` as 'button',
                {
                  type: 'button',
                  title: t('ed.noColor'),
                  onclick: () => {
                    set(null);
                    this.render();
                  },
                },
                '∅',
              ),
            ]
          : []),
        ...COLORS.map((c) =>
          h(`button.sw${c === current ? '.on' : ''}` as 'button', {
            type: 'button',
            style: `background:${COLOR_HEX[c]}`,
            'aria-label': c,
            onclick: () => {
              set(c);
              this.render();
            },
          }),
        ),
      );
    for (const p of def.params) {
      switch (p) {
        case 'color':
          box.append(
            h(
              'div.ed-field',
              null,
              h('span', null, t('ed.color')),
              swatches(o.color, false, (c) => (o.color = c ?? 'pink')),
            ),
          );
          break;
        case 'optColor':
          box.append(
            h(
              'div.ed-field',
              null,
              h('span', null, t('ed.color')),
              swatches(o.optColor, true, (c) => (o.optColor = c)),
            ),
          );
          break;
        case 'filter':
          box.append(
            this.seg(
              'ed.filter',
              o.filter,
              [
                ['any', t('ed.fAny')],
                ['echo', t('ed.fEcho')],
                ['player', t('ed.fPlayer')],
              ],
              (v) => (o.filter = v),
            ),
          );
          break;
        case 'dir':
          box.append(
            this.seg(
              'ed.dir',
              o.dir,
              [
                ['N', '↑'],
                ['E', '→'],
                ['S', '↓'],
                ['W', '←'],
              ],
              (v) => (o.dir = v),
            ),
          );
          break;
        case 'orient':
          box.append(
            this.seg(
              'ed.orient',
              o.orient,
              [
                ['/', '/'],
                ['\\', '\\'],
              ],
              (v) => (o.orient = v),
            ),
          );
          break;
        case 'mode':
          box.append(
            this.seg(
              'ed.mode',
              o.mode,
              [
                ['patrol', t('ed.patrol')],
                ['lure', t('ed.lure')],
              ],
              (v) => (o.mode = v),
            ),
          );
          break;
        case 'durability':
          box.append(this.num('ed.durability', o.durability, 1, 9, (v) => (o.durability = v)));
          break;
        case 'from':
          box.append(this.num('ed.from', o.from, 0, 199, (v) => (o.from = v)));
          break;
        case 'to':
          box.append(this.num('ed.to', o.to, 0, 199, (v) => (o.to = v)));
          break;
        case 'low':
          box.append(this.num('ed.low', o.low, 0, 9, (v) => (o.low = v)));
          break;
        case 'high':
          box.append(this.num('ed.high', o.high, 0, 9, (v) => (o.high = v)));
          break;
        case 'range':
          box.append(this.num('ed.range', o.range, 0, 20, (v) => (o.range = v)));
          break;
        case 'route': {
          const input = h('input', {
            type: 'text',
            value: o.route,
            maxlength: 40,
            spellcheck: 'false',
            autocapitalize: 'characters',
          });
          input.addEventListener('change', () => {
            o.route = input.value.toUpperCase().replace(/[^URDL]/g, '');
            input.value = o.route;
          });
          box.append(h('label.ed-field', null, h('span', null, t('ed.route')), input));
          break;
        }
      }
    }
    return box;
  }

  private levelUI(): HTMLElement {
    const d = this.doc;
    const text = (label: TKey, value: string, set: (v: string) => void) => {
      const input = h('input', { type: 'text', value, maxlength: 40 });
      input.addEventListener('change', () => set(input.value.trim() || value));
      return h('label.ed-field', null, h('span', null, t(label)), input);
    };
    const reverse = h('button.toggle', {
      type: 'button',
      role: 'switch',
      'aria-checked': String(d.reverseEchoes),
      onclick: () => {
        d.reverseEchoes = !d.reverseEchoes;
        this.changed();
        this.render();
      },
    });
    return h(
      'div.ed-params',
      null,
      text('ed.nameRu', d.name.ru, (v) => (d.name.ru = v)),
      text('ed.nameEn', d.name.en, (v) => (d.name.en = v)),
      this.num('ed.width', d.width, 3, 24, (v) => {
        this.history.push(JSON.stringify(this.doc));
        this.doc = resize(this.doc, v, this.doc.height);
        this.changed();
        this.render();
      }),
      this.num('ed.height', d.height, 3, 18, (v) => {
        this.history.push(JSON.stringify(this.doc));
        this.doc = resize(this.doc, this.doc.width, v);
        this.changed();
        this.render();
      }),
      this.num('ed.tickLimit', d.tickLimit, 1, 200, (v) => {
        d.tickLimit = v;
        this.changed();
      }),
      this.num('ed.maxEchoes', d.maxEchoes, 0, 12, (v) => {
        d.maxEchoes = v;
        this.changed();
      }),
      h('div.ed-field', null, h('span', null, t('ed.reverse')), reverse),
    );
  }

  private actionsUI(): HTMLElement {
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) void f.text().then((txt) => this.importText(txt));
      file.value = '';
    });
    const btn = (label: TKey, ico: Parameters<typeof icon>[0], fn: () => void, cls = '') =>
      h(`button.btn${cls}` as 'button', { type: 'button', onclick: fn }, icon(ico), t(label));
    const box = h(
      'div.ed-actions',
      null,
      btn('ed.test', 'play', () => this.testPlay(), '.primary'),
      btn('ed.check', 'check', () => this.checkSolvable()),
      this.solution?.solved ? btn('ed.show', 'replay', () => this.showSolution()) : null,
      btn('ed.save', 'check', () => this.saveToMine()),
      btn('ed.copy', 'grid', () => void this.copyJson()),
      btn('ed.paste', 'edit', () => void this.pasteJson()),
      btn('ed.download', 'next', () => this.download()),
      btn('ed.upload', 'back', () => file.click()),
      btn('ed.new', 'edit', () => this.open(newDoc())),
      file,
    );
    return box;
  }

  private mineUI(): HTMLElement {
    const list = h('div.ed-mine');
    const raws = this.app.save.customLevels;
    if (!raws.length) list.append(h('p.muted', null, t('ed.empty')));
    raws.forEach((raw, i) => {
      const name = raw?.name ? lt(raw.name) : `#${i + 1}`;
      list.append(
        h(
          'div.ed-mine-row',
          null,
          h('span', null, name),
          h('button.btn', { type: 'button', onclick: () => this.openCustom(i) }, t('ed.open')),
          h(
            'button.btn.danger',
            {
              type: 'button',
              onclick: () => {
                const next = raws.slice();
                next.splice(i, 1);
                this.app.setCustomLevels(next);
                this.render();
              },
            },
            t('ed.delete'),
          ),
        ),
      );
    });
    return list;
  }

  private openCustom(i: number): void {
    try {
      this.open(fromRaw(this.app.save.customLevels[i]));
    } catch (e) {
      this.setStatus(t('ed.importFail', { msg: (e as Error).message }), true);
    }
  }

  // ————— действия —————

  private testPlay(): void {
    const level = this.compile();
    if (!level) {
      this.validate();
      return;
    }
    this.app.onTestPlayExit = () => this.app.goEditor();
    this.app.startLevel({ ...level, world: -1, index: 0 }, true);
  }

  private checkSolvable(): void {
    let raw: RawLevel;
    try {
      raw = toRaw(this.doc);
      compileLevel(raw);
    } catch (e) {
      this.setStatus(t('ed.error', { msg: (e as Error).message }), true);
      return;
    }
    this.worker?.terminate();
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.setStatus(t('ed.checking', { p: 0 }));
    worker.onerror = (ev) => {
      worker.terminate();
      this.worker = null;
      this.setStatus(t('ed.error', { msg: ev.message || 'worker' }), true);
    };
    worker.onmessage = (e: MessageEvent<SolveResponse>) => {
      const m = e.data;
      if ('progress' in m) {
        this.setStatus(t('ed.checking', { p: Math.round(m.progress * 100) }));
        return;
      }
      worker.terminate();
      this.worker = null;
      if (!m.ok) {
        this.setStatus(t('ed.error', { msg: m.error }), true);
        return;
      }
      const r = m.result;
      if (!r.solved) {
        this.setStatus(t('ed.unsolved'), true);
        return;
      }
      this.solution = r;
      this.doc.par = { echoes: r.echoes, ticks: r.ticks };
      this.render();
      this.setStatus(
        t('ed.solved', { echoes: r.echoes, ticks: r.ticks, min: r.provenMinimal ? t('ed.minimal') : '' }),
      );
    };
    worker.postMessage({ raw, timeLimitMs: 20000 } satisfies SolveRequest);
  }

  /** Проиграть найденное решение в 3D-предпросмотре. */
  private showSolution(): void {
    const level = this.compile();
    const sol = this.solution;
    if (!level || !sol?.solved) return;
    const { records } = playSolution(level, sol.loops);
    const inputs = sol.loops[sol.loops.length - 1] ?? '';
    let s: WorldState = createLoop(level, records);
    this.app.previewLevel(level, s);
    clearInterval(this.replayTimer);
    this.replayTimer = window.setInterval(() => {
      if (s.outcome !== 'playing' || s.tick >= inputs.length) {
        s = createLoop(level, records);
        this.app.view.setState(s);
        return;
      }
      const prev = s;
      const r = step(s, inputToAction(inputs[s.tick] ?? '.'));
      s = r.state;
      this.app.view.setTick(prev, s, r.events);
      this.app.effects.onEvents(prev, s, r.events);
    }, 200);
  }

  private saveToMine(): void {
    let raw: RawLevel;
    try {
      raw = toRaw(this.doc);
      compileLevel(raw);
    } catch (e) {
      this.setStatus(t('ed.error', { msg: (e as Error).message }), true);
      return;
    }
    const list = this.app.save.customLevels.slice();
    const i = list.findIndex((l) => l?.id === raw.id);
    if (i >= 0) list[i] = raw;
    else list.push(raw);
    this.app.setCustomLevels(list);
    this.setStatus(t('ed.saved'));
    this.render();
    this.setStatus(t('ed.saved'));
  }

  private json(): string {
    return JSON.stringify(toRaw(this.doc), null, 2);
  }

  private async copyJson(): Promise<void> {
    const text = this.json();
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus(t('ed.copied'));
    } catch {
      this.textDialog(text, false);
    }
  }

  private async pasteJson(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        this.importText(text);
        return;
      }
    } catch {
      // нет доступа к буферу — покажем поле ввода
    }
    this.textDialog('', true);
  }

  private importText(text: string): void {
    try {
      const raw = parseRawLevel(JSON.parse(text));
      this.history.push(JSON.stringify(this.doc));
      this.open(fromRaw(raw));
      this.setStatus(t('ed.imported'));
    } catch (e) {
      this.setStatus(t('ed.importFail', { msg: (e as Error).message }), true);
    }
  }

  private download(): void {
    const blob = new Blob([this.json()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safe = this.doc.name.en.replace(/[^\w-]+/g, '-').toLowerCase() || 'level';
    a.download = `echo-${safe}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Поле для копирования/вставки JSON, когда буфер обмена недоступен. */
  private textDialog(text: string, forImport: boolean): void {
    const area = h('textarea.ed-text', { spellcheck: 'false', placeholder: t('ed.pasteHere') });
    area.value = text;
    const overlay = h(
      'div.ed-modal',
      null,
      h(
        'div.dialog',
        null,
        area,
        h(
          'div.row',
          null,
          forImport
            ? h(
                'button.btn.primary',
                {
                  type: 'button',
                  onclick: () => {
                    overlay.remove();
                    this.importText(area.value);
                  },
                },
                t('ed.load'),
              )
            : null,
          h('button.btn', { type: 'button', onclick: () => overlay.remove() }, t('ed.close')),
        ),
      ),
    );
    this.el.append(overlay);
    area.focus();
    if (!forImport) area.select();
  }

  /** Ширина панели редактора — камера предпросмотра вписывает уровень справа от неё. */
  insetLeft(): number {
    if (this.el.hidden || this.show3d) return 0;
    const body = this.el.querySelector('.ed-body');
    return body ? body.getBoundingClientRect().right + 8 : 0;
  }
}

export function createEditorScreen(app: App): Screen & { insetLeft(): number; open(doc: EdDoc): void } {
  return new EditorScreen(app);
}
