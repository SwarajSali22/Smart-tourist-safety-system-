import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Copy, MapPin, ShieldCheck } from 'lucide-react';
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
import { PRIORITY_BADGE, SEVERITY_BADGE, STATUS_BADGE } from './Incidents.jsx';
import RiskExplain from '../../shared/components/RiskExplain.jsx';

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
  const [reassigning, setReassigning] = useState(false);
  const [people, setPeople] = useState(null);
  const [assignee, setAssignee] = useState('');
  const [evidence, setEvidence] = useState({ kind: 'link', title: '', value: '' });
  const [risk, setRisk] = useState(null);
  const [handover, setHandover] = useState(null); // read-only summary for whoever takes the case over

  const load = useCallback(() => {
    return api.get(`/incidents/${id}`)
      .then((d) => { setData(d); setError(''); })
      .then(() => api.get(`/incidents/${id}/handover`).then((h) => setHandover(h.handover)).catch(() => setHandover(null)))
      .catch((e) => setError(e.status === 404 ? 'This incident does not exist (it may have been removed).' : e.message));
  }, [id]);

  const loadProofs = useCallback(() => {
    if (!isAdmin) { setProofs([]); return; }
    api.get(`/blockchain/incident/${id}`).then((d) => setProofs(d.proofs || [])).catch(() => setProofs([]));
  }, [id, isAdmin]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); loadProofs(); }, [load, loadProofs]);

  const touristId = data?.incident?.tourist?._id;
  useEffect(() => {
    if (!isAdmin || !touristId) return;
    api.get(`/risk/${touristId}/history`).then((d) => setRisk(d.history?.[0] || null)).catch(() => setRisk(null));
  }, [isAdmin, touristId, data?.incident?.status]);
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
      await api.patch(`/incidents/${id}/status`, { status: to, expectedStatus: before.incident.status, ...(extra.note ? { note: extra.note } : {}), ...(extra.assignee ? { assignee: extra.assignee } : {}) });
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

  async function reassign(who) {
    setBusy(true);
    try {
      await api.patch(`/incidents/${id}/assign`, { assignee: who });
      toast.success('Incident reassigned.');
    } catch (err) {
      toast.error(`Couldn’t reassign: ${err.message || 'request failed'}.`);
    } finally { setBusy(false); load(); loadProofs(); }
  }

  async function changePriority(priority) {
    try {
      await api.patch(`/incidents/${id}/priority`, { priority });
      toast.success(`Priority set to ${label(priority)}.`);
    } catch (err) { toast.error(`Couldn’t change the priority: ${err.message}`); }
    load();
  }

  async function addEvidence(e) {
    e.preventDefault();
    try {
      await api.post(`/incidents/${id}/evidence`, evidence);
      setEvidence({ kind: evidence.kind, title: '', value: '' });
      toast.success('Evidence added to the case.');
    } catch (err) { toast.error(`Couldn’t add evidence: ${err.message}`); }
    load();
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
  const safetyAlert = incident.timeline?.find((e) => e.metadata?.kind === 'automated_safety_alert')?.metadata || null;

  return (
    <div className="app-page">
      <Link className="btn btn--ghost btn--sm" to={backTo}><ArrowLeft size={14} aria-hidden="true" /> {isAdmin ? 'All incidents' : 'My assignments'}</Link>

      <h1 className="page-title mt-4">
        {label(incident.type)}: {tourist.name || 'Unknown tourist'}
      </h1>
      <p className="page-subtitle">
        <Badge variant={SEVERITY_BADGE[incident.severity]}>{label(incident.severity)}</Badge>{' '}
        <Badge variant={STATUS_BADGE[incident.status]}>{label(incident.status)}</Badge>{' '}
        <Badge variant={PRIORITY_BADGE[incident.priority || 'normal']}>Priority: {label(incident.priority || 'normal')}</Badge>{' '}
        {overdue && <span className="badge badge--overdue">Overdue</span>}{' '}
        {incident.escalatedAt && <span className="badge badge--escalated" title={incident.escalationReason || ''}>Escalated {timeAgo(incident.escalatedAt, now)}</span>}{' '}
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
          {isAdmin && ['assigned', 'en_route'].includes(incident.status) && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setReassigning(true); openAssign(); }}>Reassign…</button>
          )}
          {isAdmin && !['resolved', 'closed'].includes(incident.status) && (
            <label className="filter filter--inline">
              <span className="form-hint">Priority</span>
              <select className="form-input" value={incident.priority || 'normal'} onChange={(e) => changePriority(e.target.value)} aria-label="Incident priority">
                {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{label(p)}</option>)}
              </select>
            </label>
          )}
          {next.length === 0 && <span className="form-hint">This incident is closed — no further actions.</span>}
        </div>
        {data.metrics && (
          <dl className="metric-row mt-4">
            <div><dt>Time to acknowledge</dt><dd>{data.metrics.responseMinutes != null ? `${data.metrics.responseMinutes} min` : 'Not yet'}</dd></div>
            <div><dt>Time to resolve</dt><dd>{data.metrics.resolutionMinutes != null ? `${data.metrics.resolutionMinutes} min` : 'Not yet'}</dd></div>
            <div><dt>Opened</dt><dd>{formatDateTime(incident.createdAt)}</dd></div>
          </dl>
        )}
        {incident.assignedAdmin && <p className="form-hint mt-4">Assigned to <strong>{incident.assignedAdmin.name}</strong> ({incident.assignedAdmin.role})</p>}
        {incident.resolution && <p className="form-hint mt-4">Resolution note: {incident.resolution}</p>}
      </Card>

      {safetyAlert && (
        <Card title="Automated safety alert (not an SOS)" className="mt-4">
          <p className="form-hint">
            Raised by the system because no location or check-in arrived. The tourist did not press SOS, and nothing has been sent to emergency services.
            Silence can have harmless causes. Severity <strong>{label(safetyAlert.severity)}</strong> comes from fixed rules, not AI.
          </p>
          {safetyAlert.lastKnownLocation ? (
            <p className="mt-4">
              <MapPin size={14} aria-hidden="true" /> Last known position {safetyAlert.lastKnownLocation.lat.toFixed(5)}, {safetyAlert.lastKnownLocation.lng.toFixed(5)}
              {' '}· received {formatDateTime(safetyAlert.lastKnownLocation.receivedAt)} ({safetyAlert.lastKnownLocation.ageMin} min before the alert)
              {safetyAlert.lastKnownLocation.accuracyM != null ? ` · accuracy ±${Math.round(safetyAlert.lastKnownLocation.accuracyM)} m` : ''}
              {safetyAlert.locationIsStale && <> <Badge variant="warning">Stale · may be outdated</Badge></>}
            </p>
          ) : <p className="mt-4">No location was ever received.</p>}
          <ul className="activity mt-4">{(safetyAlert.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
          <ul className="activity mt-4">
            {(safetyAlert.timeline || []).map((e, i) => <li key={i}><strong>{e.event}</strong> <span className="form-hint">{formatDateTime(e.at)}</span></li>)}
          </ul>
          <Link
            className="btn btn--ghost btn--sm mt-4"
            to="/admin/copilot"
            state={{ prefill: `Review automated safety alert, incident ${String(incident._id).slice(-8)}: summarise the timeline, the last known location and zone context, and recommend a review priority. Do not assume the tourist is safe or in danger.` }}
          ><Bot size={14} aria-hidden="true" /> Ask Copilot to review</Link>
        </Card>
      )}

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

          {handover && (
            <Card title="Handover summary" className="mt-4">
              <dl className="kv">
                <dt>Held by</dt><dd>{handover.currentAssignee ? `${handover.currentAssignee.name} (${handover.currentAssignee.role})` : 'Nobody yet'}</dd>
                <dt>Evidence</dt><dd>{handover.evidenceCount} item(s)</dd>
                {handover.lastKnownLocation && (<><dt>Last position</dt><dd>{handover.lastKnownLocation.lat.toFixed(5)}, {handover.lastKnownLocation.lng.toFixed(5)}{handover.lastKnownLocation.lastSeen && <span className="form-hint"> · {timeAgo(handover.lastKnownLocation.lastSeen, now)}</span>}</dd></>)}
              </dl>
              <p className="form-hint mt-4">Assignment history</p>
              {handover.assignments.length === 0 ? <p className="placeholder-text">Not assigned yet.</p> : (
                <ol className="activity">
                  {handover.assignments.map((a, i) => (
                    <li key={i}><strong>{a.assignee || 'Assigned'}</strong> <span className="form-hint">by {a.by} · {formatDateTime(a.at)}</span>{a.note && <p className="activity__note">{a.note}</p>}</li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          {isAdmin && risk && (
            <Card title="Risk assessment" className="mt-4">
              <RiskExplain assessment={risk} />
            </Card>
          )}

          <Card title="Evidence" className="mt-4">
            {(incident.evidence || []).length === 0 && <p className="placeholder-text">No evidence recorded. Add a link (photo, CCTV, report) or a written observation.</p>}
            <ul className="evidence-list">
              {(incident.evidence || []).map((ev, i) => (
                <li key={i}>
                  <strong>{ev.title}</strong>{' '}
                  <span className="form-hint">{formatDateTime(ev.at)}</span>
                  <p className="activity__note">{ev.kind === 'link' ? <a href={ev.value} target="_blank" rel="noreferrer noopener">{ev.value}</a> : ev.value}</p>
                </li>
              ))}
            </ul>
            <form onSubmit={addEvidence} className="auth-form mt-4">
              <div className="evidence-form">
                <select className="form-input" value={evidence.kind} onChange={(e) => setEvidence((v) => ({ ...v, kind: e.target.value }))} aria-label="Evidence type">
                  <option value="link">Link</option><option value="text">Written note</option>
                </select>
                <input className="form-input" maxLength={140} placeholder="Title" value={evidence.title} onChange={(e) => setEvidence((v) => ({ ...v, title: e.target.value }))} aria-label="Evidence title" />
              </div>
              <textarea className="form-input" rows={2} maxLength={1000} placeholder={evidence.kind === 'link' ? 'https://…' : 'What was observed?'} value={evidence.value} onChange={(e) => setEvidence((v) => ({ ...v, value: e.target.value }))} aria-label="Evidence content" />
              <div><button className="btn btn--ghost btn--sm" type="submit" disabled={!evidence.title.trim() || !evidence.value.trim()}>Add evidence</button></div>
              <p className="form-hint">Stored as a reference only — files are not uploaded to this system.</p>
            </form>
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
        title={reassigning ? 'Reassign this incident' : 'Assign this incident'}
        message="Choose who should handle it. They are notified immediately and the assignment is recorded in the activity history and the audit chain."
        confirmLabel="Assign"
        onConfirm={() => { const who = assignee; setAssigning(false); if (reassigning) { setReassigning(false); reassign(who); } else move('assigned', { assignee: who }); }}
        onCancel={() => { setAssigning(false); setReassigning(false); }}
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
