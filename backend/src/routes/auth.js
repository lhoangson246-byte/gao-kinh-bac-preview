import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { LIMITS } from '../constants.js';
import { HttpError, cleanText, isEmail, isPhone, normalizePhone } from '../validate.js';
import { writeLoginHistory } from '../audit.js';
import { deliverSession, COOKIE_NAME, COOKIE_OPTIONS } from '../security.js';

const router = Router();
router.use(validateRoutes('auth'));

const PUBLIC_USER_COLUMNS = 'id, full_name, email, phone, address, role';

/** POST /api/auth/register — Đăng ký
 *  Chỉ cần MỘT trong hai: số điện thoại hoặc email. Khách không có email vẫn dùng được.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { full_name, email, password, phone } = req.body || {};
    const errors = {};

    const fullName = cleanText(full_name, LIMITS.name);
    const rawEmail = cleanText(email, LIMITS.email)?.toLowerCase() || null;
    const rawPhone = cleanText(phone, LIMITS.phone);
    const customerPhone = rawPhone ? normalizePhone(rawPhone) : null;

    if (!fullName || fullName.length < 2) errors.full_name = 'Vui lòng nhập họ tên.';

    if (!rawEmail && !rawPhone) {
      errors.phone = 'Nhập số điện thoại để đăng ký. Email không bắt buộc.';
    }
    if (rawPhone && !customerPhone) {
      errors.phone = 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).';
    }
    if (rawEmail && !isEmail(rawEmail)) {
      errors.email = 'Email không hợp lệ. Có thể bỏ trống nếu bạn không dùng email.';
    }

    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);

    if (rawEmail && db.prepare('SELECT id FROM users WHERE email = ?').get(rawEmail)) {
      throw new HttpError(409, 'Email này đã được đăng ký.', { email: 'Email này đã được đăng ký.' });
    }
    if (customerPhone && db.prepare('SELECT id FROM users WHERE phone = ?').get(customerPhone)) {
      throw new HttpError(409, 'Số điện thoại này đã được đăng ký.', {
        phone: 'Số điện thoại này đã được đăng ký. Bạn hãy đăng nhập.',
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const info = db
      .prepare(
        `INSERT INTO users (full_name, email, password_hash, phone, address)
         VALUES (?, ?, ?, ?, NULL)`
      )
      .run(fullName, rawEmail, hash, customerPhone);

    const user = db
      .prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
      .get(info.lastInsertRowid);

    deliverSession(req, res, user, signToken(user), 201);
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/login — Đăng nhập bằng số điện thoại HOẶC email
 *  body: { identifier, password }  (vẫn nhận `email` / `phone` để tương thích ngược)
 */
const dummyHash = bcrypt.hashSync('dummy-credential-never-a-user', 12);
router.post('/login', async (req, res, next) => {
  try {
    const { email, phone, identifier, password } = req.body || {};
    if (typeof password !== 'string' || !password) {
      throw new HttpError(400, 'Nhập mật khẩu.');
    }

    const raw = cleanText(identifier ?? phone ?? email, LIMITS.email) || '';
    if (!raw) throw new HttpError(400, 'Nhập số điện thoại hoặc email.');

    // Có "@" thì coi là email, còn lại thử đọc như số điện thoại.
    let row = null;
    if (raw.includes('@')) {
      row = db.prepare('SELECT * FROM users WHERE email = ?').get(raw.toLowerCase());
    } else {
      const normalized = normalizePhone(raw);
      // Số điện thoại được chuẩn hoá khi lưu nên chỉ cần một truy vấn.
      if (normalized) row = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized);
    }

    // Thông báo giống nhau cho mọi trường hợp để không lộ tài khoản nào đang tồn tại.
    const validPassword = await bcrypt.compare(password, row?.password_hash || dummyHash);
    if (!row || !validPassword) {
      throw new HttpError(401, 'Số điện thoại/email hoặc mật khẩu không đúng.');
    }
    // Đúng mật khẩu nhưng tài khoản đã bị khoá — báo rõ để khách biết đường liên hệ.
    if (row.is_locked) {
      throw new HttpError(403, 'Tài khoản đã bị khoá. Vui lòng liên hệ cửa hàng.');
    }

    // Password reset/lock may happen while bcrypt yields to another request.
    const current = db.prepare('SELECT password_hash, session_version, is_locked FROM users WHERE id = ?').get(row.id);
    if (!current || current.is_locked || current.password_hash !== row.password_hash || current.session_version !== row.session_version) {
      throw new HttpError(401, 'Tài khoản vừa thay đổi. Vui lòng đăng nhập lại.');
    }

    const user = {
      id: row.id, full_name: row.full_name, email: row.email,
      phone: row.phone, address: row.address, role: row.role,
    };
    writeLoginHistory(req, row.id, raw.includes('@') ? 'email' : 'phone');
    deliverSession(req, res, user, signToken(user));
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me — Thông tin tài khoản */
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(req.user.id);
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
  res.json({ ok: true });
});

router.put('/password', requireAuth, async (req, res, next) => {
  try {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!await bcrypt.compare(req.body.current_password, row.password_hash)) {
      throw new HttpError(401, 'Mật khẩu hiện tại không đúng.');
    }
    const hash = await bcrypt.hash(req.body.password, 12);
    const changed = db.prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1
      WHERE id = ? AND password_hash = ? AND is_locked = 0`).run(hash, req.user.id, row.password_hash).changes;
    if (!changed) throw new HttpError(409, 'Tài khoản vừa thay đổi. Vui lòng đăng nhập lại.');
    deliverSession(req, res, req.user, signToken(req.user));
  } catch (err) { next(err); }
});

/** PUT /api/auth/me — Cập nhật họ tên / SĐT / địa chỉ mặc định
 *  Chỉ đổi những trường được gửi lên; gửi chuỗi rỗng nghĩa là muốn xoá.
 */
router.put('/me', requireAuth, (req, res, next) => {
  try {
    const body = req.body || {};
    const errors = {};
    const updates = {};

    if (body.full_name !== undefined) {
      const fullName = cleanText(body.full_name, LIMITS.name);
      if (!fullName || fullName.length < 2) errors.full_name = 'Vui lòng nhập họ tên.';
      else updates.full_name = fullName;
    }

    if (body.phone !== undefined) {
      const raw = cleanText(body.phone, LIMITS.phone);
      if (!raw) {
        // Không cho xoá SĐT nếu đó là cách duy nhất để đăng nhập.
        if (!req.user.email) {
          errors.phone = 'Tài khoản chưa có email nên cần giữ số điện thoại để đăng nhập.';
        } else {
          updates.phone = null;
        }
      } else if (!isPhone(raw)) {
        errors.phone = 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).';
      } else {
        const normalized = normalizePhone(raw);
        const taken = db
          .prepare('SELECT id FROM users WHERE phone = ? AND id != ?')
          .get(normalized, req.user.id);
        if (taken) errors.phone = 'Số điện thoại này đã thuộc về một tài khoản khác.';
        else updates.phone = normalized;
      }
    }

    if (body.address !== undefined) {
      updates.address = cleanText(body.address, LIMITS.address);
    }

    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);

    const fields = Object.keys(updates);
    if (fields.length) {
      db.prepare(
        `UPDATE users SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`
      ).run({ ...updates, id: req.user.id });
    }

    const user = db
      .prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
      .get(req.user.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
