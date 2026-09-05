import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading-state page-loading" role="status"><span></span>Đang tải…</div>;
  }

  if (!user) {
    return <Navigate to="/dang-nhap" state={{ from: location.pathname }} replace />;
  }

  // Quyền cũng được máy chủ kiểm tra lại ở mọi API quản trị.
  if (adminOnly && !isAdmin) {
    return (
      <div className="empty empty-page">
        <h1>Không có quyền truy cập</h1>
        <p>Trang quản trị chỉ dành cho tài khoản của cửa hàng.</p>
        <Link className="btn btn-primary btn-large" to="/">Về trang mua gạo</Link>
      </div>
    );
  }

  return children;
}
