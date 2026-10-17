import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { api } from '../../api/client.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { ProofBadge, ProofChecks } from '../../shared/components/ProofStatus.jsx';
import { formatDateTime, label } from '../../shared/utils/format.js';

/**
 * Tamper-evident audit trail. Every SOS, zone violation, risk escalation and
 * incident open/resolve is hashed (SHA-256) and linked to the previous proof.
 * "Verify" re-hashes the live record and compares it with what was recorded.
 */
function Blockchain() {
  const toast = useToast();
  const [proofs, setProofs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [results, setResults] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [chain, setChain] = useState(null);
  const [chainBusy, setChainBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    api.get('/blockchain?limit=200')
      .then((d) => { setProofs(d.proofs || []); setTotal(d.total || 0); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useOnReconnect(() => {
    api.get('/blockchain?limit=200').then((d) => { setProofs(d.proofs || []); setTotal(d.total || 0); }).catch(() => {});
  });

  async function verifyOne(id) {
    setBusyId(id);
    try {
      const d = await api.get(`/blockchain/verify/${id}`);
      setResults((r) => ({ ...r, [id]: d.result }));
      return d.result;
    } catch (e) {
      toast.error(e.message || 'Verification failed');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function verifyChain() {
    setChainBusy(true);
    try {
      const d = await api.get('/blockchain/verify-chain');
      setChain(d.result);
      if (d.result.valid) toast.success(`Chain intact — ${d.result.length} proofs linked correctly.`);
      else toast.danger(`Chain broken at proof #${d.result.brokenAtSequence} (${d.result.reason}).`);
    } catch (e) {
      toast.error(e.message || 'Chain verification failed');
    } finally {
      setChainBusy(false);
    }
  }

  async function verifyVisible() {
    let tampered = 0;
    for (const p of proofs.slice(0, 25)) {
      const r = await verifyOne(p._id);
      if (r && r.status !== 'verified') tampered += 1;
    }
    if (tampered) toast.danger(`${tampered} record${tampered === 1 ? '' : 's'} failed verification.`);
    else toast.success('The 25 newest proofs all verified.');
  }

  const columns = [
    { key: 'seq', header: '#', sortValue: (p) => p.chainRef.sequenceNo, render: (p) => p.chainRef.sequenceNo },
    { key: 'eventType', header: 'Event', sortValue: (p) => p.eventType, render: (p) => label(p.eventType) },
    { key: 'hash', header: 'Hash', render: (p) => <code title={p.dataHash}>{p.dataHash.slice(0, 14)}…</code> },
    { key: 'createdAt', header: 'Recorded', sortValue: (p) => new Date(p.createdAt).getTime(), render: (p) => formatDateTime(p.createdAt) },
    { key: 'status', header: 'Integrity', render: (p) => <ProofBadge result={results[p._id]} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>,
      render: (p) => (
        <button
          className="btn btn--ghost btn--sm"
          disabled={busyId === p._id}
          onClick={(e) => { e.stopPropagation(); verifyOne(p._id); }}
        >
          {busyId === p._id ? 'Checking…' : 'Verify'}
        </button>
      ),
    },
  ];

  const PCSV = {
    seq: (p) => p.chainRef.sequenceNo, eventType: (p) => p.eventType, hash: (p) => p.dataHash,
    createdAt: (p) => p.createdAt || '', status: (p) => results[p._id]?.status || 'not checked',
  };
  columns.forEach((c) => { if (PCSV[c.key]) c.csvValue = PCSV[c.key]; });

  return (
    <div className="app-page">
      <h1 className="page-title">Audit proofs</h1>
      <p className="page-subtitle">
        A tamper-evident SHA-256 hash-chain of every critical event. MongoDB stays the source of truth; these proofs show a record hasn’t changed since it was logged.
      </p>

      <div className="stats-grid">
        <Card className="stat-card">
          <p className="stat-card__value">{total}</p>
          <p className="stat-card__label">Proofs on chain</p>
          <p className="stat-card__note">internal hash-chain</p>
        </Card>
        <Card className="stat-card">
          <p className="stat-card__value stat-card__value--sm">
            {chain ? (
              chain.valid ? <span className="ok-text"><ShieldCheck size={22} aria-hidden="true" /> Intact</span> : <span className="bad-text"><ShieldAlert size={22} aria-hidden="true" /> Broken</span>
            ) : '—'}
          </p>
          <p className="stat-card__label">Chain integrity</p>
          <p className="stat-card__note">{chain ? (chain.valid ? `${chain.length} links verified` : `Broken at #${chain.brokenAtSequence}: ${chain.reason}`) : 'not checked yet'}</p>
        </Card>
      </div>

      <div className="contact-actions">
        <button className="btn btn--primary" onClick={verifyChain} disabled={chainBusy}>{chainBusy ? 'Verifying…' : 'Verify entire chain'}</button>
        <button className="btn btn--ghost" onClick={verifyVisible} disabled={proofs.length === 0 || busyId !== null}>Verify newest 25 records</button>
      </div>

      {error && <p className="form-error mt-4" role="alert">{error}</p>}

      <Card className="mt-4">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : (
          <DataTable
            columns={columns}
            rows={proofs}
            rowKey={(p) => p._id}
            searchText={(p) => `${label(p.eventType)} ${p.dataHash} ${p.chainRef.sequenceNo}`}
            searchLabel="Search proofs"
            emptyIcon={Link2}
            emptyTitle="No proofs yet"
            emptyAction={<Link className="btn btn--ghost btn--sm" to="/admin/incidents">View incidents</Link>}
            emptyText="Proofs are created automatically when an SOS, zone violation, risk escalation or incident occurs."
            onRowClick={(p) => setExpandedId(expandedId === p._id ? null : p._id)}
            expandedId={expandedId}
            renderExpanded={(p) => (
              <div className="proof-detail">
                <dl>
                  <dt>Data hash</dt><dd><code>{p.dataHash}</code></dd>
                  <dt>Chain hash</dt><dd><code>{p.chainHash || '—'}</code></dd>
                  <dt>Previous hash</dt><dd><code>{p.chainRef.previousHash || 'GENESIS'}</code></dd>
                </dl>
                <ProofChecks result={results[p._id]} />
              </div>
            )}
            caption="Audit proofs, newest first. Select a row for the full hashes."
            csvName="audit-proofs.csv"
          />
        )}
      </Card>
    </div>
  );
}

export default Blockchain;
