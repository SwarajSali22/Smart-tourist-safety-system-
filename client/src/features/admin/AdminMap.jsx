import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Copy, Crosshair, Flame, Layers, Maximize, Pause, Play, RotateCcw, Route as RouteIcon, Send, X } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useZoneSync } from '../../shared/socket/useZoneSync.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useRiskBoard } from '../../shared/hooks/useRiskBoard.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';
import { FRESH_LABEL, FRESH_VARIANT, freshnessOf, sourceOf } from '../../shared/utils/freshness.js';
import { FACTOR_LABELS, label, RISK_RANK, RISK_VARIANT, timeAgo } from '../../shared/utils/format.js';

const REPLAY_STEP_MS = 350;
const SPEEDS = [0.5, 1, 2, 4];

const touristIdOf = (d) => d.tourist?._id || d.tourist;

// Why a device has no position, in plain words (never a guess at a location).
function noLocationReason(d) {
  const src = sourceOf(d);
  if (src === 'Phone') return 'phone, waiting for its first GPS report';
  if (src === 'Simulator') return d.lastSeen ? 'simulator, no position sent' : 'simulator that has never reported';
  return d.lastSeen ? 'no position sent' : 'has never reported';
}

function AdminMap() {
  const toast = useToast();
  const now = useNow(15000);
  const [params] = useSearchParams();
  const risk = useRiskBoard();
  const [devices, setDevices] = useState([]);
  const [zones, setZones] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ risk: '', zone: '', status: '', source: '' });
  const [layers, setLayers] = useState({ zones: true, tourists: true, trail: true, heat: false });
  const [layersOpen, setLayersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [activeIncident, setActiveIncident] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [fit, setFit] = useState(null);
  const [trail, setTrail] = useState([]);
  const [heatPoints, setHeatPoints] = useState(null); // null = not loaded yet
  const [replayIdx, setReplayIdx] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [confirmCheck, setConfirmCheck] = useState(false);
  const layersRef = useRef(null);

  const loadDevices = useCallback(() => api.get('/devices')
    .then((d) => { setDevices(d.devices || []); setLoadError(''); return d.devices || []; })
    .catch((e) => { setLoadError(e.message || 'Could not load devices'); return []; }), []);

  useEffect(() => {
    loadDevices().then((list) => {
      // Deep link: /admin/map?tourist=<id> (from the risk board / directory / incidents).
      const wanted = params.get('tourist');
      const match = wanted && list.find((x) => touristIdOf(x) === wanted);
      if (match) select(match);
    });
    api.get('/zones').then((d) => setZones(d.zones || [])).catch(() => {});
    // The heatmap is only offered when there is real incident data behind it.
    api.get('/analytics/overview').then((d) => setHeatPoints(d.heatPoints || [])).catch(() => setHeatPoints([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useZoneSync(setZones);
  useOnReconnect(() => { loadDevices(); });

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    function onLoc(device) {
      setDevices((ds) => (ds.some((d) => d._id === device._id) ? ds.map((d) => (d._id === device._id ? device : d)) : [device, ...ds]));
    }
    socket.on('location:update', onLoc);
    return () => socket.off('location:update', onLoc);
  }, []);

  useEffect(() => {
    if (!layersOpen) return undefined;
    const onDoc = (e) => { if (layersRef.current && !layersRef.current.contains(e.target)) setLayersOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [layersOpen]);

  function select(device) {
    setSelectedId(device.deviceId);
    setReplayIdx(null);
    setPlaying(false);
    setTrail([]);
    setActiveIncident(null);
    if (device.lastLocation?.lat != null) setFlyTo({ ...device.lastLocation, key: `${device.deviceId}-${Date.now()}` });
    api.get(`/devices/${device.deviceId}/trail?limit=200`)
      .then((d) => setTrail(d.trail || []))
      .catch(() => toast.error('Could not load this tourist’s route.'));
    const tid = touristIdOf(device);
    if (tid) {
      api.get(`/incidents?tourist=${tid}&active=1&limit=1&sort=createdAt&order=desc`)
        .then((d) => setActiveIncident(d.incidents?.[0] || null))
        .catch(() => {});
    }
  }

  // Route replay: step through the trail points (speed-adjustable).
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setReplayIdx((i) => {
        const next = (i ?? -1) + 1;
        if (next >= trail.length) { setPlaying(false); return trail.length - 1; }
        return next;
      });
    }, REPLAY_STEP_MS / speed);
    return () => clearInterval(id);
  }, [playing, trail.length, speed]);

  const matches = useCallback((d) => {
    const q = query.trim().toLowerCase();
    if (q && !`${d.tourist?.name || ''} ${d.deviceId}`.toLowerCase().includes(q)) return false;
    if (filters.risk) {
      const lvl = risk.byTourist[touristIdOf(d)]?.level || 'none';
      if (lvl !== filters.risk) return false;
    }
    if (filters.zone && !(d.currentZones || []).map(String).includes(filters.zone)) return false;
    if (filters.status) {
      const f = freshnessOf(d.lastSeen, now);
      if (filters.status === 'emergency' ? !d.emergencyMode : f !== filters.status) return false;
    }
    if (filters.source && sourceOf(d) !== filters.source) return false;
    return true;
  }, [query, filters, risk.byTourist, now]);

  const list = useMemo(() => devices.filter(matches).sort((a, b) => {
    const ea = a.emergencyMode ? 1 : 0;
    const eb = b.emergencyMode ? 1 : 0;
    if (ea !== eb) return eb - ea;
    const ra = RISK_RANK[risk.byTourist[touristIdOf(a)]?.level] ?? -1;
    const rb = RISK_RANK[risk.byTourist[touristIdOf(b)]?.level] ?? -1;
    return rb - ra;
  }), [devices, matches, risk.byTourist]);

  const trails = layers.trail && trail.length > 1 ? [{ id: 'trail', points: trail.map((p) => [p.lat, p.lng]) }] : [];
  const replayPoint = replayIdx != null ? trail[replayIdx] : null;
  const selected = devices.find((d) => d.deviceId === selectedId);
  const selectedRisk = selected ? risk.byTourist[touristIdOf(selected)] : null;
  const selectedZones = selected ? zones.filter((z) => (selected.currentZones || []).map(String).includes(String(z._id))) : [];
  const hasHeat = (heatPoints || []).length > 0;
  const filtersOn = Object.values(filters).some(Boolean) || query.trim();

  // Honest "why is nobody on the map" list: devices that exist but have never reported a position.
  const unlocated = devices.filter((d) => d.lastLocation?.lat == null);

  function fitAll() {
    const pts = list.filter((d) => d.lastLocation?.lat != null).map((d) => [d.lastLocation.lat, d.lastLocation.lng]);
    if (pts.length === 0) { toast.info('No tourists with a known position to fit.'); return; }
    setFit({ key: Date.now(), points: pts });
  }
  function recenter() {
    if (selected?.lastLocation?.lat != null) setFlyTo({ ...selected.lastLocation, key: `${selected.deviceId}-${Date.now()}` });
  }
  function playPause() {
    if (!playing && (replayIdx == null || replayIdx >= trail.length - 1)) setReplayIdx(0);
    setPlaying((p) => !p);
  }
  async function copyCoords() {
    const { lat, lng } = selected.lastLocation;
    try { await navigator.clipboard.writeText(`${lat}, ${lng}`); toast.success('Coordinates copied.'); } catch { toast.error('Couldn’t copy automatically.'); }
  }
  async function sendCheckIn() {
    setConfirmCheck(false);
    try {
      await api.post('/safety-checks/trigger', { tourist: touristIdOf(selected) });
      toast.success(`Check-in sent to ${selected.tourist?.name || 'the tourist'}. They have 5 minutes to answer before it escalates.`);
    } catch (err) {
      toast.error(`Couldn’t send the check-in: ${err.message || 'request failed'}`);
    }
  }

  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const sel = (key, options, aria) => (
    <select className="form-input form-input--sm" value={filters[key]} onChange={setFilter(key)} aria-label={aria}>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );

  return (
    <div className="app-page app-page--wide">
      <h1 className="page-title">Live map</h1>
      <p className="page-subtitle">Every tourist, coloured by risk. Grey means the data is stale or offline. Select one for details, their route and a replay.</p>

      {loadError && <ErrorState compact message={loadError} onRetry={loadDevices} />}

      {unlocated.length > 0 && (
        <p className="notice notice--warn" role="status">
          {unlocated.length} of {devices.length} tracked {devices.length === 1 ? 'tourist has' : 'tourists have'} no location yet, so {unlocated.length === 1 ? 'they are' : 'they are'} not on the map:{' '}
          {unlocated.slice(0, 5).map((d) => `${d.tourist?.name || d.deviceId} (${noLocationReason(d)})`).join('; ')}
          {unlocated.length > 5 ? `; +${unlocated.length - 5} more` : ''}. A check-in answer does not include a position.
        </p>
      )}

      <div className="livemap">
        <div className="livemap__map">
          <div className="map-toolbar">
            <button type="button" className="btn btn--sm btn--ghost" onClick={fitAll}><Maximize size={14} aria-hidden="true" /> Fit all</button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={recenter} disabled={!selected?.lastLocation} title={selected ? 'Center on the selected tourist' : 'Select a tourist first'}>
              <Crosshair size={14} aria-hidden="true" /> Recenter
            </button>
            <div className="layers" ref={layersRef}>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} aria-haspopup="true">
                <Layers size={14} aria-hidden="true" /> Layers
              </button>
              {layersOpen && (
                <div className="layers__menu" role="group" aria-label="Map layers">
                  {[['zones', 'Zones'], ['tourists', 'Tourists'], ['trail', 'Selected route']].map(([k, t]) => (
                    <label key={k} className="check-label"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} /> {t}</label>
                  ))}
                  <label className="check-label" title={hasHeat ? '' : 'No incident locations have been recorded yet'}>
                    <input type="checkbox" checked={layers.heat} disabled={!hasHeat} onChange={(e) => setLayers((l) => ({ ...l, heat: e.target.checked }))} />
                    <Flame size={13} aria-hidden="true" /> Incident heatmap {heatPoints === null ? '(loading…)' : !hasHeat ? '(no data yet)' : `(${heatPoints.length} points)`}
                  </label>
                </div>
              )}
            </div>
            {selected && trail.length > 1 && (
              <div className="replay" role="group" aria-label="Route replay">
                <button type="button" className="btn btn--sm btn--ghost" onClick={playPause}>
                  {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                  {playing ? 'Pause' : 'Replay route'}
                </button>
                <input type="range" min={0} max={trail.length - 1} value={replayIdx ?? 0} onChange={(e) => { setPlaying(false); setReplayIdx(Number(e.target.value)); }} aria-label="Replay position" />
                <select className="form-input form-input--sm" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed">
                  {SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
                </select>
                <button type="button" className="icon-btn" onClick={() => { setPlaying(false); setReplayIdx(null); }} aria-label="Reset replay"><RotateCcw size={14} aria-hidden="true" /></button>
                <small className="form-hint">{replayPoint ? new Date(replayPoint.timestamp).toLocaleTimeString() : `${trail.length} points`}</small>
              </div>
            )}
          </div>
          <GeoMap
            zones={zones}
            devices={devices.filter(matches)}
            riskByTourist={risk.byTourist}
            trails={trails}
            heatPoints={layers.heat && hasHeat ? heatPoints : []}
            replayPoint={replayPoint}
            selectedDeviceId={selectedId}
            onSelectDevice={select}
            flyTo={flyTo}
            fit={fit}
            autoFit
            showZones={layers.zones}
            showDevices={layers.tourists}
            height={560}
            allowFullscreen
            showLegend
          />
        </div>

        <aside className="livemap__panel" aria-label="Tourists">
          {selected && (
            <section className="selected-panel" aria-label="Selected tourist">
              <div className="selected-panel__head">
                <strong>{selected.tourist?.name || selected.deviceId}</strong>
                <button type="button" className="icon-btn" onClick={() => { setSelectedId(null); setTrail([]); setActiveIncident(null); }} aria-label="Close details"><X size={16} aria-hidden="true" /></button>
              </div>
              <div className="badge-row">
                <Badge variant="neutral">{sourceOf(selected)}</Badge>
                <Badge variant={FRESH_VARIANT[freshnessOf(selected.lastSeen, now)]}>{FRESH_LABEL[freshnessOf(selected.lastSeen, now)]}</Badge>
                {selected.emergencyMode && <Badge variant="danger">SOS</Badge>}
                {(selected.isSimulated || selected.tourist?.isDemo) && <Badge variant="info">Simulated</Badge>}
              </div>
              <dl className="kv">
                <dt>Risk</dt>
                <dd>{selectedRisk ? <><Badge variant={RISK_VARIANT[selectedRisk.level]}>{label(selectedRisk.level)}</Badge> {selectedRisk.ruleTriggered ? `rule: ${label(selectedRisk.ruleName)}` : `${selectedRisk.score}/100`}</> : 'Not assessed yet'}</dd>
                {selectedRisk && !selectedRisk.ruleTriggered && (
                  <><dt>Why</dt><dd>{Object.entries(selectedRisk.factors || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => FACTOR_LABELS[k] || k).join(', ') || 'No contributing factors'}</dd></>
                )}
                <dt>In zone</dt><dd>{selectedZones.length ? selectedZones.map((z) => `${z.name} (${label(z.type)})`).join(', ') : 'Not inside any zone'}</dd>
                <dt>Last seen</dt><dd>{selected.lastSeen ? timeAgo(selected.lastSeen, now) : 'never'}</dd>
                <dt>Battery</dt><dd>{typeof selected.battery === 'number' ? `${selected.battery}%` : '—'}</dd>
                {selected.lastLocation?.lat != null && (
                  <><dt>Position</dt><dd>{selected.lastLocation.lat.toFixed(5)}, {selected.lastLocation.lng.toFixed(5)} <button type="button" className="icon-btn" onClick={copyCoords} aria-label="Copy coordinates"><Copy size={13} aria-hidden="true" /></button></dd></>
                )}
              </dl>
              <div className="detail-actions">
                {activeIncident && <Link className="btn btn--danger btn--sm" to={`/admin/incidents/${activeIncident._id}`}>Open incident ({label(activeIncident.status)})</Link>}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmCheck(true)}><Send size={14} aria-hidden="true" /> Request check-in</button>
              </div>
            </section>
          )}

          <input type="search" className="form-input" placeholder="Search tourists or devices" aria-label="Search tourists or devices" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="filter-grid">
            {sel('risk', [['', 'Any risk'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['none', 'Not assessed']], 'Filter by risk')}
            {sel('status', [['', 'Any data'], ['live', 'Live'], ['stale', 'Stale'], ['offline', 'Offline'], ['emergency', 'In emergency']], 'Filter by data freshness')}
            {sel('source', [['', 'Any source'], ['Phone', 'Phone'], ['Wristband', 'Wristband'], ['Simulator', 'Simulator']], 'Filter by source')}
            {sel('zone', [['', 'Any zone'], ...zones.map((z) => [z._id, z.name])], 'Filter by zone')}
          </div>
          {filtersOn && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setQuery(''); setFilters({ risk: '', zone: '', status: '', source: '' }); }}>
              Clear filters ({list.length} of {devices.length} shown)
            </button>
          )}
          {list.length === 0 ? (
            <EmptyState icon={RouteIcon} title={filtersOn ? 'No tourists match these filters' : 'No devices to show'} action={!filtersOn && <Link className="btn btn--primary btn--sm" to="/admin/devices">Register a device</Link>}>
              {filtersOn ? 'Clear the filters to see everyone.' : 'Phones appear here when a tourist shares their location; wristbands once registered.'}
            </EmptyState>
          ) : (
            <ul className="tourist-list">
              {list.map((d) => {
                const r = risk.byTourist[touristIdOf(d)];
                const fresh = freshnessOf(d.lastSeen, now);
                return (
                  <li key={d._id}>
                    <button type="button" className={`tourist-item${selectedId === d.deviceId ? ' tourist-item--active' : ''}${fresh !== 'live' ? ' tourist-item--stale' : ''}`} onClick={() => select(d)} aria-pressed={selectedId === d.deviceId}>
                      <span className="tourist-item__name">{d.tourist?.name || d.deviceId}</span>
                      <span className="tourist-item__badges">
                        <Badge variant="neutral">{sourceOf(d)}</Badge>
                        {d.emergencyMode && <Badge variant="danger">SOS</Badge>}
                        {r && <Badge variant={RISK_VARIANT[r.level]}>{label(r.level)} {r.score}</Badge>}
                        <Badge variant={FRESH_VARIANT[fresh]}>{FRESH_LABEL[fresh]}</Badge>
                      </span>
                      <small className="form-hint">{label(d.status)} · {timeAgo(d.lastSeen, now)}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCheck}
        title="Send a safety check-in?"
        message={selected ? `${selected.tourist?.name || 'The tourist'} will be asked “Are you safe?” right now. If they don’t answer within the response window, it escalates automatically.` : ''}
        confirmLabel="Send check-in"
        onConfirm={sendCheckIn}
        onCancel={() => setConfirmCheck(false)}
      />
    </div>
  );
}

export default AdminMap;
