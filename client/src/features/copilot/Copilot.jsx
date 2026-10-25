import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, Compass, Loader2, MapPin, Mic, MicOff, Navigation, Phone, Plus, SendHorizontal, ShieldAlert, Sparkles, TriangleAlert, User as UserIcon, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { I18nProvider, LanguageSwitcher, useI18n } from '../../shared/i18n/I18nContext.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import './copilot.css';

const SPEECH_LANG = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
const SUGGESTIONS = { tourist: ['t1', 't2', 't3', 't4'], admin: ['a1', 'a2', 'a3', 'a4'] };
const EMPTY = [];
const HISTORY_TURNS = 10; // how much of the conversation is sent with each question

const speechApi = () => (typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null);

/** Mic button logic: browser speech recognition, started only by the user, text lands in the box for editing. */
function useVoice({ lang, onText }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recRef = useRef(null);
  const supported = Boolean(speechApi());

  useEffect(() => () => recRef.current?.abort?.(), []);

  const start = useCallback(() => {
    const Rec = speechApi();
    if (!Rec) { setError('unsupported'); return; }
    setError('');
    const rec = new Rec();
    rec.lang = SPEECH_LANG[lang] || 'en-IN';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(' '));
    rec.onerror = (e) => {
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'nospeech' : 'error');
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setError('error'); }
  }, [lang, onText]);

  const stop = useCallback(() => { recRef.current?.stop?.(); setListening(false); }, []);
  return { supported, listening, error, start, stop, clearError: () => setError('') };
}

function PlaceCard({ place, registered, t }) {
  const km = place.straightLineKm;
  return (
    <li className="copilot-place">
      <div className="copilot-place__head">
        <strong className="copilot-place__name">{place.name}</strong>
        <span className="badge-row">
          {registered ? <Badge variant="success">{place.type}</Badge> : <Badge variant="info">{place.categoryLabel}</Badge>}
          {km != null && <Badge variant="neutral">{t('copilot.straight', { km })}</Badge>}
        </span>
      </div>
      {place.address && <p className="copilot-place__meta">{place.address}</p>}
      {place.openingHours && <p className="copilot-place__meta">{t('copilot.hours', { hours: place.openingHours })}</p>}
      <div className="copilot-place__actions">
        {place.links?.directions && <a className="btn btn--ghost btn--sm" href={place.links.directions} target="_blank" rel="noreferrer noopener"><Navigation size={14} aria-hidden="true" /> {t('copilot.directions')}</a>}
        {place.phone && <a className="btn btn--ghost btn--sm" href={`tel:${String(place.phone).replace(/[^+\d]/g, '')}`}><Phone size={14} aria-hidden="true" /> {t('copilot.call')}</a>}
      </div>
    </li>
  );
}

/** Facilities + map that came back with one answer. Built only from the server's lookup results, never from the AI's text. */
function Results({ meta, t }) {
  const [mapOpen, setMapOpen] = useState(false);
  const osm = meta.places || EMPTY;
  const reg = meta.registeredCenters || EMPTY;
  const pins = useMemo(() => [
    ...osm.map((p, i) => ({ id: `o${i}`, lat: p.lat, lng: p.lng, title: p.name, text: `${p.categoryLabel} · ${p.straightLineKm} km` })),
    ...reg.map((p, i) => ({ id: `r${i}`, lat: p.lat, lng: p.lng, title: p.name, text: p.type, tone: 'ok' })),
  ], [osm, reg]);
  if (!osm.length && !reg.length) return null;
  const fit = { key: pins.map((p) => p.id).join(), points: [...pins.map((p) => [p.lat, p.lng]), ...(meta.origin ? [[meta.origin.lat, meta.origin.lng]] : [])] };
  return (
    <div className="copilot-results">
      {osm.length > 0 && (
        <section>
          <h4 className="copilot-results__title"><Compass size={15} aria-hidden="true" /> {t('copilot.places.title')}</h4>
          <ul className="copilot-places">{osm.map((p) => <PlaceCard key={p.osm} place={p} t={t} />)}</ul>
          <p className="copilot-note">{t('copilot.places.note')}</p>
        </section>
      )}
      {reg.length > 0 && (
        <section>
          <h4 className="copilot-results__title"><ShieldAlert size={15} aria-hidden="true" /> {t('copilot.registered.title')}</h4>
          <ul className="copilot-places">{reg.map((p, i) => <PlaceCard key={`${p.name}${i}`} place={p} registered t={t} />)}</ul>
        </section>
      )}
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMapOpen((o) => !o)} aria-expanded={mapOpen}>
        <MapPin size={14} aria-hidden="true" /> {mapOpen ? t('copilot.hideMap') : t('copilot.showMap')}
      </button>
      {mapOpen && (
        <div className="copilot-map">
          <GeoMap height={260} center={[pins[0].lat, pins[0].lng]} zoom={14} pins={pins} fit={fit} userPosition={meta.origin} showZones={false} showDevices={false} allowFullscreen />
        </div>
      )}
    </div>
  );
}

