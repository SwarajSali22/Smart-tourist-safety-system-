import en from './locales/en.js';
import hi from './locales/hi.js';
import mr from './locales/mr.js';

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'mr', name: 'मराठी' },
];

const DICTIONARIES = { en, hi, mr };

/** Replaces {name}-style placeholders. Unknown placeholders are left as-is. */
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/**
 * Looks `key` up in the chosen language, then English, then returns the key
 * itself (so a missing translation is visible but never crashes the page).
 */
export function translate(lang, key, vars) {
  const str = DICTIONARIES[lang]?.[key] ?? en[key] ?? key;
  return interpolate(str, vars);
}

export function hasKey(key) {
  return Object.prototype.hasOwnProperty.call(en, key);
}
