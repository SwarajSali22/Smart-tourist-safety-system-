import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';

/**
 * Result badge — icon + text, never colour alone.
 *  Verified — hash and chain match the live record
 *  Modified — the record (or its proof) changed after it was hashed
 *  Missing  — the source record no longer exists
 *  Failed   — the check itself could not run (not a verdict on the record)
 */
const PROOF_BADGES = {
  verified: ['badge--success', ShieldCheck, 'Verified'],
  modified: ['badge--danger', ShieldAlert, 'Modified'],
  missing: ['badge--danger', ShieldX, 'Missing'],
  failed: ['badge--warning', ShieldQuestion, 'Check failed'],
};

export function ProofBadge({ result }) {
  if (!result) return <span className="badge badge--neutral">Not checked</span>;
  const [cls, Icon, text] = PROOF_BADGES[result.status] || PROOF_BADGES.failed;
  return (
    <span className={`badge ${cls}`}>
      <Icon size={13} aria-hidden="true" />
      {text}
    </span>
  );
}

const CHECK_LABELS = {
  payloadIntact: 'Stored payload matches its hash',
  chainIntact: 'Chain link is intact',
  sourceFound: 'Source record still exists',
  sourceMatches: 'Source record unchanged since it was hashed',
};

/** Itemised list of the individual integrity checks behind a verify result. */
export function ProofChecks({ result }) {
  if (!result?.checks) return null;
  return (
    <ul className="proof-checks">
      {Object.entries(result.checks).map(([key, ok]) => (
        <li key={key} className={ok ? 'proof-checks__ok' : 'proof-checks__bad'}>
          <span aria-hidden="true">{ok ? '✓' : '✗'}</span> {CHECK_LABELS[key] || key}
          <span className="sr-only">{ok ? ' — passed' : ' — failed'}</span>
        </li>
      ))}
    </ul>
  );
}
