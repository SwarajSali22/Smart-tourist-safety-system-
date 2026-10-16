import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Spinner from './ui/Spinner.jsx';

/**
 * Wraps a route so only authenticated users (of the right role) can access it.
 *
 * Usage:
 *   <ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>
 *   <ProtectedRoute role="tourist"><TouristDashboard /></ProtectedRoute>
 *   <ProtectedRoute><AnyAuthenticatedPage /></ProtectedRoute>
 */
function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner fullPage />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (role && user.role !== role) {
    // Authenticated but wrong role — send to their own home
    return <Navigate to={user.role === 'admin' ? '/admin' : '/tourist'} replace />;
  }

  return children;
}

export default ProtectedRoute;
