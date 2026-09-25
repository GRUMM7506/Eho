import type { LocalText } from '../core/types';
import { en } from './en';
import { ru, type Dict, type TKey } from './ru';

export type Lang = 'ru' | 'en';

const DICTS: Record<Lang, Dict> = { ru, en };
let lang: Lang = 'ru';
const listeners = new Set<() => void>();

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export function getLang(): Lang {
  return lang;
}

export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Перевод с подстановкой `{имя}`. */
export function t(key: TKey, params?: Record<string, string | number>): string {
  let s: string = DICTS[lang][key] ?? ru[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Текст уровня на текущем языке. */
export function lt(text: LocalText | undefined): string {
  if (!text) return '';
  return text[lang] || text.ru;
}

export function detectLang(): Lang {
  const l = (navigator.language || 'ru').toLowerCase();
  return l.startsWith('ru') || l.startsWith('uk') || l.startsWith('be') || l.startsWith('kk') ? 'ru' : 'en';
}

export type { TKey };
