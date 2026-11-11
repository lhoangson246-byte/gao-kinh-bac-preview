import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requirePermission, requireStaff } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText, normalizePhone, toInteger } from '../validate.js';
import { LIMITS } from '../constants.js';
import { writeAdminAudit } from '../audit.js';
import { getWholesale, shapeWholesale, wholesaleCode, wholesalePrices } from '../wholesale.js';

/**
 * /api/admin/wholesale — khách buôn. Nhân viên được tạo đơn (orders.create) xem danh sách và bảng giá
 * để chọn khách khi tạo đơn; chỉ người có quyền `wholesale.manage` (mặc định chủ cửa hàng) mới thêm,
 * sửa khách và đặt bảng giá cố định.
 */
const router = Router();
router.use(requireAuth, requireStaff, validateRoutes('wholesale'));

const canSee = (req, res, next) => (can(req.user, 'orders.create') || can(req.user, 'wholesale.manage')
  ? next()
  : res.status(403).json({ message: 'Tài khoản của bạn chưa được cấp quyền này. Vui lòng hỏi chủ cửa hàng.' }));
const manage = requirePermission('wholesale.manage');

const LIST_SQL = `
  SELECT w.*, (SELECT COUNT(*) FROM wholesale_prices p WHERE p.customer_id = w.id) AS price_count
  FROM wholesale_customers w`;

// Tìm không phân biệt hoa thường và dấu: "bep an" tìm ra "Bếp Ăn" (LIKE của SQLite chỉ bỏ qua hoa
// thường với chữ không dấu, nên lọc ở đây; số khách buôn nhỏ).
const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

/** GET /api/admin/wholesale?q=&all=1 — danh sách (mặc định chỉ khách đang hoạt động). */
router.get('/', canSee, (req, res) => {
  const q = fold(cleanText(req.query.q, 60) || '');
  const all = req.query.all === '1' && can(req.user, 'wholesale.manage');
  const rows = db.prepare(`${LIST_SQL} ${all ? '' : 'WHERE w.is_active = 1'} ORDER BY w.is_active DESC, w.company COLLATE NOCASE`).all()
    .filter((w) => !q || [w.code, w.company, w.contact_name, w.phone].some((v) => fold(v).includes(q)))
    .slice(0, 500);
  res.json({ customers: rows.map(shapeWholesale) });
});

/** GET /api/admin/wholesale/:id — thông tin khách và bảng giá cố định. */
router.get('/:id', canSee, (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const row = id && getWholesale(id);
    if (!row) throw new HttpError(404, 'Không tìm thấy khách buôn.');
    const prices = [...wholesalePrices(id)].map(([product_id, price]) => ({ product_id, price }));
    res.json({ customer: shapeWholesale(row), prices });
  } catch (err) { next(err); }
});

function readInput(body, { partial }) {
  const errors = {};
  const data = {};
  const textField = (key, max, min, message) => {
    if (body[key] === undefined && partial) return;
    const value = cleanText(body[key], max);
    if (min && (!value || value.length < min)) errors[key] = message;
    else data[key] = value;
  };
  textField('company', 160, 2, 'Nhập tên công ty / cửa hàng.');
  textField('contact_name', LIMITS.name, 2, 'Nhập tên người liên hệ.');
  textField('address', LIMITS.address, 0);
  textField('note', 300, 0);
  if (body.phone !== undefined || !partial) {
    const phone = normalizePhone(body.phone);
    if (!phone) errors.phone = 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).';
    else data.phone = phone;
  }
  if (body.is_active !== undefined) data.is_active = body.is_active ? 1 : 0;
  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu khách buôn chưa hợp lệ.', errors);
  return data;
}

/**
 * Gắn tài khoản đăng nhập cho khách buôn (khách đăng nhập bằng mã KB…). Số điện thoại đã có tài khoản
 * khách thì gắn vào tài khoản đó và KHÔNG đổi mật khẩu của khách; chưa có thì tạo tài khoản mới với
 * mật khẩu cửa hàng đặt. Gọi BÊN TRONG transaction; `hash` đã băm sẵn (hoặc null).
 */
function linkLogin(customer, hash) {
  if (customer.user_id) {
    if (hash) {
      db.prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? AND role = 'customer'")
        .run(hash, customer.user_id);
      return 'password_reset';
    }
    return null;
  }
  const existing = db.prepare('SELECT id, role FROM users WHERE phone = ?').get(customer.phone);
  if (existing) {
    if (existing.role !== 'customer') {
      throw new HttpError(409, 'Số điện thoại này là tài khoản nhân viên, không gắn làm khách buôn được.', { phone: 'Số này là tài khoản nhân viên.' });
    }
    if (db.prepare('SELECT 1 FROM wholesale_customers WHERE user_id = ? AND id <> ?').get(existing.id, customer.id)) {
      throw new HttpError(409, 'Tài khoản của số điện thoại này đã gắn với khách buôn khác.', { phone: 'Số này đã gắn với khách buôn khác.' });
    }
    db.prepare('UPDATE wholesale_customers SET user_id = ? WHERE id = ?').run(existing.id, customer.id);
    return 'linked_existing';
  }
  if (!hash) return null;
  const userId = db.prepare("INSERT INTO users (full_name, phone, password_hash, role) VALUES (?, ?, ?, 'customer')")
    .run(customer.contact_name, customer.phone, hash).lastInsertRowid;
  db.prepare('UPDATE wholesale_customers SET user_id = ? WHERE id = ?').run(userId, customer.id);
  return 'created';
}

