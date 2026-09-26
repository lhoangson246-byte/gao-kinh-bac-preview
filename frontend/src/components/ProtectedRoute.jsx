import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  const { t } = useI18n();

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
