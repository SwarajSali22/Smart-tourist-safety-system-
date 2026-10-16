import { useEffect, useState } from 'react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../socket/socket.js';

const touristIdOf = (a) => a.tourist?._id || a.tourist;

/**
 * Latest risk assessment per tourist (admin), kept live via `risk:updated`.
 * Returns the list (highest score first) and a { touristId -> assessment } map.
 */
export function useRiskBoard() {
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/risk')
      .then((d) => setAssessments(d.assessments || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    const socket = connectSocket(tokens.getAccess());
    function onRisk(r) {
      setAssessments((list) => {
        const id = touristIdOf(r);
        const rest = list.filter((x) => touristIdOf(x) !== id);
        return [r, ...rest].sort((a, b) => b.score - a.score);
      });
    }
    socket.on('risk:updated', onRisk);
    return () => socket.off('risk:updated', onRisk);
  }, []);

  const byTourist = {};
  assessments.forEach((a) => { byTourist[touristIdOf(a)] = a; });
  return { assessments, byTourist, loading, error };
}
