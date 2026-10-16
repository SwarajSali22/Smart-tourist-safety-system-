import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Flame, Pause, Play, RotateCcw, Route as RouteIcon } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useZoneSync } from '../../shared/socket/useZoneSync.js';
import { useRiskBoard } from '../../shared/hooks/useRiskBoard.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';
import { label, RISK_RANK, RISK_VARIANT, STALE_MS, timeAgo } from '../../shared/utils/format.js';

const REPLAY_STEP_MS = 350;

function AdminMap() {
  const toast = useToast();
  const now = useNow(15000);
  const [params] = useSearchParams();
  const risk = useRiskBoard();
  const [devices, setDevices] = useState([]);
  const [zones, setZones] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [trail, setTrail] = useState([]);
  const [heat, setHeat] = useState(null); // null = off
  const [replayIdx, setReplayIdx] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    api.get('/devices')
      .then((d) => {
        const list = d.devices || [];
        setDevices(list);
        // Deep link: /admin/map?tourist=<id> (from the risk board / directory).
        const wanted = params.get('tourist');
        const match = wanted && list.find((x) => (x.tourist?._id || x.tourist) === wanted);
        if (match) select(match);
      })
      .catch((e) => toast.error(e.message));
    api.get('/zones').then((d) => setZones(d.zones || [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useZoneSync(setZones);

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    function onLoc(device) {
      setDevices((ds) => (ds.some((d) => d._id === device._id) ? ds.map((d) => (d._id === device._id ? device : d)) : [device, ...ds]));
    }
    socket.on('location:update', onLoc);
    return () => socket.off('location:update', onLoc);
  }, []);

  function select(device) {
    setSelectedId(device.deviceId);
    setReplayIdx(null);
    setPlaying(false);
    setTrail([]);
    if (device.lastLocation?.lat != null) setFlyTo({ ...device.lastLocation, key: `${device.deviceId}-${Date.now()}` });
    api.get(`/devices/${device.deviceId}/trail?limit=200`)
      .then((d) => setTrail(d.trail || []))
      .catch(() => toast.error('Could not load this tourist’s route.'));
  }

  async function toggleHeat() {
    if (heat) { setHeat(null); return; }
    try {
      const d = await api.get('/analytics/overview');
      setHeat(d.heatPoints || []);
      if ((d.heatPoints || []).length === 0) toast.info('No incident locations recorded yet.');
    } catch (e) {
      toast.error(e.message || 'Could not load the heatmap.');
    }
  }

  // Route replay: step through the trail points.
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setReplayIdx((i) => {
        const next = (i ?? -1) + 1;
        if (next >= trail.length) { setPlaying(false); return trail.length - 1; }
        return next;
      });
    }, REPLAY_STEP_MS);
    return () => clearInterval(id);
  }, [playing, trail.length]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices
      .filter((d) => !q || `${d.tourist?.name || ''} ${d.deviceId}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const ea = a.emergencyMode ? 1 : 0;
        const eb = b.emergencyMode ? 1 : 0;
        if (ea !== eb) return eb - ea;
        const ra = RISK_RANK[risk.byTourist[a.tourist?._id]?.level] ?? -1;
        const rb = RISK_RANK[risk.byTourist[b.tourist?._id]?.level] ?? -1;
        return rb - ra;
      });
  }, [devices, query, risk.byTourist]);

  const trails = trail.length > 1 ? [{ id: 'trail', points: trail.map((p) => [p.lat, p.lng]) }] : [];
  const replayPoint = replayIdx != null ? trail[replayIdx] : null;
  const selected = devices.find((d) => d.deviceId === selectedId);

  function playPause() {
    if (!playing && (replayIdx == null || replayIdx >= trail.length - 1)) setReplayIdx(0);
    setPlaying((p) => !p);
  }

  return (
    <div className="dashboard-page app-page app-page--wide">
      <h1 className="page-title">Live map</h1>
      <p className="page-subtitle">Every tourist, coloured by risk. Select one to see their route and replay it.</p>

      <div className="livemap">
        <div className="livemap__map">
          <div className="map-toolbar">
            <button type="button" className={`btn btn--sm ${heat ? 'btn--primary' : 'btn--ghost'}`} onClick={toggleHeat} aria-pressed={Boolean(heat)}>
              <Flame size={14} aria-hidden="true" /> Incident heatmap
            </button>
            {selected && trail.length > 1 && (
              <div className="replay" role="group" aria-label="Route replay">
                <button type="button" className="btn btn--sm btn--ghost" onClick={playPause}>
                  {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                  {playing ? 'Pause' : 'Replay route'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={trail.length - 1}
                  value={replayIdx ?? 0}
                  onChange={(e) => { setPlaying(false); setReplayIdx(Number(e.target.value)); }}
                  aria-label="Replay position"
                />
                <button type="button" className="icon-btn" onClick={() => { setPlaying(false); setReplayIdx(null); }} aria-label="Reset replay">
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
                <small className="form-hint">
                  {replayPoint ? new Date(replayPoint.timestamp).toLocaleTimeString() : `${trail.length} points`}
                </small>
              </div>
            )}
          </div>
          <GeoMap
            zones={zones}
            devices={devices}
            riskByTourist={risk.byTourist}
            trails={trails}
            heatPoints={heat || []}
            replayPoint={replayPoint}
            selectedDeviceId={selectedId}
            onSelectDevice={select}
            flyTo={flyTo}
            height={560}
            allowFullscreen
            showLegend
          />
        </div>

        <aside className="livemap__panel" aria-label="Tourists">
          <input
            type="search"
            className="form-input"
            placeholder="Search tourists or devices"
            aria-label="Search tourists or devices"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {list.length === 0 ? (
            <EmptyState icon={RouteIcon} title="No devices to show">Register a device and start the simulator to see tourists here.</EmptyState>
          ) : (
            <ul className="tourist-list">
              {list.map((d) => {
                const r = risk.byTourist[d.tourist?._id];
                const stale = d.status === 'active' && d.lastSeen && now - new Date(d.lastSeen).getTime() > STALE_MS;
                return (
                  <li key={d._id}>
                    <button
                      type="button"
                      className={`tourist-item${selectedId === d.deviceId ? ' tourist-item--active' : ''}`}
                      onClick={() => select(d)}
                      aria-pressed={selectedId === d.deviceId}
                    >
                      <span className="tourist-item__name">{d.tourist?.name || d.deviceId}</span>
                      <span className="tourist-item__badges">
                        {d.emergencyMode && <Badge variant="danger">SOS</Badge>}
                        {r && <Badge variant={RISK_VARIANT[r.level]}>{label(r.level)} {r.score}</Badge>}
                        {stale && <Badge variant="warning">Silent</Badge>}
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
    </div>
  );
}

export default AdminMap;
