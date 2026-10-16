import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing } from 'lucide-react';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useZoneSync } from '../../shared/socket/useZoneSync.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useRiskBoard } from '../../shared/hooks/useRiskBoard.js';
import { useNow } from '../../shared/hooks/useNow.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';
import RiskBoard from '../../shared/components/RiskBoard.jsx';
import AttentionPanel from './AttentionPanel.jsx';
import { BarChart } from '../../shared/components/Charts.jsx';
import { label, timeAgo } from '../../shared/utils/format.js';

const SOS_BADGE = { active: 'danger', acknowledged: 'warning', resolved: 'success', false_alarm: 'neutral' };

const upsert = (list, item) => {
  const exists = list.some((e) => e._id === item._id);
  return exists ? list.map((e) => (e._id === item._id ? item : e)) : [item, ...list];
};

/**
 * Admin dashboard landing page. Everything here is live: devices/locations,
 * SOS events, incidents and risk scores all update over Socket.IO.
 */
function AdminHome() {
  const { user } = useAuth();
  const now = useNow(30000);
  const [devices, setDevices] = useState([]);
  const [zones, setZones] = useState([]);
  const [sosEvents, setSosEvents] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [trend, setTrend] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(() => Date.now());
  const risk = useRiskBoard();

  useEffect(() => {
    api.get('/devices').then((data) => setDevices(data.devices || [])).catch(() => {});
    api.get('/zones').then((data) => setZones(data.zones || [])).catch(() => {});
    api.get('/sos').then((data) => setSosEvents(data.events || [])).catch(() => {});
    api.get('/incidents').then((data) => setIncidents(data.incidents || [])).catch(() => {});
    api.get('/analytics/overview')
      .then((d) => setTrend(d.incidentsByDay.map((x) => ({
        label: new Date(`${x.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        short: new Date(`${x.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric' }),
        value: x.count,
      }))))
      .catch(() => {});
  }, []);

  useZoneSync(setZones);

  // After a socket reconnect, refetch what we may have missed while offline
  // (zones refetch themselves via useZoneSync, risk via useRiskBoard).
  useOnReconnect(() => {
    api.get('/devices').then((d) => setDevices(d.devices || [])).catch(() => {});
    api.get('/sos').then((d) => setSosEvents(d.events || [])).catch(() => {});
    api.get('/incidents').then((d) => setIncidents(d.incidents || [])).catch(() => {});
  });

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    const touch = () => setLastUpdate(Date.now());

    function onLocationUpdate(device) { setDevices((ds) => upsert(ds, device)); touch(); }
    function onSosTriggered({ sosEvent, incident }) {
      setSosEvents((es) => upsert(es, sosEvent));
      setIncidents((is) => upsert(is, incident));
      touch();
    }
    function onSosUpdated(sosEvent) { setSosEvents((es) => upsert(es, sosEvent)); touch(); }
    function onIncidentUpdated(incident) { setIncidents((is) => upsert(is, incident)); touch(); }

    socket.on('location:update', onLocationUpdate);
    socket.on('sos:triggered', onSosTriggered);
    socket.on('sos:updated', onSosUpdated);
    socket.on('incident:updated', onIncidentUpdated);
    return () => {
      socket.off('location:update', onLocationUpdate);
      socket.off('sos:triggered', onSosTriggered);
      socket.off('sos:updated', onSosUpdated);
      socket.off('incident:updated', onIncidentUpdated);
    };
  }, []);

  const openSosCount = sosEvents.filter((e) => e.status === 'active' || e.status === 'acknowledged').length;
  const openIncidentCount = incidents.filter((i) => i.status === 'open' || i.status === 'in_progress').length;
  const recentAlerts = sosEvents.slice(0, 5);

  const STATS = [
    { label: 'Active tourists',    value: devices.filter((d) => d.status === 'active' || d.status === 'emergency').length, note: 'devices reporting' },
    { label: 'Active SOS alerts',  value: openSosCount, note: openSosCount ? 'needs attention' : 'all clear' },
    { label: 'Open incidents',     value: openIncidentCount, note: 'open or in progress' },
    { label: 'Registered devices', value: devices.length, note: `${devices.filter((d) => d.isSimulated).length} simulated` },
  ];

  return (
    <div className="app-page">
      <h1 className="page-title">Welcome back, {user?.name}</h1>
      <p className="page-subtitle">
        Live overview · updated {timeAgo(lastUpdate, now)}
      </p>

      <AttentionPanel sosEvents={sosEvents} incidents={incidents} now={now} />

      <div className="stats-grid">
        {STATS.map((s) => (
          <Card key={s.label} className="stat-card">
            <p className="stat-card__value">{s.value}</p>
            <p className="stat-card__label">{s.label}</p>
            <p className="stat-card__note">{s.note}</p>
          </Card>
        ))}
      </div>

      <div className="dashboard-grid">
        <Card title="Live map" className="dash-map">
          <GeoMap zones={zones} devices={devices} riskByTourist={risk.byTourist} height={340} allowFullscreen showLegend />
          <p className="form-hint mt-4">
            <Link to="/admin/map">Open the full live map →</Link> for trails, replay and the incident heatmap.
          </p>
        </Card>

        <Card title="Risk board">
          <RiskBoard assessments={risk.assessments} loading={risk.loading} error={risk.error} />
        </Card>

        <Card title="Recent SOS alerts">
          {recentAlerts.length === 0 ? (
            <EmptyState icon={BellRing} title="No SOS alerts yet" action={<Link className="btn btn--ghost btn--sm" to="/admin/zones">Review safety zones</Link>}>
              Alerts appear here instantly when a tourist presses SOS.
            </EmptyState>
          ) : (
            <ul className="plain-list">
              {recentAlerts.map((e) => (
                <li key={e._id} className="status-row">
                  <span>
                    <Link to="/admin/incidents">{e.tourist?.name || 'Unknown tourist'}</Link>
                    <small className="form-hint block">{label(e.source)} · {timeAgo(e.createdAt, now)}</small>
                  </span>
                  <Badge variant={SOS_BADGE[e.status]}>{label(e.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Incidents, last 14 days">
          {trend ? <BarChart data={trend} title="Incidents per day" unit="incidents" /> : <p className="placeholder-text">Loading trend…</p>}
        </Card>
      </div>
    </div>
  );
}

export default AdminHome;
