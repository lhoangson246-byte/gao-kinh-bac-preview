/**
 * Phân quyền tài khoản nhân viên (01/11/2026). Chủ cửa hàng (role = 'admin') có mọi quyền và là người
 * duy nhất tạo / khoá tài khoản nhân viên và cấp quyền. Nhân viên (role = 'staff') chỉ có các quyền
 * được tick trong `users.permissions` (JSON). Quyền luôn đọc lại từ cơ sở dữ liệu ở mỗi yêu cầu,
 * nên đổi quyền hay khoá tài khoản có hiệu lực ngay.
 */

export const PERMISSIONS = {
  'orders.view': 'Xem đơn hàng',
  'orders.manage': 'Xác nhận, đổi trạng thái, huỷ đơn và phân công giao hàng',
  'orders.create': 'Tạo đơn bằng tay (khách gọi điện, nhắn Zalo)',
  'orders.export': 'Xuất Excel đơn hàng',
  'revenue.view': 'Xem doanh thu',
  'products.manage': 'Sửa sản phẩm, giá bán và tồn kho',
  'customers.manage': 'Quản lý tài khoản khách hàng',
  'retail.sell': 'Bán hàng tại quầy',
  delivery: 'Giao hàng: xem và cập nhật đơn được phân công',
  'debt.view': 'Xem trang theo dõi công nợ',
  'debt.accounting': 'Kế toán: duyệt đơn nợ, xác nhận đã thu tiền, đặt hạn công nợ',
  'debt.final': 'Mẹ duyệt tất toán đơn nợ',
  'closing.manage': 'Đóng ngày: kê tiền, lưu và xuất báo cáo cuối ngày',
  'wholesale.manage': 'Khách buôn: thêm khách buôn, mã đăng nhập và bảng giá cố định',
  'attendance.manage': 'Chấm công: xem bảng công tháng của mọi người và sửa giờ cho người quên chấm',
};
export const PERMISSION_CODES = Object.keys(PERMISSIONS);

/** Mẫu quyền để chủ cửa hàng chọn nhanh khi tạo tài khoản; vẫn tick thêm / bỏ được. */
export const PRESETS = {
  // Kế toán cập nhật các bước Chờ xác nhận → Đã xác nhận → Đang giao (02/11/2026).
  'ke-toan': { title: 'Kế toán', permissions: ['orders.view', 'orders.manage', 'orders.export', 'revenue.view', 'debt.view', 'debt.accounting', 'closing.manage', 'attendance.manage'] },
  'duyet-cuoi': { title: 'Duyệt cuối (mẹ)', permissions: ['orders.view', 'revenue.view', 'debt.view', 'debt.final'] },
  'giao-hang': { title: 'Nhân viên giao hàng', permissions: ['delivery'] },
  'ban-hang': { title: 'Nhân viên bán hàng', permissions: ['orders.view', 'orders.manage', 'orders.create', 'retail.sell'] },
};

/** Danh sách quyền hợp lệ của một tài khoản (chủ cửa hàng: tất cả; khách: không có). */
export function permissionsOf(user) {
  if (user?.role === 'admin') return [...PERMISSION_CODES];
  if (user?.role !== 'staff') return [];
  let list = user.permissions;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  return Array.isArray(list) ? PERMISSION_CODES.filter((code) => list.includes(code)) : [];
}

export const isStaffRole = (user) => user?.role === 'admin' || user?.role === 'staff';
export const can = (user, permission) => (user?.permissions || permissionsOf(user)).includes(permission);

/** Dùng sau requireAuth: chủ cửa hàng hoặc nhân viên (khách thường bị chặn). */
export function requireStaff(req, res, next) {
  if (!isStaffRole(req.user)) return res.status(403).json({ message: 'Bạn không có quyền truy cập.' });
  next();
}

/** Dùng sau requireAuth: có ÍT NHẤT MỘT trong các quyền. */
export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!permissions.some((p) => can(req.user, p))) {
      return res.status(403).json({ message: 'Tài khoản của bạn chưa được cấp quyền này. Vui lòng hỏi chủ cửa hàng.' });
    }
    next();
  };
}

/**
 * Bảng quyền cho một router: [phương thức | '*', biểu thức đường dẫn, [quyền…]]. Đường dẫn không có
 * trong bảng thì CHỈ chủ cửa hàng được vào (mặc định chặn), để route mới thêm không vô tình mở cho
 * nhân viên.
 */
export function accessTable(rules) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const path = req.path.toLowerCase();
    const rule = rules.find(([m, pattern]) => (m === '*' || m === method) && pattern.test(path));
    if (rule && rule[2].some((p) => can(req.user, p))) return next();
    return res.status(403).json({ message: 'Tài khoản của bạn chưa được cấp quyền này. Vui lòng hỏi chủ cửa hàng.' });
  };
}
