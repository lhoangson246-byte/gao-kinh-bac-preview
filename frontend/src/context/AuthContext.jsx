import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Khôi phục phiên đăng nhập khi tải lại trang
  useEffect(() => {
    // Remove legacy JavaScript-readable credentials; restore only the server cookie.
    try { localStorage.removeItem('token'); } catch {}
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const handleAuth = ({ user }) => {
    setUser(user);
    return user;
  };

  const value = {
    user,
    loading,
    isAdmin: user?.role === 'admin',
    login: async (payload) => handleAuth(await api.login(payload)),
    register: async (payload) => handleAuth(await api.register(payload)),
    updateProfile: async (payload) => {
      const { user } = await api.updateMe(payload);
      setUser(user);
      return user;
    },
    logout: async () => {
      try { await api.logout(); } catch (err) { if (err.status !== 401) throw err; }
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
