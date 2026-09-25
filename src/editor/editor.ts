import type { App } from '../app';
import { h } from '../ui/dom';
import type { Screen } from '../ui/router';

/** Временная заглушка редактора (полная версия — этап 10). */
export function createEditorScreen(app: App): Screen {
  const el = h('div.screen.scrim.center', null, h('div.dialog', null, h('h2', null, 'Редактор'), h('button.btn', { type: 'button', onclick: () => app.goMenu() }, 'Назад')));
  el.hidden = true;
  return { el, back: () => app.goMenu() };
}
