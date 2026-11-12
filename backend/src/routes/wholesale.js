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
import { parseMapLink, splitAddressMap } from '../map-link.js';

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
    res.json({ customer: shapeWholesale(row), prices: priceList(id) });
  } catch (err) { next(err); }
});

function readInput(input, { partial }) {
  const errors = {};
  const data = {};
  // Link Google Maps dán thẳng vào ô địa chỉ: tách ra làm định vị (nếu ô định vị đang trống).
  const pasted = splitAddressMap(input.address);
  const body = !pasted ? input : {
    ...input, address: pasted.address || null,
    map_url: typeof input.map_url === 'string' && input.map_url.trim() ? input.map_url : pasted.url,
  };
  if (typeof body.address === 'string' && body.address.length > LIMITS.address) {
    throw new HttpError(400, 'Dữ liệu khách buôn chưa hợp lệ.', { address: `Địa chỉ dài quá ${LIMITS.address} ký tự.` });
  }
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
  if (body.map_url !== undefined) {
    const map = parseMapLink(body.map_url);
    if (map.error) errors.map_url = map.error;
    else data.map_url = map.url;
  }
  if (body.is_active !== undefined) data.is_active = body.is_active ? 1 : 0;
  Object.assign(errors, priceErrors(body.prices));
  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu khách buôn chưa hợp lệ.', errors);
  return data;
}

/** Đọc danh sách giá gửi lên: [[id sản phẩm, giá | null]]; lỗi ghi vào `errors`. */
function readPrices(list, errors = {}) {
  const changes = [];
  for (const item of Array.isArray(list) ? list : []) {
    const productId = toInteger(item?.product_id, { min: 1 });
    if (!productId) { errors.prices = 'Sản phẩm không hợp lệ.'; continue; }
    if (item.price === null || item.price === '') { changes.push([productId, null]); continue; }
    const price = toInteger(item.price, { min: 1, max: LIMITS.price });
    if (!price) errors[`price_${productId}`] = 'Giá phải là số nguyên lớn hơn 0.';
    else changes.push([productId, price]);
  }
  return changes;
}
const priceErrors = (list) => { const errors = {}; readPrices(list, errors); return errors; };

/** Ghi thay đổi bảng giá. Gọi BÊN TRONG transaction. */
function applyPrices(customerId, changes, userId) {
  if (!changes.length) return;
  const exists = db.prepare('SELECT 1 FROM products WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO wholesale_prices (customer_id, product_id, price, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (customer_id, product_id) DO UPDATE SET price = excluded.price, updated_by = excluded.updated_by, updated_at = datetime('now')
  `);
  const remove = db.prepare('DELETE FROM wholesale_prices WHERE customer_id = ? AND product_id = ?');
  for (const [productId, price] of changes) {
    if (price == null) remove.run(customerId, productId);
    else if (exists.get(productId)) upsert.run(customerId, productId, price, userId);
    else throw new HttpError(400, 'Có loại gạo không còn trong cửa hàng. Vui lòng tải lại trang.');
  }
}
const priceList = (customerId) => [...wholesalePrices(customerId)].map(([product_id, price]) => ({ product_id, price }));

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
    const priceChanges = readPrices(body.prices);
    const hash = await hashOf(body.password);
    const result = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM wholesale_customers WHERE phone = ? AND is_active = 1').get(data.phone)) {
        throw new HttpError(409, 'Đã có khách buôn dùng số điện thoại này.', { phone: 'Đã có khách buôn dùng số này.' });
      }
      const id = db.prepare(`
        INSERT INTO wholesale_customers (company, contact_name, phone, address, map_url, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(data.company, data.contact_name, data.phone, data.address ?? null, data.map_url ?? null, data.note ?? null, req.user.id).lastInsertRowid;
      db.prepare('UPDATE wholesale_customers SET code = ? WHERE id = ?').run(wholesaleCode(id), id);
      applyPrices(id, priceChanges, req.user.id);
      const login = linkLogin(getWholesale(id), hash);
      return { id: Number(id), login };
    })();
    const customer = shapeWholesale(getWholesale(result.id));
    const prices = priceList(result.id);
    writeAdminAudit(req, { action: 'create', entityType: 'wholesale_customer', entityId: result.id, after: { ...customer, login: result.login, prices: Object.fromEntries(prices.map((p) => [p.product_id, p.price])) } });
    res.status(201).json({ customer, prices, message: LOGIN_NOTE[result.login] || null });
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
    const priceChanges = readPrices(body.prices);
    const pricesBefore = priceChanges.length ? Object.fromEntries(wholesalePrices(id)) : null;
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
      applyPrices(id, priceChanges, req.user.id);
      return body.password ? linkLogin(getWholesale(id), hash) : null;
    })();
    const customer = shapeWholesale(getWholesale(id));
    const prices = priceList(id);
    writeAdminAudit(req, {
      action: 'update', entityType: 'wholesale_customer', entityId: id,
      before: { ...shapeWholesale(before), ...(pricesBefore ? { prices: pricesBefore } : {}) },
      after: { ...customer, login, ...(pricesBefore ? { prices: Object.fromEntries(prices.map((p) => [p.product_id, p.price])) } : {}) },
    });
    res.json({ customer, prices, message: LOGIN_NOTE[login] || null });
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
    const errors = {};
    const changes = readPrices(req.body?.prices, errors);
    if (Object.keys(errors).length) throw new HttpError(400, 'Bảng giá chưa hợp lệ.', errors);
    const before = Object.fromEntries(wholesalePrices(id));
    db.transaction(() => applyPrices(id, changes, req.user.id))();
    const prices = priceList(id);
    writeAdminAudit(req, { action: 'prices', entityType: 'wholesale_customer', entityId: id, before, after: Object.fromEntries(prices.map((p) => [p.product_id, p.price])) });
    res.json({ prices });
  } catch (err) { next(err); }
});

export default router;
