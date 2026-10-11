import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const lastRefresh = useRef(0);

  // Khôi phục phiên đăng nhập khi tải lại trang
  useEffect(() => {
    // Remove legacy JavaScript-readable credentials; restore only the server cookie.
    try { localStorage.removeItem('token'); } catch {}
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Hết phiên ở bất kỳ yêu cầu nào: xoá người dùng để trang đưa về màn hình đăng nhập kèm lời báo.
  useEffect(() => {
    const expired = () => {
      setUser((current) => {
        if (current) setSessionExpired(true);
        return null;
      });
    };
    window.addEventListener('gao:session-expired', expired);
    return () => window.removeEventListener('gao:session-expired', expired);
  }, []);

  /*
   * Giữ phiên khi trang còn mở: gia hạn mỗi 15 phút, và ngay khi quay lại tab / máy thức dậy /
   * có mạng lại nếu đã quá 10 phút từ lần gia hạn trước. Mỗi token chỉ sống 1 giờ.
   */
  useEffect(() => {
    if (!user) return undefined;
    lastRefresh.current = Date.now();
    const refresh = () => {
      lastRefresh.current = Date.now();
      api.refreshSession().catch(() => { /* 401 đã được xử lý qua sự kiện hết phiên */ });
    };
    const refreshIfStale = () => {
      if (!document.hidden && Date.now() - lastRefresh.current > 10 * 60_000) refresh();
    };
    const timer = window.setInterval(refresh, 15 * 60_000);
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    window.addEventListener('online', refreshIfStale);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
      window.removeEventListener('online', refreshIfStale);
    };
  }, [user?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuth = ({ user }) => {
    setSessionExpired(false);
    setUser(user);
    return user;
  };

  const value = {
    user,
    loading,
    sessionExpired,
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
