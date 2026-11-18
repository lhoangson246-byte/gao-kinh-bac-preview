import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requireStaff } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { normalizePhone, toInteger } from '../validate.js';
import { shapeProfile } from '../customer-profiles.js';

/**
 * /api/admin/customer-profiles — hồ sơ khách tự lưu từ các đơn (18/11/2026).
 *  - GET /lookup?phone= : nhân viên tạo đơn gõ số điện thoại thì điền sẵn tên, địa chỉ, định vị.
 *  - GET /?q=&offset=   : danh sách ở Quản trị → Khách hàng.
 * Cần quyền tạo đơn hoặc quản lý khách hàng (kiểm tra ở máy chủ).
 */
const router = Router();
router.use(requireAuth, requireStaff, validateRoutes('customer-profiles'));
router.use((req, res, next) => (can(req.user, 'orders.create') || can(req.user, 'customers.manage')
  ? next()
  : res.status(403).json({ message: 'Tài khoản của bạn chưa được cấp quyền này. Vui lòng hỏi chủ cửa hàng.' })));

const SELECT = `SELECT p.*, o.code AS last_order_code FROM customer_profiles p LEFT JOIN orders o ON o.id = p.last_order_id`;
const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
const PAGE = 30;

router.get('/lookup', (req, res) => {
  const phone = normalizePhone(req.query.phone);
  res.json({ profile: phone ? shapeProfile(db.prepare(`${SELECT} WHERE p.phone = ?`).get(phone)) : null });
});

router.get('/', (req, res) => {
  const q = fold(String(req.query.q || '').trim());
  const digits = String(req.query.q || '').replace(/\D/g, '');
  const offset = toInteger(req.query.offset, { min: 0, max: 100000 }) ?? 0;
  // Số khách vài nghìn: lọc không dấu ở đây cho "ly thai to" ra "Lý Thái Tổ".
  const rows = db.prepare(`${SELECT} ORDER BY p.last_order_at DESC LIMIT 5000`).all()
    .filter((r) => !q || (digits.length >= 3 && r.phone.includes(digits)) || fold(`${r.full_name} ${r.address}`).includes(q));
  res.json({ profiles: rows.slice(offset, offset + PAGE).map(shapeProfile), total: rows.length, offset, limit: PAGE });
});

export default router;
