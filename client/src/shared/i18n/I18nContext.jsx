import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGES, hasKey, translate } from './translate.js';
import { label as englishLabel } from '../utils/format.js';

const STORAGE_KEY = 'lang';

function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch { /* storage unavailable */ }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
  return LANGUAGES.some((l) => l.code === browser) ? browser : 'en';
}

// Relative time ("3 min ago") built from translated templates.
function makeTimeAgo(t) {
  return (date, now = Date.now()) => {
    if (!date) return t('time.never');
    const secs = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
    if (secs < 45) return t('time.justNow');
    const mins = Math.round(secs / 60);
    if (mins < 60) return t('time.minAgo', { n: mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return t('time.hAgo', { n: hours });
    return t('time.dAgo', { n: Math.round(hours / 24) });
  };
}

function build(lang, setLang) {
  const t = (key, vars) => translate(lang, key, vars);
  return {
    lang,
    setLang,
    t,
    // Enum value → translated label (e.g. "acknowledged"), falling back to the English formatter.
    label: (value) => (value != null && hasKey(`enum.${value}`) ? t(`enum.${value}`) : englishLabel(value)),
    timeAgo: makeTimeAgo(t),
    // t(key) when that key exists, else the given fallback (e.g. enum-like values from the API).
    tOr: (key, fallback, vars) => (hasKey(key) ? t(key, vars) : fallback),
  };
}

// Used when no provider is mounted (the admin area is English-only).
const DEFAULT = build('en', () => {});
const I18nContext = createContext(DEFAULT);

/** Tourist-area i18n: plain dictionaries + this provider; language is remembered in localStorage. */
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = 'en'; };
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!LANGUAGES.some((l) => l.code === code)) return;
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
    setLangState(code);
  }, []);

  const value = useMemo(() => build(lang, setLang), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

/** Topbar language picker (tourist area). */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang-switch">
      <span className="sr-only">{t('menu.language')}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('menu.language')}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}
