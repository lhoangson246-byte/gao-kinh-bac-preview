import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requirePermission, requireStaff } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText, toInteger } from '../validate.js';
import { REPORT_TIME_SHIFT } from '../constants.js';
import { writeAdminAudit } from '../audit.js';
import { todayVN } from '../debts.js';

/**
 * /api/attendance — chấm công (11/11/2026). Mọi tài khoản nhân viên và chủ cửa hàng tự chấm vào / ra
 * mỗi ngày; giờ luôn lấy theo đồng hồ máy chủ, không nhận giờ từ điện thoại. Người có quyền
 * `attendance.manage` (kế toán, quản lý) xem bảng công cả tháng và sửa giờ cho người quên chấm.
 *
 * Quy đổi số công theo yêu cầu cửa hàng: làm từ 7 tiếng trở lên = 1 công (thường vào 7h–8h, ra trước
 * 18h, khoảng 10 tiếng); dưới 7 tiếng = 0,5 công; chưa chấm ra = chưa tính công.
 */
export const FULL_DAY_MINUTES = 7 * 60;
export const congFor = (minutes) => {
  if (minutes == null) return 0;
  if (minutes >= FULL_DAY_MINUTES) return 1;
  return minutes > 0 ? 0.5 : 0;
};

const router = Router();
router.use(requireAuth, requireStaff, validateRoutes('attendance'));

// Giờ lưu theo UTC; đổi sang giờ Việt Nam khi đọc và đổi ngược lại khi quản lý nhập tay.
const SHIFT = REPORT_TIME_SHIFT;
const BACK_SHIFT = SHIFT.startsWith('-') ? `+${SHIFT.slice(1)}` : `-${SHIFT.replace(/^\+/, '')}`;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const ROW_SQL = `
  SELECT a.id, a.user_id, a.work_date, a.note, a.edited_at, e.full_name AS edited_by_name,
         strftime('%H:%M', a.clock_in, '${SHIFT}') AS in_time,
         strftime('%H:%M', a.clock_out, '${SHIFT}') AS out_time,
         CASE WHEN a.clock_out IS NULL THEN NULL
              ELSE CAST(ROUND((julianday(a.clock_out) - julianday(a.clock_in)) * 1440) AS INTEGER) END AS minutes
  FROM attendance a LEFT JOIN users e ON e.id = a.edited_by`;

const shape = (r) => (!r ? null : {
  id: r.id, user_id: r.user_id, work_date: r.work_date, in_time: r.in_time, out_time: r.out_time,
  minutes: r.minutes, cong: congFor(r.minutes), open: !r.out_time, note: r.note || null,
  edited_at: r.edited_at || null, edited_by_name: r.edited_by_name || null,
});

const totalsOf = (rows) => ({
  days: rows.length,
  cong: rows.reduce((sum, r) => sum + r.cong, 0),
  minutes: rows.reduce((sum, r) => sum + (r.minutes || 0), 0),
  open: rows.filter((r) => r.open).length,
});

const monthOf = (value) => {
  if (value == null || value === '') return todayVN().slice(0, 7);
  if (!MONTH_RE.test(value)) throw new HttpError(400, 'Tháng không hợp lệ.', { month: 'Chọn tháng dạng YYYY-MM.' });
  return value;
};
const daysInMonth = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const todayRecord = (userId) => shape(db.prepare(`${ROW_SQL} WHERE a.user_id = ? AND a.work_date = ?`).get(userId, todayVN()));
function myPayload(userId, month) {
  const days = db.prepare(`${ROW_SQL} WHERE a.user_id = ? AND a.work_date LIKE ? ORDER BY a.work_date DESC`)
    .all(userId, `${month}-%`).map(shape);
  return {
    today: todayVN(),
    now: db.prepare(`SELECT strftime('%H:%M', 'now', '${SHIFT}') AS t`).get().t,
    record: todayRecord(userId),
    month, days, totals: totalsOf(days), full_day_hours: FULL_DAY_MINUTES / 60,
  };
}

/** GET /api/attendance/me?month=YYYY-MM — hôm nay đã chấm chưa, và lịch sử của chính mình trong tháng. */
router.get('/me', (req, res, next) => {
  try { res.json(myPayload(req.user.id, monthOf(req.query.month))); } catch (err) { next(err); }
});

/** POST /api/attendance/clock-in — chấm vào; mỗi ngày một lần. */
router.post('/clock-in', (req, res, next) => {
  try {
    const changed = db.prepare("INSERT OR IGNORE INTO attendance (user_id, work_date, clock_in) VALUES (?, ?, datetime('now'))")
      .run(req.user.id, todayVN()).changes;
    if (!changed) {
      throw new HttpError(409, `Hôm nay bạn đã chấm công vào lúc ${todayRecord(req.user.id)?.in_time || ''}.`);
    }
    res.status(201).json(myPayload(req.user.id, todayVN().slice(0, 7)));
  } catch (err) { next(err); }
});

/** POST /api/attendance/clock-out — chấm ra cho ca hôm nay. */
router.post('/clock-out', (req, res, next) => {
  try {
    const changed = db.prepare(`
      UPDATE attendance SET clock_out = datetime('now') WHERE user_id = ? AND work_date = ? AND clock_out IS NULL
    `).run(req.user.id, todayVN()).changes;
    if (!changed) {
      const current = todayRecord(req.user.id);
      throw current
        ? new HttpError(409, `Hôm nay bạn đã chấm công ra lúc ${current.out_time}.`)
        : new HttpError(400, 'Bạn chưa chấm công vào hôm nay.');
    }
    res.json(myPayload(req.user.id, todayVN().slice(0, 7)));
  } catch (err) { next(err); }
});

