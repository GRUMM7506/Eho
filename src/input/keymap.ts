/** Действия, которые можно назначить на клавиши. */
export const BINDABLE = [
  'up',
  'down',
  'left',
  'right',
  'interact',
  'wait',
  'record',
  'undoEcho',
  'rewind',
  'pause',
  'trails',
  'hint',
  'camLeft',
  'camRight',
  'camReset',
  'camTop',
  'next',
] as const;

export type Bindable = (typeof BINDABLE)[number];
export type KeyMap = Record<Bindable, string[]>;

export const DEFAULT_KEYMAP: Readonly<KeyMap> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  interact: ['KeyF', 'Space'],
  wait: ['KeyX', 'Period'],
  record: ['KeyR'],
  undoEcho: ['KeyZ'],
  rewind: ['Backspace'],
  pause: ['Escape', 'KeyP'],
  trails: ['Tab'],
  hint: ['KeyH'],
  camLeft: ['KeyQ'],
  camRight: ['KeyE'],
  camReset: ['KeyC'],
  camTop: ['KeyT'],
  next: ['Enter'],
};

export function cloneKeymap(k: Readonly<KeyMap>): KeyMap {
  return Object.fromEntries(BINDABLE.map((b) => [b, [...(k[b] ?? DEFAULT_KEYMAP[b])]])) as KeyMap;
}

/** Действие по коду клавиши (первое совпадение). */
export function actionForCode(map: Readonly<KeyMap>, code: string): Bindable | null {
  for (const b of BINDABLE) if (map[b]?.includes(code)) return b;
  return null;
}

/** Человекочитаемое имя клавиши. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    Backspace: '⌫',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Period: '.',
    Comma: ',',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
  };
  return names[code] ?? code;
}

/** Переназначить: клавиша снимается с других действий, чтобы не было конфликтов. */
export function rebind(map: KeyMap, action: Bindable, slot: number, code: string): KeyMap {
  const next = cloneKeymap(map);
  for (const b of BINDABLE) next[b] = next[b].filter((c) => c !== code);
  const list = next[action];
  list[slot] = code;
  next[action] = list.filter(Boolean);
  return next;
}
