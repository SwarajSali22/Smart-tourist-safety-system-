import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import { formatDateTime, timeAgo } from '../../shared/utils/format.js';

const INVITE_BADGE = { active: 'success', expired: 'neutral', full: 'neutral', revoked: 'danger' };
const INVITE_LABEL = { active: 'Active', expired: 'Expired', full: 'Full', revoked: 'Revoked' };
// Same wording as the dashboard's Check-in monitor: an old position is never called "Live".
const LOC = {
  live: { text: 'Live', variant: 'success' },
  last_known: { text: 'Last known', variant: 'warning' },
  overdue: { text: 'Overdue', variant: 'danger' },
  unavailable: { text: 'Location unavailable', variant: 'neutral' },
};

/** QR drawn locally in the browser (no external service) from exactly the link shown above it. */
function InviteQr({ link }) {
  const ref = useRef(null);
  const [failedFor, setFailedFor] = useState(null); // the link that failed to draw (so a new link starts clean)
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, link, { width: 288, margin: 2, errorCorrectionLevel: 'M' }).catch(() => setFailedFor(link));
  }, [link]);
  if (failedFor === link) return <p className="form-error" role="alert">The QR code could not be drawn. Use “Copy link” instead.</p>;
  return <canvas ref={ref} className="invite-qr" role="img" aria-label="QR code for the invitation link" />;
}