function Message({ m, t, timeFmt, onRetry }) {
  if (m.role === 'user') {
    return (
      <div className="copilot-msg copilot-msg--user">
        <div className="copilot-bubble">{m.content}</div>
        <span className="copilot-avatar copilot-avatar--user" aria-hidden="true"><UserIcon size={16} /></span>
      </div>
    );
  }
  const meta = m.meta || {};
  return (
    <div className={`copilot-msg copilot-msg--assistant${m.error ? ' copilot-msg--error' : ''}`}>
      <span className="copilot-avatar" aria-hidden="true">{m.error ? <TriangleAlert size={16} /> : <Sparkles size={16} />}</span>
      <div className="copilot-msg__body">
        <div className="copilot-bubble" role={m.error ? 'alert' : undefined}>{m.content}</div>
        {m.error && onRetry && <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>{t('copilot.retry')}</button>}
        {!m.error && <Results meta={meta} t={t} />}
        {!m.error && meta.answeredAt && (
          <p className="copilot-fresh">
            <span className={`copilot-dot${meta.liveLookups?.used?.length ? ' copilot-dot--live' : ''}`} aria-hidden="true" />
            {meta.liveLookups?.used?.length ? t('copilot.live') : t('copilot.noLive')} · {t('copilot.answeredAt', { time: timeFmt(meta.answeredAt) })}
            {meta.sources?.length > 0 && <> · {meta.sources.join(', ')}</>}
            {meta.liveLookups?.failed?.length > 0 && <span className="copilot-warn"> · {t('copilot.lookupFailed')}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

function Copilot() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const role = user?.role === 'admin' ? 'admin' : 'tourist';
  const [messages, setMessages] = useState([]);
  const routeState = useLocation().state; // e.g. an incident page can pre-fill a review question (never auto-sent)
  const [input, setInput] = useState(() => (typeof routeState?.prefill === 'string' ? routeState.prefill.slice(0, 500) : ''));
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(null); // null = checking
  const [fix, setFix] = useState(null); // optional browser location, tourists only: { lat, lng, accuracy, capturedAt }
  const [locError, setLocError] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const voice = useVoice({ lang, onText: setInput });

  useEffect(() => {
    let alive = true;
    api.get('/copilot/status').then((d) => alive && setAvailable(Boolean(d.available))).catch(() => alive && setAvailable(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, busy]);

  const timeFmt = useCallback((iso) => new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { hour: '2-digit', minute: '2-digit' }), [lang]);

  const ask = useCallback(async (text, base = messages) => {
    const question = text.trim();
    if (!question || busy) return;
    voice.stop();
    const next = [...base, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const body = {
        lang,
        messages: next.filter((m) => !m.error).slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })),
        ...(role === 'tourist' && fix ? { location: fix } : {}),
      };
      const d = await api.post('/copilot/chat', body);
      setMessages((list) => [...list, { role: 'assistant', content: d.reply, meta: d }]);
    } catch (err) {
      const key = err.status === 429 ? 'copilot.error.limit' : err.status >= 500 ? 'copilot.error.unavailable' : err.status ? 'copilot.error.generic' : 'copilot.error.network';
      if (err.status === 503) setAvailable(false);
      setMessages((list) => [...list, { role: 'assistant', error: true, content: t(key), retryText: question }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [busy, fix, lang, messages, role, t, voice]);

  const retry = () => {
    const last = messages[messages.length - 1];
    if (!last?.error) return;
    const base = messages.slice(0, -2); // drop the failed answer and its question, then ask again
    setMessages(base);
    ask(last.retryText, base);
  };

  const shareLocation = () => {
    setLocError('');
    if (!navigator.geolocation) { setLocError('copilot.location.unsupported'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), capturedAt: Date.now() }),
      (e) => setLocError(e.code === 1 ? 'copilot.location.denied' : 'copilot.location.unsupported'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } };
  const empty = messages.length === 0;

  return (
    <div className="app-page copilot">
      <header className="copilot-header">
        <div>
          <h1 className="page-title"><Sparkles size={22} aria-hidden="true" className="copilot-title-icon" /> {t('copilot.title')}</h1>
          <p className="page-subtitle copilot-subtitle">{t(`copilot.subtitle.${role}`)}</p>
        </div>
        <div className="copilot-header__tools">
          {role === 'admin' && <LanguageSwitcher />}
          <Badge variant={available === null ? 'neutral' : available ? 'success' : 'warning'}>
            {t(available === null ? 'copilot.status.checking' : available ? 'copilot.status.online' : 'copilot.status.unavailable')}
          </Badge>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setMessages([]); setInput(''); }} disabled={empty && !input}>
            <Plus size={14} aria-hidden="true" /> {t('copilot.new')}
          </button>
        </div>
      </header>

      <section className="copilot-panel" aria-label={t('copilot.title')}>
        <div className="copilot-thread" role="log" aria-live="polite">
          {available === false && (
            <div className="copilot-unavailable" role="status">
              <TriangleAlert size={20} aria-hidden="true" />
              <div><strong>{t('copilot.unavailable.title')}</strong><p>{t('copilot.unavailable.text')}</p></div>
            </div>
          )}
          {empty && (
            <div className="copilot-empty">
              <span className="copilot-empty__icon" aria-hidden="true"><Bot size={30} /></span>
              <h2>{t('copilot.empty.title')}</h2>
              <p>{t(`copilot.empty.text.${role}`)}</p>
              <p className="copilot-suggest__title">{t('copilot.suggest.title')}</p>
              <div className="copilot-chips">
                {SUGGESTIONS[role].map((k) => (
                  <button key={k} type="button" className="copilot-chip" disabled={available === false || busy} onClick={() => ask(t(`copilot.suggest.${k}`))}>{t(`copilot.suggest.${k}`)}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => <Message key={i} m={m} t={t} timeFmt={timeFmt} onRetry={m.error && i === messages.length - 1 ? retry : null} />)}
          {busy && (
            <div className="copilot-msg copilot-msg--assistant">
              <span className="copilot-avatar" aria-hidden="true"><Sparkles size={16} /></span>
              <div className="copilot-bubble copilot-typing"><Loader2 size={16} className="copilot-spin" aria-hidden="true" /> {t('copilot.thinking')}</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form className="copilot-composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          {role === 'tourist' && (
            <div className="copilot-loc">
              {fix ? (
                <span className="copilot-loc__on"><MapPin size={14} aria-hidden="true" /> {t('copilot.location.using', { m: fix.accuracy ?? '?' })}
                  <button type="button" className="copilot-link" onClick={() => setFix(null)}><X size={12} aria-hidden="true" /> {t('copilot.location.stop')}</button>
                </span>
              ) : (
                <button type="button" className="copilot-link" onClick={shareLocation} title={t('copilot.location.hint')}><MapPin size={14} aria-hidden="true" /> {t('copilot.location.share')}</button>
              )}
              {locError && <span className="copilot-warn" role="alert">{t(locError)}</span>}
            </div>
          )}
          <div className="copilot-composer__row">
            <textarea
              ref={inputRef}
              className="form-input copilot-input"
              rows={1}
              maxLength={1000}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={t('copilot.input.placeholder')}
              aria-label={t('copilot.input.label')}
              disabled={available === false}
            />
            {voice.supported && (
              <button type="button" className={`icon-btn copilot-mic${voice.listening ? ' copilot-mic--on' : ''}`} onClick={voice.listening ? voice.stop : voice.start} aria-pressed={voice.listening} aria-label={t(voice.listening ? 'copilot.mic.stop' : 'copilot.mic.start')} title={t(voice.listening ? 'copilot.mic.stop' : 'copilot.mic.start')} disabled={available === false}>
                {voice.listening ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
              </button>
            )}
            <button type="submit" className="btn btn--primary copilot-send" disabled={busy || !input.trim() || available === false}>
              <SendHorizontal size={16} aria-hidden="true" /> <span className="copilot-send__text">{t('copilot.send')}</span>
            </button>
          </div>
          <p className="copilot-foot" role="status">
            {voice.listening ? t('copilot.mic.listening')
              : voice.error ? t(`copilot.mic.${voice.error}`)
                : voice.supported ? t('copilot.mic.disclosure') : t('copilot.mic.unsupported')}
          </p>
          <p className="copilot-foot">{t('copilot.emergency')} {t('copilot.privacy')}</p>
        </form>
      </section>
    </div>
  );
}

/**
 * The tourist area already provides the shared English / हिन्दी / मराठी system (I18nProvider). The admin
 * area is English-only, so for the admin Copilot page ONLY we mount that same provider (same dictionaries,
 * same saved language) and show the same LanguageSwitcher — no other admin page changes.
 */
export default function CopilotPage() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <I18nProvider><Copilot /></I18nProvider> : <Copilot />;
}
