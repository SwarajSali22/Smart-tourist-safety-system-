import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { FRESH_LABEL, FRESH_VARIANT, freshnessOf, sourceOf } from '../../shared/utils/freshness.js';

/** Registered tourists with their device, live risk level and last-seen time. */
function TouristDirectory() {
  const now = useNow(30000);
  const risk = useRiskBoard();
  const [params, setParams] = useSearchParams();
  const statusFilter = params.get('status') || '';
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
    { key: 'name', header: 'Name', sortValue: (t) => t.name.toLowerCase(), render: (t) => <Link to={`/admin/tourists/${t._id}`}>{t.name}</Link> },
    { key: 'email', header: 'Email', sortValue: (t) => t.email },
    { key: 'phone', header: 'Phone', render: (t) => t.phone || '—' },
    { key: 'device', header: 'Device', render: (t) => (deviceByTourist[t._id] ? <span className="badge-row">{deviceByTourist[t._id].deviceId} <Badge variant={sourceOf(deviceByTourist[t._id]) === 'Simulator' ? 'info' : 'neutral'}>{sourceOf(deviceByTourist[t._id])}</Badge></span> : '—') },
    {
      key: 'risk', header: 'Risk',
      sortValue: (t) => risk.byTourist[t._id]?.score ?? -1,
      render: (t) => {
        const r = risk.byTourist[t._id];
        return r ? <Badge variant={RISK_VARIANT[r.level]}>{label(r.level)} · {r.score}</Badge> : <span className="form-hint">No data</span>;
      },
    },
    { key: 'lastSeen', header: 'Last seen', sortValue: (t) => (deviceByTourist[t._id]?.lastSeen ? new Date(deviceByTourist[t._id].lastSeen).getTime() : null), render: (t) => { const d = deviceByTourist[t._id]; if (!d) return '—'; const f = freshnessOf(d.lastSeen, now); return <span className="badge-row">{d.lastSeen ? timeAgo(d.lastSeen, now) : 'never'} <Badge variant={FRESH_VARIANT[f]}>{FRESH_LABEL[f]}</Badge></span>; } },
    { key: 'isActive', header: 'Account', sortValue: (t) => (t.isActive ? 1 : 0), render: (t) => <Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge> },
  ];

  const visibleTourists = [...tourists]
    .filter((t) => {
      const d = deviceByTourist[t._id];
      if (statusFilter === 'active') return d && (d.status === 'active' || d.status === 'emergency');
      if (statusFilter === 'emergency') return d && (d.status === 'emergency' || d.emergencyMode);
      if (statusFilter === 'nodevice') return !d;
      return true;
    })
    .sort((a, b) => (RISK_RANK[risk.byTourist[b._id]?.level] ?? -1) - (RISK_RANK[risk.byTourist[a._id]?.level] ?? -1));

  const CSV = {
    name: (t) => t.name, email: (t) => t.email, phone: (t) => t.phone || '',
    device: (t) => deviceByTourist[t._id]?.deviceId || '', risk: (t) => risk.byTourist[t._id]?.level || '',
    lastSeen: (t) => deviceByTourist[t._id]?.lastSeen || '', isActive: (t) => (t.isActive ? 'active' : 'inactive'),
  };
  columns.forEach((c) => { if (CSV[c.key]) c.csvValue = CSV[c.key]; });

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
            rows={visibleTourists}
            toolbar={
              <label className="filter">
                <span className="sr-only">Filter by status</span>
                <select className="form-input" value={statusFilter} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {}, { replace: true })} aria-label="Filter by status">
                  <option value="">All tourists</option>
                  <option value="active">Active (device reporting)</option>
                  <option value="emergency">In emergency</option>
                  <option value="nodevice">No device yet</option>
                </select>
              </label>
            }
            searchText={(t) => `${t.name} ${t.email} ${t.phone || ''} ${deviceByTourist[t._id]?.deviceId || ''}`}
            searchLabel="Search tourists"
            emptyIcon={Users}
            emptyTitle="No tourists registered yet"
            emptyText="Tourists appear here after they register from the public sign-up page. Once they do, assign each one a device."
            emptyAction={<Link className="btn btn--primary btn--sm" to="/admin/devices">Go to Devices</Link>}
            caption="Registered tourists"
            csvName="tourists.csv"
          />
        )}
      </Card>
    </div>
  );
}

export default TouristDirectory;
