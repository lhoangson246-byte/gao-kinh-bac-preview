import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const ADMIN_TAB_PERMISSIONS = ['orders.view', 'products.manage', 'customers.manage', 'revenue.view'];

/**
 * Hàng tab dưới thanh trên cùng ở các trang của nhân viên (giao hàng, công nợ, chấm công). Luôn hiện
 * cả trên điện thoại, vì ở đó thanh trên cùng ẩn các nút phụ cho đủ chỗ.
 */
export default function StaffNav() {
  const { user, can } = useAuth();
  const isAdmin = user?.role === 'admin';
  const links = [
    !isAdmin && can('delivery') && ['/quan-tri/giao-hang', '🛵 Giao hàng'],
    can('debt.view') && ['/quan-tri/cong-no', '📒 Công nợ'],
    ['/quan-tri/cham-cong', '⏱ Chấm công'],
    (isAdmin || ADMIN_TAB_PERMISSIONS.some((p) => can(p))) && ['/quan-tri', '▤ Quản trị'],
  ].filter(Boolean);
  if (links.length < 2) return null;
  return (
    <nav className="staff-nav" aria-label="Trang làm việc">
      {links.map(([to, label]) => <NavLink key={to} to={to} end>{label}</NavLink>)}
    </nav>
  );
}