/**
 * GET /api/attendance/month?month=YYYY-MM — bảng công cả tháng: mỗi nhân viên một dòng, mỗi ngày
 * một ô số công. Có nhân viên đang hoạt động, và cả người đã nghỉ nhưng có chấm công trong tháng.
 */
router.get('/month', requirePermission('attendance.manage'), (req, res, next) => {
  try {
    const month = monthOf(req.query.month);
    const rows = db.prepare(`${ROW_SQL} WHERE a.work_date LIKE ? ORDER BY a.work_date`).all(`${month}-%`).map(shape);
    const people = db.prepare(`
      SELECT id, full_name, staff_title, role FROM users
      WHERE (role = 'staff' AND is_locked = 0)
         OR id IN (SELECT user_id FROM attendance WHERE work_date LIKE ?)
      ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, full_name
    `).all(`${month}-%`);
    const staff = people.map((p) => {
      const own = rows.filter((r) => r.user_id === p.id);
      return {
        id: p.id, full_name: p.full_name, staff_title: p.staff_title || (p.role === 'admin' ? 'Chủ cửa hàng' : null),
        days: Object.fromEntries(own.map((r) => [Number(r.work_date.slice(8, 10)), r])),
        totals: totalsOf(own),
      };
    });
    res.json({ month, days_in_month: daysInMonth(month), today: todayVN(), staff, full_day_hours: FULL_DAY_MINUTES / 60 });
  } catch (err) { next(err); }
});

/**
 * PUT /api/attendance/entry — quản lý sửa / bổ sung giờ công cho một người một ngày (quên chấm ra,
 * điện thoại hết pin…). Bỏ trống giờ vào = xoá ngày công đó. Bắt buộc ghi lý do; có nhật ký.
 * Nhân viên không tự sửa công của chính mình (trừ chủ cửa hàng).
 */
router.put('/entry', requirePermission('attendance.manage'), (req, res, next) => {
  try {
    const body = req.body || {};
    const userId = toInteger(body.user_id, { min: 1 });
    const workDate = String(body.work_date || '');
    const inTime = String(body.in_time || '');
    const outTime = String(body.out_time || '');
    const note = cleanText(body.note, 300);
    const errors = {};
    const person = userId && db.prepare("SELECT id, full_name, role FROM users WHERE id = ? AND role IN ('staff', 'admin')").get(userId);
    if (!person) errors.user_id = 'Không tìm thấy nhân viên.';
    const validDay = /^\d{4}-\d{2}-\d{2}$/.test(workDate) && !Number.isNaN(Date.parse(`${workDate}T00:00:00Z`))
      && new Date(`${workDate}T00:00:00Z`).toISOString().slice(0, 10) === workDate;
    if (!validDay) errors.work_date = 'Ngày không hợp lệ.';
    else if (workDate > todayVN()) errors.work_date = 'Không chấm công trước cho ngày chưa tới.';
    if (inTime && !TIME_RE.test(inTime)) errors.in_time = 'Giờ vào dạng HH:MM.';
    if (outTime && !TIME_RE.test(outTime)) errors.out_time = 'Giờ ra dạng HH:MM.';
    if (outTime && !inTime) errors.in_time = 'Nhập giờ vào trước.';
    if (inTime && outTime && TIME_RE.test(inTime) && TIME_RE.test(outTime) && outTime <= inTime) errors.out_time = 'Giờ ra phải sau giờ vào.';
    if (!note || note.length < 5) errors.note = 'Ghi lý do sửa (ít nhất 5 ký tự).';
    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chấm công chưa hợp lệ.', errors);
    if (req.user.role !== 'admin' && person.id === req.user.id) {
      throw new HttpError(403, 'Bạn không tự sửa giờ công của chính mình được. Vui lòng nhờ chủ cửa hàng.');
    }

    const result = db.transaction(() => {
      const find = db.prepare(`${ROW_SQL} WHERE a.user_id = ? AND a.work_date = ?`);
      const before = shape(find.get(person.id, workDate));
      if (!inTime) {
        if (before) db.prepare('DELETE FROM attendance WHERE id = ?').run(before.id);
        return { before, after: null };
      }
      const toUtc = (time) => `datetime('${workDate} ${time}', '${BACK_SHIFT}')`;
      if (before) {
        db.prepare(`
          UPDATE attendance SET clock_in = ${toUtc(inTime)}, clock_out = ${outTime ? toUtc(outTime) : 'NULL'},
            note = ?, edited_by = ?, edited_at = datetime('now') WHERE id = ?
        `).run(note, req.user.id, before.id);
      } else {
        db.prepare(`
          INSERT INTO attendance (user_id, work_date, clock_in, clock_out, note, edited_by, edited_at)
          VALUES (?, ?, ${toUtc(inTime)}, ${outTime ? toUtc(outTime) : 'NULL'}, ?, ?, datetime('now'))
        `).run(person.id, workDate, note, req.user.id);
      }
      return { before, after: shape(find.get(person.id, workDate)) };
    })();

    writeAdminAudit(req, {
      action: result.after ? 'attendance_edit' : 'attendance_delete', entityType: 'attendance', entityId: person.id,
      before: result.before && { ...result.before, person: person.full_name },
      after: result.after ? { ...result.after, person: person.full_name } : { work_date: workDate, note },
    });
    res.json({ record: result.after });
  } catch (err) { next(err); }
});

export const canManageAttendance = (user) => can(user, 'attendance.manage');
export default router;
