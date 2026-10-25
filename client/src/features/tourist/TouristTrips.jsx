import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2, MapPinned, Plus, Trash2, X } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useLiveLocation } from '../../shared/hooks/useLiveLocation.js';
import { sendOrQueue, useOfflineQueue } from '../../shared/offline/queue.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';
import LocationPicker from '../../shared/components/LocationPicker.jsx';
import { formatDateTime, label, sourceLabel } from '../../shared/utils/format.js';
import RoutePlanner from './RoutePlanner.jsx';

const STATUS_VARIANT = { planned: 'info', active: 'success', completed: 'neutral', cancelled: 'neutral' };
const STOP_VARIANT = { pending: 'neutral', arrived: 'success', skipped: 'neutral' };
const localInput = (d) => { const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return t.toISOString().slice(0, 16); };
const blankStop = () => ({ name: '', lat: '', lng: '', expectedArrival: localInput(new Date(Date.now() + 2 * 3600 * 1000)) });
const blankTrip = () => ({
  name: '', destination: '', startAt: localInput(new Date()), endAt: localInput(new Date(Date.now() + 8 * 3600 * 1000)),
  checkInEveryMin: 0, stops: [blankStop()],
});

function TripForm({ onCreated, onCancel }) {
  const toast = useToast();
  const [form, setForm] = useState(blankTrip);
  const [picking, setPicking] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setStop = (i, patch) => setForm((f) => ({ ...f, stops: f.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const stop = form.stops[picking];
  const point = stop && stop.lat !== '' && stop.lng !== '' && Number.isFinite(Number(stop.lat)) ? { lat: Number(stop.lat), lng: Number(stop.lng) } : null;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.destination.trim()) return setError('Give the trip a name and a destination.');
    if (new Date(form.endAt) <= new Date(form.startAt)) return setError('The end time must be after the start time.');
    for (const [i, s] of form.stops.entries()) {
      if (!s.name.trim()) return setError(`Stop ${i + 1} needs a name.`);
      if (s.lat === '' || s.lng === '' || !Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lng))) return setError(`Choose a location for stop ${i + 1} on the map.`);
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(), destination: form.destination.trim(),
        startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString(),
        checkInEveryMin: Number(form.checkInEveryMin) || 0,
        stops: form.stops.map((s) => ({ name: s.name.trim(), lat: Number(s.lat), lng: Number(s.lng), expectedArrival: new Date(s.expectedArrival).toISOString() })),
      };
      const d = await api.post('/trips', body);
      toast.success('Trip created.');
      onCreated(d.trip);
    } catch (err) {
      setError(err.message || 'Could not create the trip');
    } finally { setBusy(false); }
  }

  return (
    <Card title="Plan a trip">
      <form onSubmit={submit} noValidate className="trip-form">
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="trip-form__grid">
          <div className="fld"><label htmlFor="trip-name">Trip name</label><input id="trip-name" className="form-input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Old Delhi walk" /></div>
          <div className="fld"><label htmlFor="trip-dest">Destination</label><input id="trip-dest" className="form-input" maxLength={160} value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="City or area" /></div>
          <div className="fld"><label htmlFor="trip-start">Starts</label><input id="trip-start" className="form-input" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></div>
          <div className="fld"><label htmlFor="trip-end">Expected end</label><input id="trip-end" className="form-input" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></div>
          <div className="fld">
            <label htmlFor="trip-ci">Check-in reminders</label>
            <select id="trip-ci" className="form-input" value={form.checkInEveryMin} onChange={(e) => setForm({ ...form, checkInEveryMin: e.target.value })}>
              <option value={0}>Off</option><option value={30}>Every 30 minutes</option><option value={60}>Every hour</option><option value={120}>Every 2 hours</option><option value={240}>Every 4 hours</option>
            </select>
            <p className="fld__hint">If you miss one you get a reminder — it never raises an SOS by itself.</p>
          </div>
        </div>

        <div className="trip-form__stops">
          <p className="fs__legend">Stops</p>
          {form.stops.map((s, i) => (
            <div key={i} className={`trip-stop-edit${picking === i ? ' is-picking' : ''}`}>
              <input className="form-input" maxLength={120} placeholder={`Stop ${i + 1} name`} value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} aria-label={`Stop ${i + 1} name`} />
              <input className="form-input" type="datetime-local" value={s.expectedArrival} onChange={(e) => setStop(i, { expectedArrival: e.target.value })} aria-label={`Stop ${i + 1} expected arrival`} />
              <button type="button" className={`btn btn--sm ${picking === i ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setPicking(i)}>
                <MapPinned size={14} aria-hidden="true" /> {s.lat !== '' ? `${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}` : 'Set on map'}
              </button>
              {form.stops.length > 1 && (
                <button type="button" className="icon-btn" aria-label={`Remove stop ${i + 1}`} onClick={() => { setForm((f) => ({ ...f, stops: f.stops.filter((_, k) => k !== i) })); setPicking(0); }}><Trash2 size={16} aria-hidden="true" /></button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setForm((f) => ({ ...f, stops: [...f.stops, blankStop()] })); setPicking(form.stops.length); }}><Plus size={14} aria-hidden="true" /> Add a stop</button>
          <p className="fld__hint">Click the map to place stop {picking + 1}. Destinations are drawn from the places you choose — nothing is guessed.</p>
          <LocationPicker point={point} onPick={(lat, lng) => setStop(picking, { lat: lat.toFixed(6), lng: lng.toFixed(6) })} height={260} />
        </div>

        <div className="hc-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}><X size={16} aria-hidden="true" /> Cancel</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <CalendarClock size={16} aria-hidden="true" />} {busy ? 'Saving…' : 'Create trip'}</button>
        </div>
      </form>
    </Card>
  );
}

function TripCard({ trip, zones, position, onChange, simulatedNote }) {
  const toast = useToast();
  const queue = useOfflineQueue();
  const [confirm, setConfirm] = useState(null); // 'cancel' | 'complete'
  const [busy, setBusy] = useState(false);
  const open = ['planned', 'active'].includes(trip.status);
  const openAlerts = trip.alerts.filter((a) => !a.acknowledged);
  const pendingFor = (stopId) => queue.some((e) => e.status === 'pending' && e.path.includes(stopId));
  const checkInPending = queue.some((e) => e.status === 'pending' && e.path === `/trips/${trip._id}/check-in`);

  const pins = trip.stops.map((s, i) => ({ id: s._id, lat: s.location.lat, lng: s.location.lng, title: `${i + 1}. ${s.name}`, text: `${label(s.status)} · expected ${formatDateTime(s.expectedArrival)}`, tone: s.status === 'arrived' ? 'ok' : 'info' }));
  const path = trip.stops.map((s) => [s.location.lat, s.location.lng]);

  async function call(fn, success) {
    setBusy(true);
    try { await fn(); if (success) toast.success(success); } catch (err) { toast.error(err.message || 'That did not work'); } finally { setBusy(false); }
  }
  async function queued(spec, success) {
    setBusy(true);
    try {
      const r = await sendOrQueue(spec);
      if (r.status === 'queued') toast.warning('No connection — saved on this device and not sent yet. It will be sent automatically.', { title: 'Waiting to send' });
      else { toast.success(success); onChange(r.data.trip); }
    } catch (err) { toast.error(err.message || 'That did not work'); } finally { setBusy(false); }
  }

  return (
    <Card className={`trip-card${openAlerts.length ? ' trip-card--alert' : ''}`}>
      <div className="trip-card__head">
        <div>
          <h3 className="trip-card__title">{trip.name}</h3>
          <p className="form-hint">{trip.destination} · {formatDateTime(trip.startAt)} → {formatDateTime(trip.endAt)}</p>
        </div>
        <Badge variant={STATUS_VARIANT[trip.status]}>{label(trip.status)}</Badge>
      </div>

      {openAlerts.length > 0 && (
        <div className="callout callout--warning reveal" role="alert">
          {openAlerts.map((a, i) => <p key={i}>{a.message}</p>)}
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => call(async () => onChange((await api.post(`/trips/${trip._id}/acknowledge`, {})).trip), 'Thanks — marked as fine.')}>I’m fine</button>
        </div>
      )}

      <ul className="trip-stops">
        {trip.stops.map((s, i) => (
          <li key={s._id}>
            <span className="trip-stops__n" aria-hidden="true">{i + 1}</span>
            <span className="trip-stops__main">
              <strong>{s.name}</strong>
              <small className="form-hint block">Expected {formatDateTime(s.expectedArrival)}{s.arrivedAt ? ` · reached ${formatDateTime(s.arrivedAt)} (${s.arrivedVia === 'gps' ? 'GPS' : 'confirmed by you'})` : ''}</small>
            </span>
            <Badge variant={STOP_VARIANT[s.status]}>{label(s.status)}</Badge>
            {open && s.status === 'pending' && (
              pendingFor(s._id)
                ? <span className="badge badge--warning">Waiting to send</span>
                : <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => queued({ kind: 'trip_arrive', label: `Arrived at ${s.name}`, path: `/trips/${trip._id}/stops/${s._id}/arrive` }, `Marked as reached: ${s.name}.`)}><CheckCircle2 size={14} aria-hidden="true" /> I’ve arrived</button>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="detail-actions mt-4">
          {trip.status === 'planned' && <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => queued({ kind: 'trip_start', label: `Start trip ${trip.name}`, method: 'PATCH', path: `/trips/${trip._id}/start` }, 'Trip started.')}>Start trip</button>}
          {trip.status === 'active' && trip.checkInEveryMin > 0 && (
            checkInPending ? <span className="badge badge--warning">Check-in waiting to send</span>
              : <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => queued({ kind: 'trip_checkin', label: `Check-in: ${trip.name}`, path: `/trips/${trip._id}/check-in` }, 'Check-in confirmed.')}>Check in — I’m OK</button>
          )}
          {trip.status === 'active' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm('complete')}>Complete trip</button>}
          <button type="button" className="btn btn--ghost btn--sm btn--danger-text" onClick={() => setConfirm('cancel')}>Cancel trip</button>
          {trip.nextCheckInDue && trip.status === 'active' && <span className="form-hint">Next check-in {formatDateTime(trip.nextCheckInDue)}</span>}
        </div>
      )}
      {simulatedNote && open && <p className="form-hint mt-4">{simulatedNote}</p>}

      <div className="trip-card__map mt-4">
        <GeoMap
          zones={zones} pins={pins} routes={[{ id: 'plan', points: path, color: '#6366f1', dashed: true, weight: 3, label: 'Planned stop order' }]}
          userPosition={open ? position : null} fit={{ key: trip._id, points: path }} center={path[0]} zoom={13} height={260} allowFullscreen
        />
      </div>

      <ConfirmDialog
        open={Boolean(confirm)} danger={confirm === 'cancel'} busy={busy}
        title={confirm === 'cancel' ? 'Cancel this trip?' : 'Mark the trip as complete?'}
        message={confirm === 'cancel' ? 'Monitoring and check-in reminders stop. The trip stays in your history.' : 'Monitoring stops. Stops you did not confirm stay marked as not reached.'}
        confirmLabel={confirm === 'cancel' ? 'Cancel trip' : 'Complete'}
        onConfirm={() => call(async () => { onChange((await api.patch(`/trips/${trip._id}/${confirm}`, {})).trip); setConfirm(null); }, confirm === 'cancel' ? 'Trip cancelled.' : 'Trip completed.')}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}

function TouristTrips() {
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [zones, setZones] = useState([]);
  const [device, setDevice] = useState(null);
  const { position } = useLiveLocation();

  const load = useCallback(() => api.get('/trips').then((d) => { setTrips(d.trips || []); setError(''); }).catch((e) => setError(e.message || 'Could not load trips')), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/zones').then((d) => setZones(d.zones || [])).catch(() => {});
    api.get('/tourists/me').then((d) => setDevice(d.profile?.device || null)).catch(() => {});
  }, []);
  useOnReconnect(load);
  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    socket.on('trip:alert', load);
    return () => socket.off('trip:alert', load);
  }, [load]);

  const replace = (t) => setTrips((list) => (list || []).map((x) => (x._id === t._id ? { ...x, ...t } : x)));
  const current = useMemo(() => (trips || []).filter((t) => ['planned', 'active'].includes(t.status)), [trips]);
  const past = useMemo(() => (trips || []).filter((t) => !['planned', 'active'].includes(t.status)), [trips]);
  const livePos = position || (device?.lastLocation?.lat != null ? device.lastLocation : null);
  const simulatedNote = device?.isSimulated ? 'Your tracking device is simulated, so location-based checks (arrival and route deviation) use simulated positions.' : null;

  return (
    <div className="app-page page-stack">
      <div className="team-head">
        <div>
          <h1 className="page-title">Trips</h1>
          <p className="page-subtitle">Plan your stops, confirm when you arrive, and get a reminder if a check-in or stop is missed.</p>
        </div>
        {!creating && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Plan a trip</button>}
      </div>

      {creating && <TripForm onCancel={() => setCreating(false)} onCreated={(t) => { setCreating(false); setTrips((l) => [t, ...(l || [])]); }} />}

      {error && !trips ? <ErrorState message={error} onRetry={load} /> : !trips ? <SkeletonRows rows={4} /> : (
        <>
          <section aria-label="Current trips" className="stagger">
            <h2 className="section-title">Current and upcoming</h2>
            {current.length === 0 ? (
              <Card><EmptyState icon={CalendarClock} title="No active trips">Plan a trip with at least one stop to get reminders and arrival tracking.</EmptyState></Card>
            ) : current.map((t) => <TripCard key={t._id} trip={t} zones={zones} position={livePos} onChange={replace} simulatedNote={simulatedNote} />)}
          </section>

          <RoutePlanner trips={trips} position={livePos} zones={zones} />

          {past.length > 0 && (
            <section aria-label="Past trips">
              <h2 className="section-title">Past trips</h2>
              <Card>
                <ul className="plain-list">
                  {past.map((t) => (
                    <li key={t._id} className="status-row">
                      <span><strong>{t.name}</strong><small className="form-hint block">{t.destination} · {formatDateTime(t.startAt)} · {t.stops.filter((s) => s.status === 'arrived').length}/{t.stops.length} stops reached</small></span>
                      <Badge variant={STATUS_VARIANT[t.status]}>{label(t.status)}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}
      <p className="form-hint">{device ? `Location source: ${sourceLabel(device)}.` : 'No tracking device linked yet — arrival and deviation checks need a device or the phone’s location.'}</p>
    </div>
  );
}

export default TouristTrips;
