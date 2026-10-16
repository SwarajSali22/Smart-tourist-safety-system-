import { useEffect, useState } from 'react';
import { apiGet, API_BASE_URL } from '../api/client.js';

/**
 * Calls GET /api/health on mount and reports whether the backend (and, via
 * the backend, MongoDB) is reachable. This is Phase 1's only real
 * frontend<->backend integration point — later phases replace it with
 * actual data, not just a status line.
 */
function HealthStatus() {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;

    apiGet('/health')
      .then((data) => {
        if (!cancelled) setState({ loading: false, data, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, data: null, error: error.message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return <p className="health-status">Checking backend at {API_BASE_URL}…</p>;
  }

  if (state.error) {
    return (
      <p className="health-status health-status--error">
        Cannot reach backend at {API_BASE_URL} ({state.error}). Is it running?
      </p>
    );
  }

  return (
    <p className="health-status health-status--ok">
      Backend reachable — status: <strong>{state.data.status}</strong>, database:{' '}
      <strong>{state.data.database}</strong>
    </p>
  );
}

export default HealthStatus;
