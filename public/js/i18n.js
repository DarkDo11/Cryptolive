// Minimal i18n: a flat dictionary per language, `t(key, params)` lookups with {param} interpolation,
// and `applyTranslations(root)` for static markup annotated with data-i18n attributes.
import { settings } from './store.js';

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' }
];

// Dictionaries live in ./i18n/<lang>.js (plain objects). English is the source of truth: a missing
// Russian key falls back to English, a missing English key falls back to the key itself.
import en from './i18n/en.js';
import ru from './i18n/ru.js';

const dicts = { en, ru };

export function getLang() {
  const saved = settings.get().lang;
  if (saved && dicts[saved]) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return dicts[nav] ? nav : 'en';
}

export function setLang(lang) {
  if (!dicts[lang]) return;
  settings.set({ lang });
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent('lang:change', { detail: lang }));
}

/** Translate `key`, interpolating `{name}` placeholders from `params`. */
export function t(key, params) {
  const lang = getLang();
  let str = dicts[lang]?.[key] ?? dicts.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

/** Locale used for Intl date formatting (numbers stay en-US for consistency of crypto prices). */
export function dateLocale() {
  return getLang() === 'ru' ? 'ru-RU' : 'en-US';
}

/**
 * Apply translations to static markup:
 *   data-i18n="key"              → textContent
 *   data-i18n-html="key"         → innerHTML (only for keys whose values are trusted dictionary strings)
 *   data-i18n-placeholder="key"  → placeholder attribute
 *   data-i18n-title="key"        → title attribute
 *   data-i18n-aria="key"         → aria-label attribute
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.documentElement.lang = getLang();
}
