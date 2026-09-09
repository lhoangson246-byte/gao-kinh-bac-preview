import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { LIMITS } from '../constants.js';
import { HttpError, cleanText, normalizePhone, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.use(validateRoutes('customers'));

// Không bao giờ trả password_hash ra ngoài.
const PUBLIC = 'id, full_name, email, phone, role, is_locked, created_at';

/** Đọc một tài khoản KHÁCH HÀNG. Tài khoản quản trị không nằm trong phạm vi quản lý này. */
function findCustomer(id) {
  const user = db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id);
  if (!user) throw new HttpError(404, 'Không tìm thấy tài khoản.');
  if (user.role === 'admin') {
    throw new HttpError(403, 'Không thao tác được trên tài khoản quản trị ở đây.');
  }
  return user;
}

/** GET /api/admin/customers?q=&locked=&limit=&offset=
 *  Danh sách khách kèm số đơn đã đặt. q tìm theo tên, số điện thoại hoặc email.
 */
router.get('/', (req, res, next) => {
  try {
    const limit = toInteger(req.query.limit, { min: 1, max: 100 }) ?? 20;
    const offset = toInteger(req.query.offset, { min: 0, max: 100_000 }) ?? 0;
    const q = cleanText(req.query.q, 60);
    const locked = req.query.locked;

    const where = ["u.role = 'customer'"];
    const filterParams = [];

    if (q) {
      const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const phone = normalizePhone(q);
      where.push(`(
        u.full_name LIKE ? ESCAPE '\\'
        OR IFNULL(u.email, '') LIKE ? ESCAPE '\\'
        OR IFNULL(u.phone, '') LIKE ? ESCAPE '\\'
        OR (? <> '' AND u.phone = ?)
      )`);
      const like = `%${escaped}%`;
      const normalizedPhone = phone || '';
      filterParams.push(like, like, like, normalizedPhone, normalizedPhone);
    }
    if (locked === '1') where.push('u.is_locked = 1');
    if (locked === '0') where.push('u.is_locked = 0');

    const clause = `WHERE ${where.join(' AND ')}`;
    // Positional bindings work consistently with both better-sqlite3 locally and
    // the remote libSQL protocol used by Turso.
    const total = db.prepare(`SELECT COUNT(*) c FROM users u ${clause}`).get(...filterParams).c;

    const customers = db.prepare(`
      SELECT ${PUBLIC.split(', ').map((c) => `u.${c}`).join(', ')},
             (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
             (SELECT COALESCE(SUM(o.total), 0) FROM orders o
               WHERE o.user_id = u.id AND o.status = 'completed') AS spent,
             (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id = u.id) AS last_order_at
      FROM users u ${clause}
      ORDER BY u.id DESC LIMIT ? OFFSET ?
    `).all(...filterParams, limit, offset);

    res.json({ customers, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/customers/:id — chi tiết một khách kèm đơn gần đây */
router.get('/:id', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    const customer = findCustomer(id);

    const orders = db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10')
      .all(id);
    const addresses = db
      .prepare('SELECT * FROM delivery_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC')
      .all(id);

    res.json({ customer, orders, addresses });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/customers/:id/reset-password
 *  Cửa hàng đặt lại mật khẩu giúp khách quên mật khẩu.
 *  Mật khẩu cũ đã được băm nên không ai đọc lại được — chỉ đặt mới.
 */
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    const before = findCustomer(id);

    const password = req.body?.password;


    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
      .run(hash, id);

    writeAdminAudit(req, {
      action: 'reset_password', entityType: 'customer_account', entityId: id,
      before: { id: before.id }, after: { password_reset: true },
    });

    res.json({
      ok: true,
      message: 'Đã đặt lại mật khẩu. Hãy đọc mật khẩu mới cho khách và nhắc khách tự đổi lại.',
      customer: db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/customers/:id/lock — khoá hoặc mở khoá tài khoản khách */
router.patch('/:id/lock', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    if (id === req.user.id) throw new HttpError(400, 'Không thể tự khoá tài khoản của mình.');
    const before = findCustomer(id);

    const locked = req.body?.is_locked ? 1 : 0;
    db.prepare('UPDATE users SET is_locked = ?, session_version = session_version + 1 WHERE id = ?').run(locked, id);
    const customer = db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id);
    writeAdminAudit(req, {
      action: locked ? 'lock' : 'unlock', entityType: 'customer_account', entityId: id,
      before, after: customer,
    });

    res.json({
      customer,
      message: locked
        ? 'Đã khoá tài khoản. Khách không đăng nhập và không đặt hàng được nữa.'
        : 'Đã mở khoá tài khoản.',
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/admin/customers/:id — sửa tên khách (dùng khi khách báo sai chính tả) */
router.put('/:id', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    const before = findCustomer(id);

    const fullName = cleanText(req.body?.full_name, LIMITS.name);
    if (!fullName || fullName.length < 2) {
      throw new HttpError(400, 'Vui lòng nhập họ tên.', { full_name: 'Vui lòng nhập họ tên.' });
    }
    db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName, id);
    const customer = db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id);
    writeAdminAudit(req, {
      action: 'rename', entityType: 'customer_account', entityId: id, before, after: customer,
    });
    res.json({ customer });
  } catch (err) {
    next(err);
  }
});

export default router;