/** The expanded list of one group's members: real records, refreshed every 30 s while open. */
function Members({ groupId, onCount }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get(`/groups/${groupId}/members`)
    .then((d) => { setData(d); setError(''); onCount?.(d.members.length); })
    .catch((e) => setError(e.message || 'Could not load members')), [groupId, onCount]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    const socket = connectSocket(tokens.getAccess());
    socket.on('location:update', load);
    return () => { clearInterval(timer); socket.off('location:update', load); };
  }, [load]);

  if (error && !data) return <ErrorState compact message={error} onRetry={load} />;
  if (!data) return <p className="placeholder-text">Loading members…</p>;
  if (data.members.length === 0) return <p className="placeholder-text">No members yet. Tourists appear here after they register or sign in through an invitation link.</p>;
  return (
    <ul className="member-list">
      {error && <li className="form-error" role="alert">{error}</li>}
      {data.members.map((m) => {
        const s = LOC[m.status];
        return (
          <li key={m._id} className="member">
            <div className="member__head">
              <Link to={`/admin/tourists/${m._id}`} className="member__name">{m.name}</Link>
              <Badge variant={s.variant}>{s.text}</Badge>
              {m.alert && <Badge variant="danger">{m.alert.stage === 'escalated' ? 'Safety alert' : 'Check-in pending'}</Badge>}
              {!m.active && <Badge variant="neutral">Disabled</Badge>}
            </div>
            <p className="form-hint member__line">{m.email}{m.phone ? ` · ${m.phone}` : ''} · joined {formatDateTime(m.joinedAt)}</p>
            <p className="form-hint member__line">
              {m.lastGpsAt
                ? <>Last GPS {timeAgo(m.lastGpsAt)}{m.status === 'live' ? '' : ' (last known)'}{m.lastLocation ? ` · ${m.lastLocation.lat.toFixed(4)}, ${m.lastLocation.lng.toFixed(4)}` : ''}</>
                : 'No GPS received yet'}
              {' · '}check-in: {m.lastCheckInAt ? formatDateTime(m.lastCheckInAt) : 'none yet'}
              {m.alert?.incident && <> · <Link to={`/admin/incidents/${m.alert.incident}`}>open alert</Link></>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Tour groups and invitation links. A link is shown once (the server keeps only a hash), expires, has a seat limit and
 * can be closed. Links and the share message exist only when the server has a verified permanent HTTPS address
 * (or an explicitly enabled temporary demo tunnel).
 */
function Groups() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState(7);
  const [seats, setSeats] = useState(20);
  const [fresh, setFresh] = useState(null); // the invitation being shown: { groupName, link, message, ... }
  const [links, setLinks] = useState({});   // invitation id -> link, for invitations created in THIS page session only
  const [open, setOpen] = useState({});     // group id -> members expanded
  const [counts, setCounts] = useState({}); // group id -> member count from the members list
  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get('/groups').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function createGroup(e) {
    e.preventDefault();
    try { await api.post('/groups', { name }); setName(''); toast.success('Group created.'); load(); } catch (err) { toast.error(err.message); }
  }
  async function invite(g) {
    try {
      const r = await api.post(`/groups/${g._id}/invitations`, { expiresInDays: Number(days), maxUses: Number(seats) });
      const shown = { groupName: g.name, link: r.link, message: r.message, reason: r.linkUnavailableReason, demo: r.demo, qr: r.qrAllowed, expiresAt: r.invitation.expiresAt, maxUses: r.invitation.maxUses };
      setFresh(shown);
      if (r.link) setLinks((l) => ({ ...l, [r.invitation._id]: shown }));
      load();
    } catch (err) { toast.error(err.message); }
  }
  async function confirmRevoke() {
    setBusy(true);
    try {
      await api.delete(`/groups/invitations/${revoking}`);
      const closed = links[revoking];
      setLinks((l) => { const n = { ...l }; delete n[revoking]; return n; });
      setFresh((f) => (f && closed && f.link === closed.link ? null : f));
      toast.success('Invitation closed. Existing members stay in the group.');
      setRevoking(null); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function share(f) {
    try { await navigator.share({ title: 'Tour group invitation', text: f.message }); } catch { /* cancelled or unsupported: the copy buttons remain */ }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast.success('Copied.'); } catch { toast.error('Couldn’t copy automatically.'); }
  }

  return (
    <div className="app-page">
      <h1 className="page-title">Tour groups</h1>
      <p className="page-subtitle">Create a group, then invite tourists with a link. Anyone who registers through it joins that group only, as a tourist.</p>
      {error && <ErrorState compact message={error} onRetry={load} />}

      <Card title="New group">
        <form onSubmit={createGroup} className="group-create">
          <input className="form-input" required maxLength={100} placeholder="e.g. Goa heritage walk, 12 Dec" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
          <button className="btn btn--primary btn--sm" type="submit" disabled={!name.trim()}>Create group</button>
        </form>
        <div className="group-settings mt-4">
          <label className="form-label">Link expires in (days)<input className="form-input form-input--sm" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} /></label>
          <label className="form-label">Seats per link<input className="form-input form-input--sm" type="number" min={1} max={500} value={seats} onChange={(e) => setSeats(e.target.value)} /></label>
        </div>
      </Card>

      {data && !data.invitationLinks.ok && (
        <p className="notice notice--warn mt-4" role="status">
          Invitation links and QR codes are switched off: {data.invitationLinks.reason} No link is ever built from localhost or a temporary tunnel address.
        </p>
      )}

      {fresh && (
        <Card title={`Invitation for ${fresh.groupName}`} className="mt-4">
          {fresh.link ? (
            <>
              {fresh.demo && <p className="notice notice--warn" role="status">Temporary demo link: it works only while this demo tunnel is running and the address will change. Not for real tourists; the QR code points at the same temporary link.</p>}
              <p className="form-hint">Nothing has been sent: share it yourself (the app does not send SMS or WhatsApp). The link can’t be shown again after you leave this page; you can only close it.</p>
              <p className="mt-4"><code style={{ wordBreak: 'break-all' }}>{fresh.link}</code></p>
              <p className="form-hint mt-4">Expires {formatDateTime(fresh.expiresAt)} · up to {fresh.maxUses} registrations · status: active</p>
              {fresh.qr && <div className="invite-qr-wrap mt-4"><InviteQr link={fresh.link} /><p className="form-hint">Scan with another phone’s camera. Same link as above.</p></div>}
              <textarea className="form-input mt-4" rows={4} readOnly value={fresh.message} aria-label="Invitation message" />
              <div className="detail-actions mt-4">
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => copy(fresh.link)}>Copy link</button>
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => copy(fresh.message)}>Copy message</button>
                <a className="btn btn--ghost btn--sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(fresh.message)}`}>Open WhatsApp</a>
                <a className="btn btn--ghost btn--sm" href={`sms:?&body=${encodeURIComponent(fresh.message)}`}>Open SMS app</a>
                {typeof navigator !== 'undefined' && navigator.share && <button className="btn btn--ghost btn--sm" type="button" onClick={() => share(fresh)}>Share…</button>}
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => setFresh(null)}>Hide</button>
              </div>
              <p className="form-hint mt-4">These buttons only open or copy the message. You still press Send yourself. The app cannot tell whether a message was delivered.</p>
            </>
          ) : <p className="form-hint">The invitation was created, but no link can be shown: {fresh.reason}</p>}
        </Card>
      )}

      <div className="mt-4">
        {data && data.groups.length === 0 && <p className="placeholder-text">No groups yet.</p>}
        {data?.groups.map((g) => {
          const count = counts[g._id] ?? g.members;
          return (
            <Card key={g._id} title={g.name} className="mt-4">
              <div className="group-head">
                <p className="form-hint">{count} {count === 1 ? 'member' : 'members'} · created {formatDateTime(g.createdAt)}</p>
                <div className="group-head__actions">
                  <button className="btn btn--ghost btn--sm" type="button" aria-expanded={Boolean(open[g._id])} onClick={() => setOpen((o) => ({ ...o, [g._id]: !o[g._id] }))}>
                    {open[g._id] ? 'Hide members' : `Members (${count})`}
                  </button>
                  <button className="btn btn--primary btn--sm" type="button" onClick={() => invite(g)}>New invitation</button>
                </div>
              </div>
              {open[g._id] && <div className="mt-4"><Members groupId={g._id} onCount={(n) => setCounts((c) => (c[g._id] === n ? c : { ...c, [g._id]: n }))} /></div>}
              {g.invitations.length > 0 && (
                <ul className="plain-list mt-4">
                  {g.invitations.map((i) => (
                    <li key={i._id} className="invite-row">
                      <span>
                        <Badge variant={INVITE_BADGE[i.status]}>{INVITE_LABEL[i.status]}</Badge>{' '}
                        {i.usedCount} / {i.maxUses} used
                        <small className="form-hint block">Created {formatDateTime(i.createdAt)} · expires {formatDateTime(i.expiresAt)}</small>
                      </span>
                      <span className="invite-row__actions">
                        {i.status === 'active' && links[i._id] && (
                          <>
                            <button className="btn btn--ghost btn--sm" type="button" onClick={() => copy(links[i._id].link)}>Copy link</button>
                            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setFresh(links[i._id])}>QR</button>
                          </>
                        )}
                        {i.status === 'active' && <button className="btn btn--ghost btn--sm" type="button" onClick={() => setRevoking(i._id)}>Close</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {g.invitations.some((i) => i.status === 'active' && !links[i._id]) && (
                <p className="form-hint mt-4">Only invitations made during this visit can be copied again; the server stores just a hash of each link. To share again, make a new invitation.</p>
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Close this invitation?"
        message="Nobody will be able to register or join with this link any more. People who already joined stay in the group."
        confirmLabel="Close invitation"
        danger
        busy={busy}
        onConfirm={confirmRevoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

export default Groups;
