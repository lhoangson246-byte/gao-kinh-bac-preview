import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import { CODE_PATTERN, normalizeCode } from '../discount-codes.js';

/**
 * /api/admin/discount-codes — chủ cửa hàng tạo / sửa / tắt mã giảm giá. Mỗi mã: số tiền giảm, ngày
 * bắt đầu – kết thúc (giờ Việt Nam, tính cả hai ngày), đơn tối thiểu, số lượt mỗi SĐT, tổng số lượt.
 */
const router = Router();
router.use(requireAuth, requireAdmin);
router.use(validateRoutes('discount-codes'));

const list = () => db.prepare(`
  SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.discount_code = c.code AND o.status <> 'cancelled') AS uses,
         (SELECT COALESCE(SUM(o.code_discount), 0) FROM orders o WHERE o.discount_code = c.code AND o.status <> 'cancelled') AS discounted
  FROM discount_codes c ORDER BY c.is_active DESC, COALESCE(c.ends_on, '9999') DESC, c.id DESC
`).all();

const day = (value, field, errors) => {
  if (value == null || value === '') return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!ok) errors[field] = 'Ngày không hợp lệ.';
  return value;
};

function readCode(body, current = {}) {
  const errors = {};
  const row = { ...current };
  if (body.code !== undefined || !current.code) {
    row.code = normalizeCode(body.code);
    if (!CODE_PATTERN.test(row.code)) errors.code = 'Mã gồm 3–30 chữ cái không dấu, số, "-" hoặc "_".';
  }
  if (body.amount !== undefined || !current.amount) {
    row.amount = toInteger(body.amount, { min: 1000, max: 10_000_000 });
    if (!row.amount) errors.amount = 'Số tiền giảm từ 1.000đ.';
  }
  if (body.starts_on !== undefined) row.starts_on = day(body.starts_on, 'starts_on', errors);
  if (body.ends_on !== undefined) row.ends_on = day(body.ends_on, 'ends_on', errors);
  if (row.starts_on && row.ends_on && row.starts_on > row.ends_on) errors.ends_on = 'Ngày kết thúc phải sau ngày bắt đầu.';
  for (const field of ['min_subtotal', 'per_phone_limit', 'max_uses']) {
    if (body[field] === undefined) continue;
    const value = body[field] === '' || body[field] === null ? 0 : toInteger(body[field], { min: 0, max: 100_000_000 });
    if (value == null) errors[field] = 'Nhập số không âm.';
    else row[field] = value;
  }
  if (body.is_active !== undefined) row.is_active = body.is_active ? 1 : 0;
  if (body.note !== undefined) row.note = cleanText(body.note, 200);
  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
  return {
    starts_on: null, ends_on: null, min_subtotal: 0, per_phone_limit: 0, max_uses: 0, is_active: 1, note: null, ...row,
  };
}

router.get('/', (req, res) => res.json({ codes: list() }));

router.post('/', (req, res, next) => {
  try {
    const row = readCode(req.body);
    if (db.prepare('SELECT 1 FROM discount_codes WHERE code = ?').get(row.code)) {
      throw new HttpError(409, 'Mã này đã có.', { code: 'Mã này đã có.' });
    }
    const id = db.prepare(`
      INSERT INTO discount_codes (code, amount, starts_on, ends_on, min_subtotal, per_phone_limit, max_uses, is_active, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.code, row.amount, row.starts_on, row.ends_on, row.min_subtotal, row.per_phone_limit, row.max_uses, row.is_active, row.note)
      .lastInsertRowid;
    writeAdminAudit(req, { action: 'discount_code.create', entityType: 'discount_code', entityId: id, after: row });
    res.status(201).json({ codes: list() });
  } catch (err) { next(err); }
});

router.put('/:id', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const current = id && db.prepare('SELECT * FROM discount_codes WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Không tìm thấy mã.');
    const row = readCode(req.body, current);
    if (row.code !== current.code) {
      // Đổi chữ của mã đã có người dùng sẽ làm lệch thống kê lượt dùng; tạo mã mới thay vì đổi.
      if (db.prepare('SELECT 1 FROM orders WHERE discount_code = ? LIMIT 1').get(current.code)) {
        throw new HttpError(400, 'Mã đã có đơn dùng, không đổi chữ được. Hãy tắt mã này và tạo mã mới.', { code: 'Không đổi được.' });
      }
      if (db.prepare('SELECT 1 FROM discount_codes WHERE code = ? AND id <> ?').get(row.code, id)) {
        throw new HttpError(409, 'Mã này đã có.', { code: 'Mã này đã có.' });
      }
    }
    db.prepare(`
      UPDATE discount_codes SET code = ?, amount = ?, starts_on = ?, ends_on = ?, min_subtotal = ?, per_phone_limit = ?,
        max_uses = ?, is_active = ?, note = ?, updated_at = datetime('now') WHERE id = ?
    `).run(row.code, row.amount, row.starts_on, row.ends_on, row.min_subtotal, row.per_phone_limit, row.max_uses, row.is_active, row.note, id);
    writeAdminAudit(req, { action: 'discount_code.update', entityType: 'discount_code', entityId: id, before: current, after: row });
    res.json({ codes: list() });
  } catch (err) { next(err); }
});

export default router;
