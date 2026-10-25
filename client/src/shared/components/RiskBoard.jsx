import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import EmptyState from './ui/EmptyState.jsx';
import { SkeletonRows } from './ui/Skeleton.jsx';
import { label, RISK_VARIANT, timeAgo } from '../utils/format.js';
import { useNow } from '../hooks/useNow.js';
import RiskExplain from './RiskExplain.jsx';

/** Per-tourist live risk list: score bar + a text level (never colour alone). */
function RiskBoard({ assessments, loading, error, limit = 6 }) {
  const now = useNow(30000);
  const [open, setOpen] = useState(null);
  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <p className="form-error">{error}</p>;
  if (assessments.length === 0) {
    return (
      <EmptyState icon={ShieldCheck} title="No risk scores yet" action={<Link className="btn btn--ghost btn--sm" to="/admin/devices">Register a device</Link>}>
        Scores appear once a tourist’s device starts reporting.
      </EmptyState>
    );
  }
  return (
    <ul className="risk-list">
      {assessments.slice(0, limit).map((a) => {
        const id = a.tourist?._id || a.tourist;
        return (
          <li key={a._id} className="risk-row">
            <div className="risk-row__main">
              <Link to={`/admin/map?tourist=${id}`} className="risk-row__name">{a.tourist?.name || 'Unknown tourist'}</Link>
              <small className="form-hint">
                {a.ruleTriggered ? `Rule: ${label(a.ruleName)} · ` : ''}updated {timeAgo(a.evaluatedAt, now)}
                {a.outdated && ' · outdated, not current risk'}
                {!a.outdated && a.locationStale && ' · location data is stale'}
              </small>
              <div
                className={`meter meter--${a.outdated ? 'low' : a.level}${a.outdated ? ' meter--muted' : ''}`}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={a.score}
                aria-label={`Risk score ${a.score} of 100`}
              >
                <span style={{ width: `${a.score}%` }} />
              </div>
            </div>
            <div className="risk-row__side">
              <strong className="risk-row__score">{a.score}</strong>
              {a.outdated ? <Badge variant="neutral">Outdated</Badge> : <Badge variant={RISK_VARIANT[a.level]}>{label(a.level)}</Badge>}
              <button type="button" className="link-btn risk-row__why" aria-expanded={open === a._id} onClick={() => setOpen(open === a._id ? null : a._id)}>Why?</button>
            </div>
            {open === a._id && <div className="risk-row__explain reveal"><RiskExplain assessment={a} /></div>}
          </li>
        );
      })}
    </ul>
  );
}

export default RiskBoard;
