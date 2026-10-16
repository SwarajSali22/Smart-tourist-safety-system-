import { useEffect, useState } from 'react';
import { ShieldCheck, Siren } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { ProofBadge, ProofChecks } from '../../shared/components/ProofStatus.jsx';
import { formatDateTime, label } from '../../shared/utils/format.js';

const SEVERITY_BADGE = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger' };
const STATUS_BADGE = { open: 'danger', in_progress: 'warning', resolved: 'success', closed: 'neutral' };

function Incidents() {
  const toast = useToast();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');

  const [proofs, setProofs] = useState({});    // incidentId -> proof[]
  const [verified, setVerified] = useState({}); // proofId -> verify result
  const [verifyingId, setVerifyingId] = useState(null);

  useEffect(() => {
    api.get('/incidents')
      .then((data) => setIncidents(data.incidents || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    function upsert(incident) {
      setIncidents((is) => {
        const exists = is.some((i) => i._id === incident._id);
        return exists ? is.map((i) => (i._id === incident._id ? incident : i)) : [incident, ...is];
      });
    }
    function onTriggered({ incident }) {
      upsert(incident);
    }
    socket.on('incident:updated', upsert);
    socket.on('sos:triggered', onTriggered);
    return () => {
      socket.off('incident:updated', upsert);
      socket.off('sos:triggered', onTriggered);
    };
  }, []);

  async function handleAcknowledge(incident) {
    setBusyId(incident._id);
    try {
      await api.patch(`/incidents/${incident._id}/acknowledge`, {});
      toast.success(`Acknowledged — ${incident.tourist?.name || 'tourist'} has been told help is responding.`);
    } catch (err) {
      toast.error(err.message || 'Failed to acknowledge incident');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmResolve() {
    setBusyId(resolving._id);
    try {
      await api.patch(`/incidents/${resolving._id}/resolve`, { resolution: note.trim() || undefined });
      toast.success('Incident resolved and recorded on the audit chain.');
      setResolving(null);
      setNote('');
      setProofs((p) => { const next = { ...p }; delete next[resolving._id]; return next; });
    } catch (err) {
      toast.error(err.message || 'Failed to resolve incident');
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpand(row) {
    const next = expandedId === row._id ? null : row._id;
    setExpandedId(next);
    if (next && !proofs[next]) {
      api.get(`/blockchain/incident/${next}`)
        .then((d) => setProofs((p) => ({ ...p, [next]: d.proofs || [] })))
        .catch(() => setProofs((p) => ({ ...p, [next]: [] })));
    }
  }

  async function verify(proofId) {
    setVerifyingId(proofId);
    try {
      const d = await api.get(`/blockchain/verify/${proofId}`);
      setVerified((v) => ({ ...v, [proofId]: d.result }));
    } catch (err) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setVerifyingId(null);
    }
  }

  const filtered = incidents.filter(
    (i) => (statusFilter === 'all' || i.status === statusFilter) && (severityFilter === 'all' || i.severity === severityFilter)
  );

  const columns = [
    { key: 'tourist', header: 'Tourist', sortValue: (i) => i.tourist?.name?.toLowerCase() ?? '', render: (i) => i.tourist?.name || '—' },
    { key: 'type', header: 'Type', sortValue: (i) => i.type, render: (i) => label(i.type) },
    { key: 'severity', header: 'Severity', sortValue: (i) => ['low', 'medium', 'high', 'critical'].indexOf(i.severity), render: (i) => <Badge variant={SEVERITY_BADGE[i.severity]}>{label(i.severity)}</Badge> },
    { key: 'status', header: 'Status', sortValue: (i) => i.status, render: (i) => <Badge variant={STATUS_BADGE[i.status]}>{label(i.status)}</Badge> },
    { key: 'createdAt', header: 'Created', sortValue: (i) => new Date(i.createdAt).getTime(), render: (i) => formatDateTime(i.createdAt) },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>,
      render: (i) =>
        (i.status === 'open' || i.status === 'in_progress') && (
          <div className="contact-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {i.status === 'open' && (
              <button className="btn btn--ghost btn--sm" disabled={busyId === i._id} onClick={() => handleAcknowledge(i)}>
                Acknowledge
              </button>
            )}
            <button className="btn btn--primary btn--sm" disabled={busyId === i._id} onClick={() => { setResolving(i); setNote(''); }}>
              Resolve
            </button>
          </div>
        ),
    },
  ];

  function renderExpanded(i) {
    const list = proofs[i._id];
    return (
      <div className="incident-detail">
        <div>
          <h4 className="detail-heading">Timeline</h4>
          <ul className="timeline-list">
            {i.timeline.map((t, idx) => (
              <li key={idx}>
                <strong>{t.actorLabel}</strong> — {t.action}{' '}
                <span className="form-hint">{formatDateTime(t.at)}</span>
              </li>
            ))}
          </ul>
          {i.resolution && <p className="form-hint">Resolution note: {i.resolution}</p>}
        </div>
        <div>
          <h4 className="detail-heading"><ShieldCheck size={14} aria-hidden="true" /> Audit proofs</h4>
          {list === undefined ? (
            <p className="placeholder-text">Loading proofs…</p>
          ) : list.length === 0 ? (
            <p className="placeholder-text">No audit proofs recorded for this incident (it predates the audit chain).</p>
          ) : (
            <ul className="proof-list">
              {list.map((p) => (
                <li key={p._id}>
                  <div className="status-row">
                    <span>
                      <strong>#{p.chainRef.sequenceNo}</strong> {label(p.eventType)}
                      <small className="form-hint block"><code>{p.dataHash.slice(0, 16)}…</code></small>
                    </span>
                    <span className="badge-row">
                      <ProofBadge result={verified[p._id]} />
                      <button className="btn btn--ghost btn--sm" disabled={verifyingId === p._id} onClick={() => verify(p._id)}>
                        {verifyingId === p._id ? 'Checking…' : 'Verify'}
                      </button>
                    </span>
                  </div>
                  <ProofChecks result={verified[p._id]} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <h1 className="page-title">Incidents</h1>
      <p className="page-subtitle">Unified case record for SOS and other escalations</p>

      {error && <p className="form-error" role="alert">{error}</p>}

      <Card>
        {loading ? (
          <SkeletonRows rows={6} />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            searchText={(i) => `${i.tourist?.name || ''} ${label(i.type)} ${i.severity} ${i.status}`}
            searchLabel="Search incidents"
            toolbar={
              <div className="filter-row">
                <label className="filter">
                  <span className="sr-only">Filter by status</span>
                  <select className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                    <option value="all">All statuses</option>
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label className="filter">
                  <span className="sr-only">Filter by severity</span>
                  <select className="form-input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Filter by severity">
                    <option value="all">All severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>
            }
            emptyIcon={Siren}
            emptyTitle="No incidents yet"
            emptyText="SOS presses, missed check-ins and risk escalations will be tracked here."
            onRowClick={toggleExpand}
            expandedId={expandedId}
            renderExpanded={renderExpanded}
            caption="Incidents. Select a row to expand its timeline and audit proofs."
          />
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(resolving)}
        title="Resolve incident"
        message={resolving ? `Mark ${resolving.tourist?.name || 'this tourist'}’s ${label(resolving.type).toLowerCase()} incident as resolved. If it was an SOS, the wristband’s emergency mode is cleared.` : ''}
        confirmLabel="Resolve"
        busy={busyId === resolving?._id}
        onConfirm={confirmResolve}
        onCancel={() => setResolving(null)}
      >
        <label className="form-label modal__form">
          Resolution note (optional)
          <textarea className="form-input" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What happened and what was done?" />
        </label>
      </ConfirmDialog>
    </div>
  );
}

export default Incidents;
