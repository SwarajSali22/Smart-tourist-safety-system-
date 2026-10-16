import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useRiskBoard } from '../../shared/hooks/useRiskBoard.js';
import Card from '../../shared/components/ui/Card.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { BarChart, HBarChart } from '../../shared/components/Charts.jsx';
import { label } from '../../shared/utils/format.js';

function Analytics() {
  const risk = useRiskBoard();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/analytics/overview').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="app-page"><h1 className="page-title">Analytics</h1><p className="form-error" role="alert">{error}</p></div>;
  if (!data) {
    return (
      <div className="app-page">
        <h1 className="page-title">Analytics</h1>
        <SkeletonRows rows={8} />
      </div>
    );
  }

  const daily = data.incidentsByDay.map((d) => {
    const dt = new Date(`${d.date}T00:00:00`);
    return { label: dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), short: dt.getDate(), value: d.count };
  });
  const total14 = daily.reduce((s, d) => s + d.value, 0);
  const levels = ['critical', 'high', 'medium', 'low'].map((lvl) => ({
    label: label(lvl),
    value: risk.assessments.filter((a) => a.level === lvl).length,
  }));

  return (
    <div className="app-page">
      <h1 className="page-title">Analytics</h1>
      <p className="page-subtitle">Incident trends, risky areas and response times</p>

      <div className="stats-grid">
        <Card className="stat-card"><p className="stat-card__value">{total14}</p><p className="stat-card__label">Incidents, last 14 days</p><p className="stat-card__note">all types</p></Card>
        <Card className="stat-card">
          <p className="stat-card__value">{data.avgAckMinutes != null ? `${data.avgAckMinutes} min` : '—'}</p>
          <p className="stat-card__label">Avg. time to acknowledge SOS</p>
          <p className="stat-card__note">{data.ackSamples ? `from ${data.ackSamples} acknowledged SOS` : 'no acknowledged SOS yet'}</p>
        </Card>
        <Card className="stat-card"><p className="stat-card__value">{risk.assessments.filter((a) => a.level === 'high' || a.level === 'critical').length}</p><p className="stat-card__label">Tourists at high risk now</p><p className="stat-card__note">high or critical</p></Card>
      </div>

      <div className="dashboard-grid dashboard-grid--even">
        <Card title="Incidents per day"><BarChart data={daily} title="Incidents per day, last 14 days" unit="incidents" /></Card>

        <Card title="Incidents by type">
          {data.incidentsByType.length === 0 ? (
            <EmptyState title="No incidents recorded yet" />
          ) : (
            <HBarChart title="Incidents by type" data={data.incidentsByType.map((t) => ({ label: label(t.type), value: t.count }))} />
          )}
        </Card>

        <Card title="Most-entered restricted zones">
          {data.riskiestZones.length === 0 ? (
            <EmptyState title="No zone entries yet">Zone entries are counted when tourists cross a boundary.</EmptyState>
          ) : (
            <HBarChart title="Zone entries" data={data.riskiestZones.map((z) => ({ label: `${z.zone} (${label(z.type)})`, value: z.entries }))} />
          )}
        </Card>

        <Card title="Tourists by current risk level">
          {risk.assessments.length === 0 ? (
            <EmptyState title="No risk scores yet" />
          ) : (
            <HBarChart title="Tourists by risk level" data={levels} />
          )}
        </Card>
      </div>
    </div>
  );
}

export default Analytics;
