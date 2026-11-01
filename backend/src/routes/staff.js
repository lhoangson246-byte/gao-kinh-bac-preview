import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText, isEmail, normalizePhone, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import { LIMITS } from '../constants.js';
import { PERMISSIONS, PERMISSION_CODES, PRESETS, permissionsOf } from '../permissions.js';

/**
 * /api/admin/staff — CHỈ chủ cửa hàng: tạo tài khoản nhân viên (kế toán, giao hàng, bán hàng…),
 * cấp / bỏ quyền, đặt lại mật khẩu, khoá khi nghỉ việc. Nhân viên đăng nhập ở trang đăng nhập chung
 * bằng số điện thoại hoặc email.
 */
const router = Router();
router.use(requireAuth, requireAdmin);
router.use(validateRoutes('staff'));

const COLUMNS = 'id, full_name, phone, email, staff_title, permissions, is_locked, created_at';
const shape = (row) => ({ ...row, permissions: permissionsOf({ role: 'staff', permissions: row.permissions }) });
const list = () => db.prepare(`
  SELECT ${COLUMNS}, (SELECT MAX(created_at) FROM login_history h WHERE h.user_id = users.id) AS last_login
  FROM users WHERE role = 'staff' ORDER BY is_locked, full_name
`).all().map(shape);

function findStaff(id) {
  const row = toInteger(id, { min: 1 }) && db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ? AND role = 'staff'`).get(id);
  if (!row) throw new HttpError(404, 'Không tìm thấy tài khoản nhân viên.');
  return row;
}

function readPermissions(value, errors) {
  if (!Array.isArray(value) || value.some((p) => !PERMISSION_CODES.includes(p))) {
    errors.permissions = 'Quyền không hợp lệ.';
    return [];
  }
  if (!value.length) errors.permissions = 'Chọn ít nhất một quyền.';
  return PERMISSION_CODES.filter((code) => value.includes(code));
}

/** Số điện thoại / email chưa thuộc tài khoản khác (kể cả tài khoản khách). */
function assertFreeLogin({ phone, email }, exceptId = 0) {
  const errors = {};
  if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ? AND id <> ?').get(phone, exceptId)) {
    errors.phone = 'Số điện thoại này đã có tài khoản (có thể là tài khoản khách). Dùng số khác hoặc dùng email.';
  }
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, exceptId)) {
    errors.email = 'Email này đã có tài khoản.';
  }
  if (Object.keys(errors).length) throw new HttpError(409, 'Thông tin đăng nhập đã được dùng.', errors);
}

router.get('/', (req, res) => {
  res.json({ staff: list(), permissions: PERMISSIONS, presets: PRESETS });
});

/** POST / — body: { full_name, phone?, email?, password, staff_title?, permissions[] } */
router.post('/', async (req, res, next) => {
  try {
    const body = req.body;
    const errors = {};
    const fullName = cleanText(body.full_name, LIMITS.name);
    if (!fullName || fullName.length < 2) errors.full_name = 'Nhập họ tên nhân viên.';
    const phone = body.phone ? normalizePhone(body.phone) : null;
    if (body.phone && !phone) errors.phone = 'Số điện thoại không hợp lệ (10 số).';
    const email = body.email ? cleanText(body.email, LIMITS.email)?.toLowerCase() : null;
    if (body.email && !isEmail(email)) errors.email = 'Email không hợp lệ.';
    if (!phone && !email && !errors.phone && !errors.email) errors.phone = 'Cần số điện thoại hoặc email để đăng nhập.';
    const permissions = readPermissions(body.permissions, errors);
    const title = cleanText(body.staff_title, 60);
    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
    assertFreeLogin({ phone, email });
    const hash = await bcrypt.hash(body.password, 12);
    const id = db.prepare(`
      INSERT INTO users (full_name, phone, email, password_hash, role, permissions, staff_title)
      VALUES (?, ?, ?, ?, 'staff', ?, ?)
    `).run(fullName, phone, email, hash, JSON.stringify(permissions), title).lastInsertRowid;
    writeAdminAudit(req, {
      action: 'staff.create', entityType: 'user', entityId: id,
      after: { full_name: fullName, phone, email, staff_title: title, permissions },
    });
    res.status(201).json({ staff: list() });
  } catch (err) { next(err); }
});

/** PUT /:id — đổi tên, chức vụ, quyền, số điện thoại / email đăng nhập. */
router.put('/:id', (req, res, next) => {
  try {
    const current = findStaff(req.params.id);
    const body = req.body;
    const errors = {};
    const next_ = { ...current, permissions: permissionsOf({ role: 'staff', permissions: current.permissions }) };
    if (body.full_name !== undefined) {
      next_.full_name = cleanText(body.full_name, LIMITS.name);
      if (!next_.full_name || next_.full_name.length < 2) errors.full_name = 'Nhập họ tên nhân viên.';
    }
    if (body.staff_title !== undefined) next_.staff_title = cleanText(body.staff_title, 60);
    if (body.phone !== undefined) {
      next_.phone = body.phone ? normalizePhone(body.phone) : null;
      if (body.phone && !next_.phone) errors.phone = 'Số điện thoại không hợp lệ (10 số).';
    }
    if (body.email !== undefined) {
      next_.email = body.email ? cleanText(body.email, LIMITS.email)?.toLowerCase() : null;
      if (body.email && !isEmail(next_.email)) errors.email = 'Email không hợp lệ.';
    }
    if (!next_.phone && !next_.email) errors.phone = 'Cần số điện thoại hoặc email để đăng nhập.';
    if (body.permissions !== undefined) next_.permissions = readPermissions(body.permissions, errors);
    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
    assertFreeLogin(next_, current.id);
    db.prepare(`
      UPDATE users SET full_name = ?, staff_title = ?, phone = ?, email = ?, permissions = ? WHERE id = ? AND role = 'staff'
    `).run(next_.full_name, next_.staff_title, next_.phone, next_.email, JSON.stringify(next_.permissions), current.id);
    writeAdminAudit(req, {
      action: 'staff.update', entityType: 'user', entityId: current.id,
      before: shape(current), after: { ...next_, is_locked: undefined, created_at: undefined },
    });
    res.json({ staff: list() });
  } catch (err) { next(err); }
});

/** PATCH /:id/lock — khoá (nghỉ việc) / mở khoá. Khoá thì mọi phiên đăng nhập hết hiệu lực ngay. */
router.patch('/:id/lock', (req, res, next) => {
  try {
    const current = findStaff(req.params.id);
    const locked = req.body.is_locked ? 1 : 0;
    db.prepare('UPDATE users SET is_locked = ?, session_version = session_version + 1 WHERE id = ?').run(locked, current.id);
    writeAdminAudit(req, { action: locked ? 'staff.lock' : 'staff.unlock', entityType: 'user', entityId: current.id });
    res.json({ staff: list() });
  } catch (err) { next(err); }
});

/** POST /:id/reset-password — đặt mật khẩu mới; nhân viên phải đăng nhập lại. */
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const current = findStaff(req.params.id);
    const hash = await bcrypt.hash(req.body.password, 12);
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(hash, current.id);
    writeAdminAudit(req, { action: 'staff.reset_password', entityType: 'user', entityId: current.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
