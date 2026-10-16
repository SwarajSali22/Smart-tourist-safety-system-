import { ShieldAlert, ShieldCheck } from 'lucide-react';

/** Verified ✓ / Tampered ✗ result badge — icon + text, never colour alone. */
export function ProofBadge({ result }) {
  if (!result) return <span className="badge badge--neutral">Not checked</span>;
  const ok = result.status === 'verified';
  return (
    <span className={`badge ${ok ? 'badge--success' : 'badge--danger'}`}>
      {ok ? <ShieldCheck size={13} aria-hidden="true" /> : <ShieldAlert size={13} aria-hidden="true" />}
      {ok ? 'Verified' : 'Tampered'}
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
