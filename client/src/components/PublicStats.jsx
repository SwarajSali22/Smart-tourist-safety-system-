import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useCountUp } from '../shared/hooks/useCountUp.js';

function Stat({ value, label }) {
  const shown = useCountUp(value);
  return (
    <li className="public-stat">
      <span className="public-stat__value" aria-hidden="true">{shown.toLocaleString()}</span>
      <span className="sr-only">{value.toLocaleString()}</span>
      <span className="public-stat__label">{label}</span>
    </li>
  );
}

/** Landing-page numbers from the public GET /api/stats (counts only). Hidden if the API is unreachable. */
function PublicStats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/stats').then((d) => { if (!cancelled) setStats(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!stats) return null;
  return (
    <ul className="public-stats" aria-label="Platform statistics">
      <Stat value={stats.touristsProtected} label="Tourists protected" />
      <Stat value={stats.activeZones} label="Active safety zones" />
      <Stat value={stats.incidentsResolved} label="Incidents resolved" />
    </ul>
  );
}

export default PublicStats;
