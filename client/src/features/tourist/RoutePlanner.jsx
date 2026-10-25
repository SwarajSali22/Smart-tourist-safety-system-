import { useEffect, useMemo, useState } from 'react';
import { Loader2, Route as RouteIcon, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';
import { label } from '../../shared/utils/format.js';

const COLOR = { high: '#dc2626', elevated: '#d97706', 'none-found': '#2563eb' };
const LEVEL_TEXT = { high: 'Passes through a danger zone', elevated: 'Passes through a restricted zone', 'none-found': 'No configured zone on this route' };
const LEVEL_VARIANT = { high: 'danger', elevated: 'warning', 'none-found': 'info' };

const fmtKm = (m) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
const fmtMin = (s) => (s ? `${Math.max(1, Math.round(s / 60))} min by car` : 'time unknown');

/**
 * Route safety check — a recommendation, not route history. Candidate routes are measured against
 * the zones administrators configured; it never calls a route "safe" and says so when road routing
 * data is unavailable. (Route history/replay lives on the admin map.)
 */
function RoutePlanner({ trips = [], position = null, zones = [] }) {
  const toast = useToast();
  const options = useMemo(() => {
    const o = [];
    if (position?.lat != null) o.push({ id: 'me', label: 'My latest position', lat: position.lat, lng: position.lng });
    trips.filter((t) => ['planned', 'active'].includes(t.status)).forEach((t) => t.stops.forEach((s) => o.push({ id: `${t._id}:${s._id}`, label: `${t.name} → ${s.name}`, lat: s.location.lat, lng: s.location.lng })));
    o.push({ id: 'custom', label: 'Custom coordinates…' });
    return o;
  }, [trips, position]);

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [custom, setCustom] = useState({ from: { lat: '', lng: '' }, to: { lat: '', lng: '' } });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(0);

  useEffect(() => {
    if (!fromId && options.length > 1) setFromId(options[0].id);
    if (!toId && options.length > 2) setToId(options[1].id === fromId ? options[2].id : options[1].id);
  }, [options, fromId, toId]);

  const resolve = (id, which) => {
    if (id === 'custom') {
      const lat = Number(custom[which].lat); const lng = Number(custom[which].lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && custom[which].lat !== '' && custom[which].lng !== '' ? { lat, lng } : null;
    }
    const o = options.find((x) => x.id === id);
    return o ? { lat: o.lat, lng: o.lng } : null;
  };

  async function check() {
    const from = resolve(fromId, 'from'); const to = resolve(toId, 'to');
    if (!from || !to) { setError('Choose a start and a destination (or enter valid coordinates).'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const d = await api.post('/route-risk', { from, to });
      setResult(d); setChosen(d.recommendedIndex);
    } catch (err) {
      setError(err.message || 'Could not check the route');
      toast.error(err.message || 'Could not check the route');
    } finally { setBusy(false); }
  }

  const routes = result ? result.routes.map((r) => ({
    id: `r${r.index}`, points: r.coordinates, color: r.index === chosen ? (COLOR[r.exposureLevel]) : '#94a3b8',
    weight: r.index === chosen ? 6 : 4, opacity: r.index === chosen ? 0.9 : 0.6, dashed: result.source === 'straight_line', label: `${r.label}: ${fmtKm(r.distanceM)}`,
  })) : [];
  const fit = result ? { key: `${result.routes.length}-${chosen}-${result.routes[0].distanceM}`, points: result.routes[chosen].coordinates } : null;
  const pins = result ? [
    { id: 'a', lat: result.routes[0].coordinates[0][0], lng: result.routes[0].coordinates[0][1], title: 'Start', tone: 'info' },
    { id: 'b', lat: result.routes[0].coordinates.at(-1)[0], lng: result.routes[0].coordinates.at(-1)[1], title: 'Destination', tone: 'info' },
  ] : [];

  const select = (value, onChange, aria) => (
    <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
  const coords = (which) => (
    <div className="route-custom">
      <input className="form-input" inputMode="decimal" placeholder="Latitude" value={custom[which].lat} onChange={(e) => setCustom((c) => ({ ...c, [which]: { ...c[which], lat: e.target.value } }))} aria-label={`${which} latitude`} />
      <input className="form-input" inputMode="decimal" placeholder="Longitude" value={custom[which].lng} onChange={(e) => setCustom((c) => ({ ...c, [which]: { ...c[which], lng: e.target.value } }))} aria-label={`${which} longitude`} />
    </div>
  );

  return (
    <Card title="Route safety check">
      <p className="form-hint">Compare routes against the restricted and danger zones set up by administrators. This is an estimate from that data only — it can’t tell you a route is safe.</p>
      <div className="route-form mt-4">
        <label className="fld"><span>From</span>{select(fromId, setFromId, 'Start')}{fromId === 'custom' && coords('from')}</label>
        <label className="fld"><span>To</span>{select(toId, setToId, 'Destination')}{toId === 'custom' && coords('to')}</label>
        <button type="button" className="btn btn--primary route-form__go" onClick={check} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <RouteIcon size={16} aria-hidden="true" />} {busy ? 'Checking…' : 'Check routes'}
        </button>
      </div>
      {error && <p className="form-error mt-4" role="alert">{error}</p>}

      {result && (
        <div className="reveal mt-4">
          {result.note && <p className="notice notice--warn" role="status"><TriangleAlert size={16} aria-hidden="true" /> {result.note}</p>}
          <p className="route-message"><strong>{result.message}</strong></p>
          <div className="route-grid">
            <ul className="route-list">
              {result.routes.map((r) => (
                <li key={r.index} className={r.index === chosen ? 'is-chosen' : ''}>
                  <button type="button" className="route-card" onClick={() => setChosen(r.index)} aria-pressed={r.index === chosen}>
                    <span className="route-card__head">
                      <strong>{r.label}</strong>
                      {r.index === result.recommendedIndex && result.routes.length > 1 && <Badge variant="success">Lowest zone exposure</Badge>}
                    </span>
                    <span className="form-hint">{fmtKm(r.distanceM)} · {result.source === 'straight_line' ? 'straight line' : fmtMin(r.durationS)}</span>
                    <Badge variant={LEVEL_VARIANT[r.exposureLevel]}>{LEVEL_TEXT[r.exposureLevel]}</Badge>
                    {r.zones.map((z) => <small key={z.zoneId} className="form-hint block">{z.name} ({label(z.type)}): about {z.metres} m of the route</small>)}
                    {r.recentSosNearby > 0 && <small className="form-hint block">{r.recentSosNearby} SOS alert(s) recorded within 300 m in the last 30 days</small>}
                  </button>
                </li>
              ))}
            </ul>
            <GeoMap zones={zones} routes={routes} pins={pins} fit={fit} height={320} center={[pins[0].lat, pins[0].lng]} zoom={13} allowFullscreen />
          </div>
          <p className="form-hint mt-4">{result.disclaimer} {result.zonesConsidered} zone(s) were considered.</p>
        </div>
      )}
    </Card>
  );
}

export default RoutePlanner;
