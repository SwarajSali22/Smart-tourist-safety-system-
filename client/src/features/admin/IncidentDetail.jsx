import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, MapPin, ShieldCheck } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { ProofBadge, ProofChecks } from '../../shared/components/ProofStatus.jsx';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { FRESH_LABEL, FRESH_VARIANT, freshnessOf, sourceOf } from '../../shared/utils/freshness.js';
import { formatDateTime, label, timeAgo } from '../../shared/utils/format.js';
import { SEVERITY_BADGE, STATUS_BADGE } from './Incidents.jsx';

// Mirrors backend/src/services/incidents/lifecycle.js (the server is the authority and re-validates).
const STAGES = ['open', 'in_progress', 'assigned', 'en_route', 'resolved', 'closed'];
const ALLOWED = {
  open: ['in_progress', 'resolved'], in_progress: ['assigned', 'resolved'], assigned: ['en_route', 'resolved'],
  en_route: ['resolved'], resolved: ['closed'], closed: [],
};
// What a responder may do (the server enforces it): only their own assignments, en route → resolved.
const RESPONDER_MOVES = ['en_route', 'resolved'];
const ACTION = {
  in_progress: { text: 'Acknowledge', variant: 'btn--primary' },
  assigned: { text: 'Assign…', variant: 'btn--primary' },
  en_route: { text: 'Mark en route', variant: 'btn--primary' },
  resolved: { text: 'Resolve…', variant: 'btn--primary' },
  closed: { text: 'Close incident', variant: 'btn--ghost' },
};

function IncidentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const allowedFor = (status) => (ALLOWED[status] || []).filter((s) => isAdmin || RESPONDER_MOVES.includes(s));
  const backTo = isAdmin ? '/admin/incidents' : '/responder';
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(30000);
  const [data, setData] = useState(null); // { incident, sosEvent, sms, device, allowedNext }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState('');
  const [note, setNote] = useState('');
  const [proofs, setProofs] = useState(undefined);
  const [verified, setVerified] = useState({});
  const [verifyingId, setVerifyingId] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [people, setPeople] = useState(null);
  const [assignee, setAssignee] = useState('');

  const load = useCallback(() => {
    return api.get(`/incidents/${id}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.status === 404 ? 'This incident does not exist (it may have been removed).' : e.message));
  }, [id]);

  const loadProofs = useCallback(() => {
    if (!isAdmin) { setProofs([]); return; }
    api.get(`/blockchain/incident/${id}`).then((d) => setProofs(d.proofs || [])).catch(() => setProofs([]));
  }, [id, isAdmin]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); loadProofs(); }, [load, loadProofs]);
  useOnReconnect(() => { load(); loadProofs(); });

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    const onUpdate = (inc) => { if (inc?._id === id) { load(); loadProofs(); } };
    socket.on('incident:updated', onUpdate);
    return () => socket.off('incident:updated', onUpdate);
  }, [id, load, loadProofs]);

  // Optimistic transition with rollback.
  async function move(to, extra = {}) {
    const before = data;
    const at = new Date().toISOString();
    setData((d) => ({
      ...d,
      incident: { ...d.incident, status: to, timeline: [...d.incident.timeline, { at, actorLabel: 'admin', action: `${label(d.incident.status)} → ${label(to)}`, metadata: { from: d.incident.status, to, note: extra.note } }] },
      allowedNext: allowedFor(to),
    }));
    setBusy(true);
    try {
      await api.patch(`/incidents/${id}/status`, { status: to, ...(extra.note ? { note: extra.note } : {}), ...(extra.assignee ? { assignee: extra.assignee } : {}) });
      toast.success(`Incident is now ${label(to)}.`);
    } catch (err) {
      setData(before);
      toast.error(`Couldn’t move to ${label(to)}: ${err.message || 'request failed'}. The incident was restored.`);
    } finally {
      setBusy(false);
      load(); loadProofs();
    }
  }

  async function addNote(e) {
    e.preventDefault();
    const text = note.trim();
    if (!text) return;
    const before = data;
    setData((d) => ({ ...d, incident: { ...d.incident, timeline: [...d.incident.timeline, { at: new Date().toISOString(), actorLabel: 'admin', action: 'Note', metadata: { note: text } }] } }));
    setNote('');
    try {
      await api.post(`/incidents/${id}/notes`, { note: text });
    } catch (err) {
      setData(before);
      setNote(text);
      toast.error(`Couldn’t add the note: ${err.message || 'request failed'}.`);
    }
  }

  async function openAssign() {
    setAssigning(true);
    setAssignee(user.id);
    if (!people) {
      api.get('/users/assignable').then((d) => setPeople(d.users || [])).catch((e) => toast.error(`Couldn’t load the team: ${e.message}`));
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

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast.success('Copied.'); } catch { toast.error('Couldn’t copy automatically.'); }
  }

  if (error && !data) {
    return (
      <div className="app-page">
        <Link className="btn btn--ghost btn--sm" to={backTo}><ArrowLeft size={14} aria-hidden="true" /> Back</Link>
        <div className="mt-4"><ErrorState message={error} onRetry={load} /></div>
      </div>
    );
  }
  if (!data) return <div className="app-page"><SkeletonRows rows={8} /></div>;

  const { incident, sosEvent, sms, device } = data;
  const next = isAdmin ? allowedFor(incident.status) : (data.allowedNext || []);
  const stageIndex = STAGES.indexOf(incident.status);
  const tourist = incident.tourist || {};
  const fresh = device ? freshnessOf(device.lastSeen, now) : 'never';
  const overdue = Boolean(data.overdue);
  const loc = sosEvent?.location || device?.lastLocation;

  return (
    <div className="app-page">
      <Link className="btn btn--ghost btn--sm" to={backTo}><ArrowLeft size={14} aria-hidden="true" /> {isAdmin ? 'All incidents' : 'My assignments'}</Link>

      <h1 className="page-title mt-4">
        {label(incident.type)}: {tourist.name || 'Unknown tourist'}
      </h1>
      <p className="page-subtitle">
        <Badge variant={SEVERITY_BADGE[incident.severity]}>{label(incident.severity)}</Badge>{' '}
        <Badge variant={STATUS_BADGE[incident.status]}>{label(incident.status)}</Badge>{' '}
        {overdue && <span className="badge badge--overdue">Overdue</span>}{' '}
        {tourist.isDemo && <Badge variant="info">Simulated</Badge>}{' '}
        · opened {timeAgo(incident.createdAt, now)} · <code>{String(incident._id).slice(-8)}</code>
      </p>

      <Card title="Lifecycle">
        <ol className="lifecycle" aria-label="Incident lifecycle">
          {STAGES.map((s, i) => (
            <li key={s} className={`lifecycle__step${i < stageIndex ? ' lifecycle__step--done' : ''}${i === stageIndex ? ' lifecycle__step--current' : ''}`} aria-current={i === stageIndex ? 'step' : undefined}>
              {label(s)}
            </li>
          ))}
        </ol>
        <div className="detail-actions mt-4">
          {next.map((to) => (
            <button
              key={to}
              type="button"
              className={`btn btn--sm ${ACTION[to].variant}`}
              disabled={busy}
              onClick={() => (to === 'resolved' ? setResolving(true) : to === 'assigned' ? openAssign() : move(to))}
            >
              {ACTION[to].text}
            </button>
          ))}
          {isAdmin && tourist._id && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate(`/admin/map?tourist=${tourist._id}`)}>
              <MapPin size={14} aria-hidden="true" /> Jump to map
            </button>
          )}
          {!isAdmin && loc?.lat != null && (
            <a className="btn btn--ghost btn--sm" href={`https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=17/${loc.lat}/${loc.lng}`} target="_blank" rel="noreferrer">
              <MapPin size={14} aria-hidden="true" /> Open position in a map
            </a>
          )}
          {next.length === 0 && <span className="form-hint">This incident is closed — no further actions.</span>}
        </div>
        {incident.assignedAdmin && <p className="form-hint mt-4">Assigned to <strong>{incident.assignedAdmin.name}</strong> ({incident.assignedAdmin.role})</p>}
        {incident.resolution && <p className="form-hint mt-4">Resolution note: {incident.resolution}</p>}
      </Card>

      <div className="detail-grid mt-4">
        <div>
          <Card title="Activity history">
            <ul className="activity">
              {[...incident.timeline].reverse().map((t, idx) => (
                <li key={idx}>
                  <strong>{t.action}</strong>{' '}
                  <span className="form-hint">by {t.actorLabel}{t.metadata?.assigneeName ? ` → ${t.metadata.assigneeName}` : ''} · {formatDateTime(t.at)}</span>
                  {t.metadata?.note && <p className="activity__note">{t.metadata.note}</p>}
                </li>
              ))}
            </ul>
            <form onSubmit={addNote} className="auth-form mt-4">
              <label className="form-label">
                Add a note
                <textarea className="form-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do or learn?" />
              </label>
              <div><button className="btn btn--ghost btn--sm" type="submit" disabled={!note.trim()}>Add note</button></div>
            </form>
          </Card>
        </div>

        <div className="detail-side">
          <Card title="Tourist">
            <dl className="kv">
              <dt>Name</dt><dd>{isAdmin && tourist._id ? <Link to={`/admin/tourists/${tourist._id}`}>{tourist.name || '—'}</Link> : (tourist.name || '—')}</dd>
              <dt>Email</dt><dd>{tourist.email || '—'}</dd>
              <dt>Phone</dt><dd>{tourist.phone || '—'}</dd>
            </dl>
          </Card>

          <Card title="Device & position" className="mt-4">
            {device ? (
              <dl className="kv">
                <dt>Source</dt><dd><Badge variant="neutral">{sourceOf(device)}</Badge></dd>
                <dt>Data</dt><dd><Badge variant={FRESH_VARIANT[fresh]}>{FRESH_LABEL[fresh]}</Badge> {device.lastSeen && <span className="form-hint">last seen {timeAgo(device.lastSeen, now)}</span>}</dd>
                <dt>Battery</dt><dd>{typeof device.battery === 'number' ? `${device.battery}%` : '—'}</dd>
                <dt>Emergency flag</dt><dd>{device.emergencyMode ? 'Set on the device record' : 'Not set'}</dd>
                {loc?.lat != null && (<><dt>Position</dt><dd>{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} <button type="button" className="icon-btn" onClick={() => copy(`${loc.lat}, ${loc.lng}`)} aria-label="Copy coordinates"><Copy size={14} aria-hidden="true" /></button></dd></>)}
              </dl>
            ) : <p className="placeholder-text">This tourist has no device linked.</p>}
          </Card>

          {sosEvent && (
            <Card title="SOS details" className="mt-4">
              <dl className="kv">
                <dt>Triggered by</dt><dd>{label(sosEvent.source)}</dd>
                <dt>Status</dt><dd>{label(sosEvent.status)}</dd>
                <dt>Sent</dt><dd>{formatDateTime(sosEvent.createdAt)}</dd>
                <dt>SMS to contacts</dt>
                <dd>
                  {sms?.simulated && 'Not sent — this is simulated demo data; no real SMS is ever sent for it.'}
                  {!sms?.simulated && !sms?.configured && sms?.attempts.length === 0 && 'Not sent — SMS alerts are not configured on this server.'}
                  {!sms?.simulated && sms?.configured && sms.attempts.length === 0 && 'No emergency contacts on file, so nothing was sent.'}
                  {sms?.attempts.length > 0 && `${sms.sent} sent, ${sms.failed} failed${sms.failed ? ` (${sms.attempts.find((a) => !a.delivered)?.error})` : ''}`}
                </dd>
              </dl>
            </Card>
          )}

          {isAdmin && <Card title="Audit proofs" className="mt-4">
            <p className="form-hint"><ShieldCheck size={13} aria-hidden="true" /> Database hash chain (not a public blockchain).</p>
            {proofs === undefined ? <p className="placeholder-text">Loading…</p> : proofs.length === 0 ? (
              <p className="placeholder-text">No proofs recorded for this incident (it predates the audit chain).</p>
            ) : (
              <ul className="proof-list mt-4">
                {proofs.map((p) => (
                  <li key={p._id}>
                    <div className="status-row">
                      <span><strong>#{p.chainRef.sequenceNo}</strong> {label(p.eventType)}</span>
                      <span className="badge-row">
                        <ProofBadge result={verified[p._id]} />
                        <button className="btn btn--ghost btn--sm" disabled={verifyingId === p._id} onClick={() => verify(p._id)}>{verifyingId === p._id ? 'Checking…' : 'Verify'}</button>
                      </span>
                    </div>
                    <ProofChecks result={verified[p._id]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>}
        </div>
      </div>

      <ConfirmDialog
        open={assigning}
        title="Assign this incident"
        message="Choose who should handle it. They are notified immediately and the assignment is recorded in the activity history and the audit chain."
        confirmLabel="Assign"
        onConfirm={() => { const who = assignee; setAssigning(false); move('assigned', { assignee: who }); }}
        onCancel={() => setAssigning(false)}
      >
        <label className="form-label modal__form">
          Assign to
          <select className="form-input" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!people}>
            {!people && <option value={user.id}>Loading team…</option>}
            {(people || []).map((p) => (
              <option key={p._id} value={p._id}>{p.name} — {p.role}{p._id === user.id ? ' (me)' : ''} · {p.activeIncidents} active{p.isDemo ? ' · simulated' : ''}</option>
            ))}
          </select>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={resolving}
        title="Resolve incident"
        message={`Mark ${tourist.name || 'this tourist'}’s ${label(incident.type).toLowerCase()} as resolved. If it was an SOS, the emergency flag on the device record is cleared.`}
        confirmLabel="Resolve"
        onConfirm={() => { const text = resolution.trim(); setResolving(false); setResolution(''); move('resolved', { note: text || undefined }); }}
        onCancel={() => setResolving(false)}
      >
        <label className="form-label modal__form">
          Resolution note (optional)
          <textarea className="form-input" rows={3} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What happened and what was done?" />
        </label>
      </ConfirmDialog>
    </div>
  );
}

export default IncidentDetail;
