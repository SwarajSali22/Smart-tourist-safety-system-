import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, FileDown, FileText, Minus } from 'lucide-react';
import { api } from '../../api/client.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useRiskBoard } from '../../shared/hooks/useRiskBoard.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { BarChart, HBarChart } from '../../shared/components/Charts.jsx';
import { downloadServerFile } from '../../shared/utils/csv.js';
import { label } from '../../shared/utils/format.js';

const RANGES = [['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['custom', 'Custom range']];
const TYPES = [['', 'All types'], ['sos', 'SOS'], ['geofence_violation', 'Zone violation'], ['no_response', 'Missed check-in'], ['risk_escalation', 'Risk escalation'], ['other', 'Other']];
const SEVERITIES = [['', 'All severities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const STATUSES = [['', 'All statuses'], ['open', 'New'], ['in_progress', 'Acknowledged'], ['assigned', 'Assigned'], ['en_route', 'En route'], ['resolved', 'Resolved'], ['closed', 'Closed']];

const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`);

/** Change versus the previous period; `goodWhen` says whether an increase is good or bad. */
function Delta({ value, goodWhen = 'down' }) {
  if (value == null) return <span className="delta delta--flat">no earlier data</span>;
  if (value === 0) return <span className="delta delta--flat"><Minus size={12} aria-hidden="true" /> unchanged</span>;
  const up = value > 0;
  const good = (goodWhen === 'down') !== up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`delta ${good ? 'delta--good' : 'delta--bad'}`}><Icon size={12} aria-hidden="true" /> {Math.abs(value)}% vs previous</span>;
}

function Analytics() {
  const toast = useToast();
  const navigate = useNavigate();
  const risk = useRiskBoard();
  const [params, setParams] = useSearchParams();
  const range = params.get('range') || '7d';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const type = params.get('type') || '';
  const severity = params.get('severity') || '';
  const status = params.get('status') || '';
  const tourist = params.get('tourist') || '';
  const lat = params.get('lat') || '';
  const lng = params.get('lng') || '';
  const radiusKm = params.get('radiusKm') || '';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tourists, setTourists] = useState([]);
  const [busy, setBusy] = useState('');

  const setParam = (changes) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    Object.entries(changes).forEach(([k, v]) => { if (v === '' || v == null) next.delete(k); else next.set(k, v); });
    return next;
  }, { replace: true });

  useEffect(() => { api.get('/tourists').then((d) => setTourists(d.tourists || d.users || [])).catch(() => {}); }, []);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('range', range);
    if (range === 'custom') { if (from) sp.set('from', from); if (to) sp.set('to', to); }
    if (type) sp.set('type', type);
    if (severity) sp.set('severity', severity);
    if (status) sp.set('status', status);
    if (tourist) sp.set('tourist', tourist);
    if (lat && lng && radiusKm) { sp.set('lat', lat); sp.set('lng', lng); sp.set('radiusKm', radiusKm); }
    return sp.toString();
  }, [range, from, to, type, severity, status, tourist, lat, lng, radiusKm]);

  const customIncomplete = range === 'custom' && !from;

  const load = useCallback(() => {
    if (customIncomplete) { setLoading(false); return Promise.resolve(); }
    return api.get(`/analytics/report?${queryString}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message || 'Could not load analytics'))
      .finally(() => setLoading(false));
  }, [queryString, customIncomplete]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); load(); }, [load]);
  useOnReconnect(load);

  async function download(kind) {
    setBusy(kind);
    try {
      await downloadServerFile(`/analytics/report.${kind}?${queryString}`, kind === 'pdf' ? 'sts-analytics-report.pdf' : 'incident-report.csv');
      toast.success(kind === 'pdf' ? 'PDF report downloaded.' : 'CSV exported with the selected filters.');
    } catch (err) {
      toast.error(`Couldn’t export: ${err.message}`);
    } finally { setBusy(''); }
  }

  // Drill-down: open the incident list scoped to the clicked metric and the selected period.
  const drill = (extra) => {
    const sp = new URLSearchParams();
    if (data) { sp.set('from', data.range.from.slice(0, 10)); sp.set('to', data.range.to.slice(0, 10)); }
    if (type) sp.set('type', type);
    if (severity) sp.set('severity', severity);
    Object.entries(extra).forEach(([k, v]) => v && sp.set(k, v));
    navigate(`/admin/incidents?${sp}`);
  };

  const s = data?.summary;
  const c = data?.comparison;
  const levels = ['critical', 'high', 'medium', 'low'].map((lvl) => ({ label: label(lvl), value: risk.current.filter((a) => a.level === lvl).length }));
  const hasFilters = Boolean(type || severity || status || tourist || (lat && lng && radiusKm));

  const sel = (value, key, options, aria) => (
    <label className="filter filter--fill"><span className="sr-only">{aria}</span>
      <select className="form-input" value={value} onChange={(e) => setParam({ [key]: e.target.value })} aria-label={aria}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );

  return (
    <div className="app-page page-stack">
      <div className="team-head">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Incident trends, response times and zone violations from live data</p>
        </div>
        <div className="detail-actions">
          <button type="button" className="btn btn--ghost" disabled={Boolean(busy) || customIncomplete} onClick={() => download('csv')}><FileDown size={16} aria-hidden="true" /> {busy === 'csv' ? 'Exporting…' : 'Export CSV'}</button>
          <button type="button" className="btn btn--primary" disabled={Boolean(busy) || customIncomplete} onClick={() => download('pdf')}><FileText size={16} aria-hidden="true" /> {busy === 'pdf' ? 'Building PDF…' : 'Download PDF report'}</button>
        </div>
      </div>

      <Card className="filter-card">
        <div className="filter-block">
          <span className="filter-block__label">Period</span>
          <div className="segmented" role="tablist" aria-label="Date range">
            {RANGES.map(([v, t]) => (
              <button key={v} type="button" role="tab" aria-selected={range === v} className={`segmented__btn${range === v ? ' is-active' : ''}`} onClick={() => setParam({ range: v })}>{t}</button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="filter-grid-2 reveal">
              <label className="fld"><span>From</span><input className="form-input" type="date" value={from} max={to || undefined} onChange={(e) => setParam({ from: e.target.value })} aria-label="From date" /></label>
              <label className="fld"><span>To</span><input className="form-input" type="date" value={to} min={from || undefined} onChange={(e) => setParam({ to: e.target.value })} aria-label="To date" /></label>
              {customIncomplete && <p className="form-hint filter-block__note">Choose a start date (ranges are capped at 92 days).</p>}
            </div>
          )}
        </div>

        <div className="filter-block">
          <span className="filter-block__label">Filters</span>
          <div className="filter-grid-4">
            {sel(type, 'type', TYPES, 'Incident type')}
            {sel(severity, 'severity', SEVERITIES, 'Severity')}
            {sel(status, 'status', STATUSES, 'Status')}
            {sel(tourist, 'tourist', [['', 'All tourists'], ...tourists.map((t) => [t._id || t.id, t.name])], 'Tourist')}
          </div>
        </div>

        <div className="filter-block">
          <span className="filter-block__label">Area <span className="form-hint">(optional)</span></span>
          <div className="filter-grid-3">
            <label className="fld"><span>Centre latitude</span><input className="form-input" inputMode="decimal" placeholder="e.g. 28.61" value={lat} onChange={(e) => setParam({ lat: e.target.value })} /></label>
            <label className="fld"><span>Centre longitude</span><input className="form-input" inputMode="decimal" placeholder="e.g. 77.21" value={lng} onChange={(e) => setParam({ lng: e.target.value })} /></label>
            <label className="fld"><span>Radius (km)</span><input className="form-input" inputMode="decimal" placeholder="e.g. 5" value={radiusKm} onChange={(e) => setParam({ radiusKm: e.target.value })} /></label>
          </div>
          <p className="form-hint filter-block__note">Uses the recorded location of SOS and zone events; incidents without a location are left out when an area is set.</p>
        </div>

        <div className="filter-card__foot">
          {data ? <span className="form-hint">Showing {new Date(data.range.from).toLocaleString()} – {new Date(data.range.to).toLocaleString()}</span> : <span />}
          {hasFilters && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setParam({ type: '', severity: '', status: '', tourist: '', lat: '', lng: '', radiusKm: '' })}>Clear filters</button>}
        </div>
      </Card>

      {error && !data ? (
        <ErrorState message={error} onRetry={() => { setLoading(true); load(); }} />
      ) : !data ? (
        customIncomplete ? <EmptyState title="Pick a start date">Choose when the custom range begins.</EmptyState> : <SkeletonRows rows={8} />
      ) : (
        <div className={`analytics-body${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
          {error && <ErrorState compact message={`${error} Showing the last data we had.`} onRetry={load} />}
          {data.truncated && <p className="notice notice--warn">Very large result — only the first 20,000 incidents are included.</p>}

          <div className="stats-grid stagger">
            <button type="button" className="stat-link stat-link--btn" onClick={() => drill({})}>
              <Card className="stat-card"><p className="stat-card__value">{s.totalIncidents}</p><p className="stat-card__label">Total incidents</p><p className="stat-card__note"><Delta value={c.changePct.totalIncidents} /></p></Card>
            </button>
            <button type="button" className="stat-link stat-link--btn" onClick={() => navigate('/admin/incidents?type=sos&active=1')}>
              <Card className="stat-card"><p className="stat-card__value">{s.activeSos}</p><p className="stat-card__label">Active SOS alerts</p><p className="stat-card__note">right now, any period</p></Card>
            </button>
            <button type="button" className="stat-link stat-link--btn" onClick={() => drill({ status: 'resolved' })}>
              <Card className="stat-card"><p className="stat-card__value">{s.resolvedIncidents}</p><p className="stat-card__label">Resolved incidents</p><p className="stat-card__note"><Delta value={c.changePct.resolvedIncidents} goodWhen="up" /></p></Card>
            </button>
            <button type="button" className="stat-link stat-link--btn" onClick={() => drill({ type: 'geofence_violation' })}>
              <Card className="stat-card"><p className="stat-card__value">{s.geofenceViolations}</p><p className="stat-card__label">Geofence violations</p><p className="stat-card__note"><Delta value={c.changePct.geofenceViolations} /></p></Card>
            </button>
            <Card className="stat-card"><p className="stat-card__value">{fmtMin(s.avgResponseMin)}</p><p className="stat-card__label">Avg. response time</p><p className="stat-card__note">{s.responseSamples ? `${s.responseSamples} acknowledged` : 'none acknowledged yet'} · <Delta value={c.changePct.avgResponseMin} /></p></Card>
          </div>

          <div className="dashboard-grid dashboard-grid--even stagger">
            <Card title={`Incident trend (per ${data.trend.granularity})`}>
              {s.totalIncidents === 0 ? <EmptyState title="No incidents in this period" /> : (
                <BarChart
                  data={data.trend.buckets.map((b) => ({ label: b.label, short: data.trend.granularity === 'hour' ? b.label.slice(0, 2) : b.label.split(' ')[0], value: b.count, from: b.from, to: b.to }))}
                  title="Incident trend" unit="incidents"
                  onSelect={(b) => b.value && navigate(`/admin/incidents?from=${b.from.slice(0, 10)}&to=${b.to.slice(0, 10)}${type ? `&type=${type}` : ''}${severity ? `&severity=${severity}` : ''}`)}
                />
              )}
              <p className="form-hint mt-4">Select a bar to open that day’s incidents.</p>
            </Card>

            <Card title="Severity distribution">
              {data.severity.length === 0 ? <EmptyState title="No incidents in this period" /> : (
                <HBarChart title="Incidents by severity" data={data.severity.map((d) => ({ label: label(d.key), value: d.count, key: d.key }))} onSelect={(d) => drill({ severity: d.key })} />
              )}
            </Card>

            <Card title="Incident categories">
              {data.categories.length === 0 ? <EmptyState title="No incidents in this period" /> : (
                <HBarChart title="Incidents by category" data={data.categories.map((d) => ({ label: label(d.key), value: d.count, key: d.key }))} onSelect={(d) => drill({ type: d.key })} />
              )}
            </Card>

            <Card title="Response and resolution times">
              <dl className="metric-row">
                <div><dt>Avg. to acknowledge</dt><dd>{fmtMin(data.responseTimes.acknowledge.avg)}</dd><small className="form-hint">median {fmtMin(data.responseTimes.acknowledge.median)} · {data.responseTimes.acknowledge.n} incidents</small></div>
                <div><dt>Avg. to resolve</dt><dd>{fmtMin(data.responseTimes.resolve.avg)}</dd><small className="form-hint">median {fmtMin(data.responseTimes.resolve.median)} · {data.responseTimes.resolve.n} incidents</small></div>
              </dl>
              <dl className="metric-row mt-4">
                <div><dt>Escalated</dt><dd>{s.escalatedIncidents}</dd></div>
                <div><dt>Overdue now</dt><dd>{s.overdueIncidents}</dd></div>
                <div><dt>Still active</dt><dd>{s.activeIncidents}</dd></div>
              </dl>
              <p className="form-hint mt-4">Measured from each incident’s original creation time. Previous period: {fmtMin(c.previous.avgResponseMin)} to acknowledge, {fmtMin(c.previous.avgResolutionMin)} to resolve.</p>
            </Card>

            <Card title="Zone violations">
              {data.zoneViolations.length === 0 ? <EmptyState title="No restricted or danger zone entries">Entries are counted when a tourist crosses into a non-safe zone.</EmptyState> : (
                <HBarChart title="Zone violations" data={data.zoneViolations.map((z) => ({ label: `${z.zone} (${label(z.type)})`, value: z.entries }))} onSelect={() => drill({ type: 'geofence_violation' })} />
              )}
            </Card>

            <Card title="Tourists by current risk level">
              {risk.current.length === 0 ? <EmptyState title="No current risk scores">Scores older than 30 minutes are treated as outdated, not current.</EmptyState> : <HBarChart title="Tourists by risk level" data={levels} />}
              <p className="form-hint mt-4">Live, independent of the selected period. Scores are rule-based; open “Why?” on the dashboard risk board for the factors.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default Analytics;
