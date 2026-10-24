import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, reconnecting, retryRestore, isAdmin } = useAuth();
  const location = useLocation();
  const { t } = useI18n();

  // Mất mạng lúc mở app: vẫn đang đăng nhập, chờ mạng rồi tự vào lại — không về trang đăng nhập.
  if (loading && reconnecting) {
    return (
      <div className="loading-state page-loading reconnecting" role="status">
        <span></span>
        <strong>{t('common.reconnecting')}</strong>
        <small>{t('common.reconnectingBody')}</small>
        <button type="button" className="btn btn-secondary" onClick={retryRestore}>{t('common.retry')}</button>
      </div>
    );
  }

  if (loading) {
    return <div className="loading-state page-loading" role="status"><span></span>{t('common.loading')}</div>;
  }

  if (!user) {
    return <Navigate to="/dang-nhap" state={{ from: location.pathname }} replace />;
  }

  // Quyền cũng được máy chủ kiểm tra lại ở mọi API quản trị.
  if (adminOnly && !isAdmin) {
    return (
      <div className="empty empty-page">
        <h1>{t('common.noAccess')}</h1>
        <p>{t('common.noAccessBody')}</p>
        <Link className="btn btn-primary btn-large" to="/">{t('common.backToShop')}</Link>
      </div>
    );
  }

  return children;
}
