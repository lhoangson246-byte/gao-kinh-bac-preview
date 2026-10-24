import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Đang chờ mạng để khôi phục phiên (mở app lúc điện thoại vừa mở khoá, Wi-Fi/4G chưa kịp nối).
  const [reconnecting, setReconnecting] = useState(false);
  const lastRefresh = useRef(0);
  const refreshing = useRef(false);
  const retryRestore = useRef(() => {});

  /*
   * Khôi phục phiên khi mở app. CHỈ coi là chưa đăng nhập khi máy chủ trả lời rõ ràng (401/403).
   * Mất mạng hoặc máy chủ đang khởi động (lỗi mạng, 5xx) thì giữ màn hình chờ và tự thử lại
   * (1s, 2s, 4s… tối đa 30s, và ngay khi có mạng lại / quay lại app), không đẩy về trang đăng nhập.
   */
  useEffect(() => {
    // Remove legacy JavaScript-readable credentials; restore only the server cookie.
    try { localStorage.removeItem('token'); } catch {}
    let cancelled = false;
    let timer = 0;
    let attempt = 0;
    let pending = false;
    const restore = async () => {
      window.clearTimeout(timer);
      if (pending) return;
      pending = true;
      try {
        const { user } = await api.me();
        if (cancelled) return;
        lastRefresh.current = Date.now();   // /auth/me vừa xác nhận phiên còn sống
        setUser(user);
        setReconnecting(false);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
          setUser(null);
          setReconnecting(false);
          setLoading(false);
          return;
        }
        setReconnecting(true);
        attempt += 1;
        timer = window.setTimeout(restore, Math.min(30_000, 1000 * 2 ** (attempt - 1)));
      } finally {
        pending = false;
      }
    };
    retryRestore.current = () => { attempt = 0; restore(); };
    restore();
    const again = () => { if (!document.hidden && timer) { attempt = 0; restore(); } };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    };
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
   * Duy trì đăng nhập cho tới khi bấm Đăng xuất (sliding 90 ngày): mỗi lần mở ứng dụng thì gia
   * hạn cookie thêm 90 ngày, trang để mở lâu thì gia hạn 6 giờ/lần, quay lại app / máy mở khoá /
   * có mạng lại thì gia hạn âm thầm nếu đã quá 15 phút. Gia hạn lỗi vì mạng thì im lặng thử lại
   * lần sau; chỉ 401 thật từ máy chủ mới đưa về trang đăng nhập (qua sự kiện hết phiên).
   */
  useEffect(() => {
    if (!user) return undefined;
    const refresh = async () => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        await api.refreshSession();
        lastRefresh.current = Date.now();
      } catch { /* mất mạng: thử lại ở lần mở app / có mạng sau; 401 đã xử lý qua sự kiện */ }
      finally { refreshing.current = false; }
    };
    const refreshIfStale = () => {
      if (!document.hidden && navigator.onLine !== false && Date.now() - lastRefresh.current > 15 * 60_000) refresh();
    };
    refresh();
    const timer = window.setInterval(refresh, 6 * 60 * 60_000);
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
    reconnecting,
    retryRestore: () => retryRestore.current(),
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
