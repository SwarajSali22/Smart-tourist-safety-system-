import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { api } from '../../api/client.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useRiskBoard } from '../../shared/hooks/useRiskBoard.js';
import { useNow } from '../../shared/hooks/useNow.js';
import Badge from '../../shared/components/ui/Badge.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { label, RISK_RANK, RISK_VARIANT, timeAgo } from '../../shared/utils/format.js';

/** Registered tourists with their device, live risk level and last-seen time. */
function TouristDirectory() {
  const now = useNow(30000);
  const risk = useRiskBoard();
  const [tourists, setTourists] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/tourists').then((data) => setTourists(data.tourists || [])),
      api.get('/devices').then((data) => setDevices(data.devices || [])).catch(() => {}),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useOnReconnect(() => {
    api.get('/tourists').then((d) => setTourists(d.tourists || [])).catch(() => {});
    api.get('/devices').then((d) => setDevices(d.devices || [])).catch(() => {});
  });

  const deviceByTourist = {};
  devices.forEach((d) => { if (d.tourist?._id) deviceByTourist[d.tourist._id] = d; });

  const columns = [
    { key: 'name', header: 'Name', sortValue: (t) => t.name.toLowerCase(), render: (t) => <Link to={`/admin/map?tourist=${t._id}`}>{t.name}</Link> },
    { key: 'email', header: 'Email', sortValue: (t) => t.email },
    { key: 'phone', header: 'Phone', render: (t) => t.phone || '—' },
    { key: 'device', header: 'Device', render: (t) => deviceByTourist[t._id]?.deviceId || '—' },
    {
      key: 'risk', header: 'Risk',
      sortValue: (t) => risk.byTourist[t._id]?.score ?? -1,
      render: (t) => {
        const r = risk.byTourist[t._id];
        return r ? <Badge variant={RISK_VARIANT[r.level]}>{label(r.level)} · {r.score}</Badge> : <span className="form-hint">No data</span>;
      },
    },
    { key: 'lastSeen', header: 'Last seen', sortValue: (t) => (deviceByTourist[t._id]?.lastSeen ? new Date(deviceByTourist[t._id].lastSeen).getTime() : null), render: (t) => (deviceByTourist[t._id]?.lastSeen ? timeAgo(deviceByTourist[t._id].lastSeen, now) : '—') },
    { key: 'isActive', header: 'Account', sortValue: (t) => (t.isActive ? 1 : 0), render: (t) => <Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge> },
  ];

  return (
    <div className="app-page">
      <h1 className="page-title">Tourist directory</h1>
      <p className="page-subtitle">Click a name to find them on the live map.</p>

      {error && <p className="form-error" role="alert">{error}</p>}

      <Card>
        {loading ? (
          <SkeletonRows rows={6} />
        ) : (
          <DataTable
            columns={columns}
            rows={[...tourists].sort((a, b) => (RISK_RANK[risk.byTourist[b._id]?.level] ?? -1) - (RISK_RANK[risk.byTourist[a._id]?.level] ?? -1))}
            searchText={(t) => `${t.name} ${t.email} ${t.phone || ''} ${deviceByTourist[t._id]?.deviceId || ''}`}
            searchLabel="Search tourists"
            emptyIcon={Users}
            emptyTitle="No tourists registered yet"
            emptyText="Tourists appear here after they register from the public sign-up page. Once they do, assign each one a device."
            emptyAction={<Link className="btn btn--primary btn--sm" to="/admin/devices">Go to Devices</Link>}
            caption="Registered tourists"
          />
        )}
      </Card>
    </div>
  );
}

export default TouristDirectory;
