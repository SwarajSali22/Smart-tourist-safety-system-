import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, tokens } from '../../api/client.js';
import { connectSocket, disconnectSocket } from '../socket/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(() => Boolean(tokens.getAccess())); // true while we re-hydrate from storage

  // Re-hydrate: if tokens exist in localStorage, fetch the current user
  useEffect(() => {
    const access = tokens.getAccess();
    if (!access) return;

    api.get('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  // Keep the socket connection in step with auth state — connect once we
  // know who the user is, disconnect on logout.
  useEffect(() => {
    if (user) {
      connectSocket(tokens.getAccess());
    } else {
      disconnectSocket();
    }
  }, [user]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    tokens.set(data.accessToken, data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (fields) => {
    const data = await api.post('/auth/register', fields);
    tokens.set(data.accessToken, data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
    tokens.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