const LOGIN_NOTE = {
  created: 'Đã tạo tài khoản: khách đăng nhập bằng mã khách buôn và mật khẩu vừa đặt.',
  linked_existing: 'Số điện thoại đã có tài khoản khách: khách đăng nhập bằng mã khách buôn với mật khẩu cũ của mình.',
  password_reset: 'Đã đặt lại mật khẩu đăng nhập cho khách buôn.',
};

const hashOf = async (password) => (password ? bcrypt.hash(password, 12) : null);

/** POST /api/admin/wholesale — thêm khách buôn; mã KB… tự cấp, cố định. */
router.post('/', manage, async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = readInput(body, { partial: false });
    const hash = await hashOf(body.password);
    const result = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM wholesale_customers WHERE phone = ? AND is_active = 1').get(data.phone)) {
        throw new HttpError(409, 'Đã có khách buôn dùng số điện thoại này.', { phone: 'Đã có khách buôn dùng số này.' });
      }
      const id = db.prepare(`
        INSERT INTO wholesale_customers (company, contact_name, phone, address, note, created_by) VALUES (?, ?, ?, ?, ?, ?)
      `).run(data.company, data.contact_name, data.phone, data.address ?? null, data.note ?? null, req.user.id).lastInsertRowid;
      db.prepare('UPDATE wholesale_customers SET code = ? WHERE id = ?').run(wholesaleCode(id), id);
      const login = linkLogin(getWholesale(id), hash);
      return { id: Number(id), login };
    })();
    const customer = shapeWholesale(getWholesale(result.id));
    writeAdminAudit(req, { action: 'create', entityType: 'wholesale_customer', entityId: result.id, after: { ...customer, login: result.login } });
    res.status(201).json({ customer, message: LOGIN_NOTE[result.login] || null });
  } catch (err) { next(err); }
});

/** PUT /api/admin/wholesale/:id — sửa thông tin, ngừng / mở lại, đặt mật khẩu đăng nhập. Mã giữ nguyên. */
router.put('/:id', manage, async (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const before = id && getWholesale(id);
    if (!before) throw new HttpError(404, 'Không tìm thấy khách buôn.');
    const body = req.body || {};
    const data = readInput(body, { partial: true });
    const hash = await hashOf(body.password);
    const login = db.transaction(() => {
      if (data.phone && db.prepare('SELECT 1 FROM wholesale_customers WHERE phone = ? AND is_active = 1 AND id <> ?').get(data.phone, id)) {
        throw new HttpError(409, 'Đã có khách buôn dùng số điện thoại này.', { phone: 'Đã có khách buôn dùng số này.' });
      }
      const keys = Object.keys(data);
      if (keys.length) {
        db.prepare(`UPDATE wholesale_customers SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...keys.map((k) => data[k]), id);
      }
      return body.password ? linkLogin(getWholesale(id), hash) : null;
    })();
    const customer = shapeWholesale(getWholesale(id));
    writeAdminAudit(req, { action: 'update', entityType: 'wholesale_customer', entityId: id, before: shapeWholesale(before), after: { ...customer, login } });
    res.json({ customer, message: LOGIN_NOTE[login] || null });
  } catch (err) { next(err); }
});

/**
 * PUT /api/admin/wholesale/:id/prices { prices: [{ product_id, price }] } — bảng giá cố định. Giá để
 * trống (null) = bỏ giá riêng, đơn của khách dùng giá web cho loại đó.
 */
router.put('/:id/prices', manage, (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id || !getWholesale(id)) throw new HttpError(404, 'Không tìm thấy khách buôn.');
    const list = Array.isArray(req.body?.prices) ? req.body.prices : [];
    const errors = {};
    const changes = [];
    for (const item of list) {
      const productId = toInteger(item?.product_id, { min: 1 });
      if (!productId) { errors.prices = 'Sản phẩm không hợp lệ.'; continue; }
      if (item.price === null || item.price === '') { changes.push([productId, null]); continue; }
      const price = toInteger(item.price, { min: 1, max: LIMITS.price });
      if (!price) errors[`price_${productId}`] = 'Giá phải là số nguyên lớn hơn 0.';
      else changes.push([productId, price]);
    }
    if (Object.keys(errors).length) throw new HttpError(400, 'Bảng giá chưa hợp lệ.', errors);
    const before = Object.fromEntries(wholesalePrices(id));
    db.transaction(() => {
      const exists = db.prepare('SELECT 1 FROM products WHERE id = ?');
      const upsert = db.prepare(`
        INSERT INTO wholesale_prices (customer_id, product_id, price, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT (customer_id, product_id) DO UPDATE SET price = excluded.price, updated_by = excluded.updated_by, updated_at = datetime('now')
      `);
      const remove = db.prepare('DELETE FROM wholesale_prices WHERE customer_id = ? AND product_id = ?');
      for (const [productId, price] of changes) {
        if (price == null) remove.run(id, productId);
        else if (exists.get(productId)) upsert.run(id, productId, price, req.user.id);
        else throw new HttpError(400, 'Có loại gạo không còn trong cửa hàng. Vui lòng tải lại trang.');
      }
    })();
    const prices = [...wholesalePrices(id)].map(([product_id, price]) => ({ product_id, price }));
    writeAdminAudit(req, { action: 'prices', entityType: 'wholesale_customer', entityId: id, before, after: Object.fromEntries(prices.map((p) => [p.product_id, p.price])) });
    res.json({ prices });
  } catch (err) { next(err); }
});

export default router;
