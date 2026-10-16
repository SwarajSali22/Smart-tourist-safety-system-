import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import EmptyState from './ui/EmptyState.jsx';
import { SkeletonRows } from './ui/Skeleton.jsx';
import { label, RISK_VARIANT, timeAgo } from '../utils/format.js';
import { useNow } from '../hooks/useNow.js';

/** Per-tourist live risk list: score bar + a text level (never colour alone). */
function RiskBoard({ assessments, loading, error, limit = 6 }) {
  const now = useNow(30000);
  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <p className="form-error">{error}</p>;
  if (assessments.length === 0) {
    return (
      <EmptyState icon={ShieldCheck} title="No risk scores yet">
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
              </small>
              <div
                className={`meter meter--${a.level}`}
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
              <Badge variant={RISK_VARIANT[a.level]}>{label(a.level)}</Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default RiskBoard;
