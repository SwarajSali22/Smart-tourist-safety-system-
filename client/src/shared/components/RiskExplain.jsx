import Badge from './ui/Badge.jsx';
import { label, RISK_VARIANT, formatDateTime } from '../utils/format.js';

/**
 * Explains one RiskAssessment: the score, the level and what each factor contributed.
 * The score is rule-based / hybrid (deterministic rules + a weighted score) — never described as AI.
 * Assessments saved before explanations existed show the factor values without the sentences.
 */
function RiskExplain({ assessment }) {
  if (!assessment) return null;
  const rows = assessment.explanation?.length
    ? assessment.explanation
    : Object.entries(assessment.factors || {}).map(([key, points]) => ({ key, label: label(key.replace(/Score$/, '')), points, detail: null }));
  const active = rows.filter((r) => r.points > 0);

  return (
    <div className="risk-explain">
      <p className="risk-explain__head">
        <strong className="risk-explain__score">{assessment.score}</strong><span className="form-hint">/ 100</span>{' '}
        <Badge variant={RISK_VARIANT[assessment.level]}>{label(assessment.level)}</Badge>
        {assessment.ruleTriggered && <> <Badge variant="danger">Rule: {label(assessment.ruleName)}</Badge></>}
      </p>
      {assessment.locationStale && (
        <p className="notice notice--warn">{assessment.locationAgeMin != null ? `The position behind this score was ${assessment.locationAgeMin} min old` : 'No location had been reported'}, so zone risk was not counted. Stale data is not proof the tourist is safe or in danger.</p>
      )}
      {assessment.outdated && <p className="notice notice--warn">This score is outdated and does not describe the tourist's situation now.</p>}
      {assessment.ruleTriggered && (
        <p className="form-hint">An emergency rule set the level to critical regardless of the score below.</p>
      )}
      <ul className="risk-explain__list">
        {(active.length ? active : rows).map((r) => (
          <li key={r.key}>
            <span className="risk-explain__row">
              <span>{r.label}</span>
              <span className="form-hint">{r.points}{r.max ? ` / ${r.max}` : ''}</span>
            </span>
            {r.max > 0 && <span className="meter meter--low risk-explain__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (r.points / r.max) * 100)}%` }} /></span>}
            {r.detail && <small className="form-hint">{r.detail}</small>}
          </li>
        ))}
      </ul>
      {active.length === 0 && <p className="form-hint">No factor is currently adding risk.</p>}
      <p className="form-hint">
        Rule-based assessment (emergency rules plus a weighted score) · evaluated {formatDateTime(assessment.evaluatedAt)}. It is advisory and is not a trained AI model.
      </p>
    </div>
  );
}

export default RiskExplain;
