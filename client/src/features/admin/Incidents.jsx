import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MapPin, Siren } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { downloadServerCsv } from '../../shared/utils/csv.js';
import { formatDateTime, label, timeAgo } from '../../shared/utils/format.js';

export const SEVERITY_BADGE = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger' };
export const STATUS_BADGE = { open: 'danger', in_progress: 'warning', assigned: 'info', en_route: 'info', resolved: 'success', closed: 'neutral' };

const PAGE_SIZE = 15;
const STATUS_OPTIONS = [
  ['', 'All statuses'], ['active', 'Active (not resolved)'], ['open', 'New'], ['in_progress', 'Acknowledged'],
  ['assigned', 'Assigned'], ['en_route', 'En route'], ['resolved', 'Resolved'], ['closed', 'Closed'],
];
const TYPE_OPTIONS = [['', 'All types'], ['sos', 'SOS'], ['geofence_violation', 'Zone violation'], ['no_response', 'Missed check-in'], ['risk_escalation', 'Risk escalation'], ['other', 'Other']];

/**
 * Incident list. Search, filters, sorting and pagination all run on the SERVER
 * (GET /api/incidents) and live in the URL, so a filtered view can be linked to
 * (the dashboard cards do exactly that) and survives a reload.
 */
function Incidents() {
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow(30000);
  const [params, setParams] = useSearchParams();

  const q = params.get('q') || '';
  const active = params.get('active') === '1';
  const statusParam = params.get('status') || '';
  const statusValue = active ? 'active' : statusParam;
  const severity = params.get('severity') || '';
  const type = params.get('type') || '';
  const sort = params.get('sort') || 'createdAt';
  const order = params.get('order') || 'desc';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [qInput, setQInput] = useState(q);
  const [data, setData] = useState(null); // { incidents, total, pages }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const setParam = useCallback((changes) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(changes).forEach(([k, v]) => { if (v === '' || v == null) next.delete(k); else next.set(k, v); });
      if (!('page' in changes)) next.delete('page'); // any filter change goes back to page 1
      return next;
    }, { replace: true });
  }, [setParams]);

  // Debounce the search box into the URL.
  useEffect(() => {
    const id = setTimeout(() => { if (qInput !== q) setParam({ q: qInput }); }, 350);
    return () => clearTimeout(id);
  }, [qInput, q, setParam]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (active) sp.set('active', '1'); else if (statusParam) sp.set('status', statusParam);
    if (severity) sp.set('severity', severity);
    if (type) sp.set('type', type);
    sp.set('sort', sort); sp.set('order', order); sp.set('page', String(page)); sp.set('limit', String(PAGE_SIZE));
    return sp.toString();
  }, [q, active, statusParam, severity, type, sort, order, page]);

  const load = useCallback(() => {
    return api.get(`/incidents?${queryString}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message || 'Could not load incidents'))
      .finally(() => setLoading(false));
  }, [queryString]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Live: any incident change → refetch the current page (debounced), so server-side filters stay correct.
  const timer = useRef(null);
  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    const refresh = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); };
    socket.on('incident:updated', refresh);
    socket.on('sos:triggered', refresh);
    return () => { socket.off('incident:updated', refresh); socket.off('sos:triggered', refresh); clearTimeout(timer.current); };
  }, [load]);
  useOnReconnect(load);

  async function acknowledge(incident) {
    // Optimistic: show Acknowledged now, roll back (and say why) if the server refuses.
    const prev = data.incidents;
    setData((d) => ({ ...d, incidents: d.incidents.map((i) => (i._id === incident._id ? { ...i, status: 'in_progress', _pending: true } : i)) }));
    try {
      await api.patch(`/incidents/${incident._id}/acknowledge`, {});
      toast.success(`Acknowledged — ${incident.tourist?.name || 'the tourist'} has been told help is responding.`);
      load();
    } catch (err) {
      setData((d) => ({ ...d, incidents: d.incidents.map((i) => (i._id === incident._id && i._pending ? prev.find((p) => p._id === incident._id) : i)) }));
      toast.error(`Couldn’t acknowledge: ${err.message || 'request failed'}. The incident was restored.`);
    }
  }

  async function exportCsv() {
    const sp = new URLSearchParams(queryString);
    sp.delete('page'); sp.delete('limit');
    try {
      await downloadServerCsv(`/incidents/export.csv?${sp}`, 'incidents.csv');
      toast.success('Exported every incident matching the current filters.');
    } catch (err) {
      toast.error(`Couldn’t export: ${err.message}`);
    }
  }

  const rows = data?.incidents || [];
  const filtered = Boolean(q || statusValue || severity || type);
  const clearFilters = () => { setQInput(''); setParams({}, { replace: true }); };

  const columns = [
    { key: 'tourist', header: 'Tourist', render: (i) => (
      <span>{i.tourist?.name || '—'}{i.tourist?.isDemo && <> <Badge variant="info">Simulated</Badge></>}</span>
    ) },
    { key: 'type', header: 'Type', sortKey: 'type', render: (i) => label(i.type) },
    { key: 'severity', header: 'Severity', sortKey: 'severity', render: (i) => <Badge variant={SEVERITY_BADGE[i.severity]}>{label(i.severity)}</Badge> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (i) => (
      <span className="badge-row">
        <Badge variant={STATUS_BADGE[i.status]}>{label(i.status)}</Badge>
        {i.overdue && <span className="badge badge--overdue" title="Sitting in this state longer than the target">Overdue</span>}
      </span>
    ) },
    { key: 'assignee', header: 'Assigned to', render: (i) => i.assignedAdmin?.name || '—' },
    { key: 'createdAt', header: 'Created', sortKey: 'createdAt', render: (i) => <time dateTime={i.createdAt} title={formatDateTime(i.createdAt)}>{timeAgo(i.createdAt, now)}</time> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>,
      render: (i) => (
        <div className="contact-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {i.tourist?._id && (
            <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/admin/map?tourist=${i.tourist._id}`)} aria-label={`Show ${i.tourist.name || 'tourist'} on the map`}>
              <MapPin size={14} aria-hidden="true" /> Map
            </button>
          )}
          {i.status === 'open' && (
            <button className="btn btn--ghost btn--sm" disabled={i._pending} onClick={() => acknowledge(i)}>Acknowledge</button>
          )}
          <Link className="btn btn--primary btn--sm" to={`/admin/incidents/${i._id}`}>Open</Link>
        </div>
      ),
    },
  ];

  const select = (value, onChange, options, aria) => (
    <label className="filter">
      <span className="sr-only">{aria}</span>
      <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );

  return (
    <div className="app-page">
      <h1 className="page-title">Incidents</h1>
      <p className="page-subtitle">Every escalation, from first alert to closure. Click a row for the full case.</p>

      <Card>
        {loading && !data ? (
          <SkeletonRows rows={6} />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={() => { setLoading(true); load(); }} />
        ) : (
          <>
            {error && <ErrorState compact message={`${error} Showing the last data we had.`} onRetry={load} />}
            <DataTable
              manual
              onExportCsv={exportCsv}
              columns={columns}
              rows={rows}
              toolbar={
                <div className="filter-row">
                  <label className="search-box">
                    <span className="sr-only">Search incidents</span>
                    <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search tourist, email or type" aria-label="Search incidents" />
                  </label>
                  {select(statusValue, (v) => (v === 'active' ? setParam({ active: '1', status: '' }) : setParam({ status: v, active: '' })), STATUS_OPTIONS, 'Filter by status')}
                  {select(severity, (v) => setParam({ severity: v }), [['', 'All severities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], 'Filter by severity')}
                  {select(type, (v) => setParam({ type: v }), TYPE_OPTIONS, 'Filter by type')}
                  {filtered && <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear filters</button>}
                </div>
              }
              sort={{ key: sort, dir: order }}
              onSort={(key) => setParam({ sort: key, order: sort === key && order === 'desc' ? 'asc' : 'desc' })}
              pagination={{ page, pages: data?.pages || 1, total: data?.total || 0, pageSize: PAGE_SIZE, onPage: (p) => setParam({ page: String(p) }) }}
              onRowClick={(row) => navigate(`/admin/incidents/${row._id}`)}
              emptyIcon={Siren}
              emptyTitle={filtered ? 'No incidents match these filters' : 'No incidents yet'}
              emptyText={filtered ? 'Try widening the search or clearing the filters.' : 'SOS presses, missed check-ins and risk escalations will be tracked here.'}
              emptyAction={filtered
                ? <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear filters</button>
                : <Link className="btn btn--ghost btn--sm" to="/admin/map">Open the live map</Link>}
              caption="Incidents. Select a row to open the case."
              rowKey={(i) => i._id}
            />
          </>
        )}
      </Card>
    </div>
  );
}

export default Incidents;
