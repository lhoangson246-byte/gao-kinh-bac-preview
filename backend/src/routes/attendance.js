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
 * /api/attendance — chấm công.
 *
 * Từ 18/11/2026 (cửa hàng đổi quy chuẩn): CHỈ QUẢN LÝ chấm công. Người có quyền `attendance.manage` tích
 * cho từng nhân viên mỗi ngày 1 công, 0,5 công hoặc Nghỉ (0), và xem bảng công cả tháng. Nhân viên không
 * tự chấm vào / ra nữa, chỉ xem công của chính mình.
 *
 * Dữ liệu chấm vào / ra cũ (bảng `attendance`, trước 18/11) vẫn được tính cho những ngày quản lý chưa tích:
 * từ 7 tiếng trở lên = 1 công, dưới 7 tiếng = 0,5 công, chưa chấm ra = chưa tính. Quản lý tích ngày nào thì
 * số quản lý tích được dùng.
 */
export const FULL_DAY_MINUTES = 7 * 60;
export const congFor = (minutes) => {
  if (minutes == null) return 0;
  if (minutes >= FULL_DAY_MINUTES) return 1;
  return minutes > 0 ? 0.5 : 0;
};
export const MARK_UNITS = [1, 0.5, 0];

/**
 * Quy định chấm công (21/11/2026): chấm vào CUỐI NGÀY. Bảng chấm công chỉ mở từ 17h00 tới hết 24h00 cùng
 * ngày (giờ Việt Nam) cho kế toán / quản lý chấm và sửa công của chính ngày hôm đó; qua 24h là hết hạn,
 * không sửa được nữa. Chủ cửa hàng vẫn sửa được ngày cũ khi cần đính chính (có ghi nhật ký).
 */
export const MARK_OPEN_MINUTES = 17 * 60;
export const MARK_POLICY = 'Chấm công vào cuối ngày: mở lúc 17h00, đóng lúc 24h00 cùng ngày. Chỉ chấm và sửa được công của ngày hôm đó trước 24h00; quá hạn không sửa được.';
/** Giờ hiện tại theo giờ Việt Nam: { day, minutes }. ATTENDANCE_TEST_NOW=HH:MM chỉ dùng khi chạy kiểm thử. */
function nowVN() {
  const now = new Date(Date.now() + 7 * 3600_000);
  const test = /^(\d{2}):(\d{2})$/.exec(process.env.ATTENDANCE_TEST_NOW || '');
  return { day: now.toISOString().slice(0, 10), minutes: test ? Number(test[1]) * 60 + Number(test[2]) : now.getUTCHours() * 60 + now.getUTCMinutes() };
}
/** Trạng thái cửa sổ chấm công cho người đang xem. */
export function markWindow(user) {
  const { day, minutes } = nowVN();
  const owner = user?.role === 'admin';
  const open = minutes >= MARK_OPEN_MINUTES;
  return { day, open, opens_at: '17:00', closes_at: '24:00', owner_override: owner, editable_day: open ? day : null, policy: MARK_POLICY };
}

const router = Router();
router.use(requireAuth, requireStaff, validateRoutes('attendance'));

const SHIFT = REPORT_TIME_SHIFT;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Ngày công cũ (tự chấm vào / ra trước khi đổi quy chuẩn).
const CLOCK_SQL = `
  SELECT a.user_id, a.work_date,
         strftime('%H:%M', a.clock_in, '${SHIFT}') AS in_time,
         strftime('%H:%M', a.clock_out, '${SHIFT}') AS out_time,
         CASE WHEN a.clock_out IS NULL THEN NULL
              ELSE CAST(ROUND((julianday(a.clock_out) - julianday(a.clock_in)) * 1440) AS INTEGER) END AS minutes
  FROM attendance a`;
// Công quản lý tích.
const MARK_SQL = `
  SELECT m.user_id, m.work_date, m.units, m.note, m.marked_at, COALESCE(u.full_name, m.marker_name) AS marked_by_name
  FROM attendance_marks m LEFT JOIN users u ON u.id = m.marked_by`;

/** Gộp hai nguồn thành từng ngày: { work_date, cong, source: 'mark' | 'clock', … }. Ngày tích thắng ngày chấm. */
function daysOf(where, args) {
  const byKey = new Map();
  for (const r of db.prepare(`${CLOCK_SQL} WHERE ${where.replaceAll('?.', 'a.')}`).all(...args)) {
    byKey.set(`${r.user_id}|${r.work_date}`, {
      user_id: r.user_id, work_date: r.work_date, source: 'clock', cong: congFor(r.minutes),
      open: !r.out_time, in_time: r.in_time, out_time: r.out_time, minutes: r.minutes,
    });
  }
  for (const r of db.prepare(`${MARK_SQL} WHERE ${where.replaceAll('?.', 'm.')}`).all(...args)) {
    byKey.set(`${r.user_id}|${r.work_date}`, {
      user_id: r.user_id, work_date: r.work_date, source: 'mark', cong: r.units, open: false,
      note: r.note || null, marked_by_name: r.marked_by_name || null, marked_at: r.marked_at,
    });
  }
  return [...byKey.values()].sort((a, b) => a.work_date.localeCompare(b.work_date));
}

const totalsOf = (rows) => ({
  days: rows.filter((r) => r.cong > 0).length,
  cong: rows.reduce((sum, r) => sum + r.cong, 0),
  off: rows.filter((r) => r.source === 'mark' && r.cong === 0).length,
  open: rows.filter((r) => r.open).length,
});

const monthOf = (value) => {
  if (value == null || value === '') return todayVN().slice(0, 7);
  if (!MONTH_RE.test(value)) throw new HttpError(400, 'Tháng không hợp lệ.', { month: 'Chọn tháng dạng YYYY-MM.' });
  return value;
};
const daysInMonth = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** GET /api/attendance/me?month=YYYY-MM — công của chính mình trong tháng (chỉ xem). */
router.get('/me', (req, res, next) => {
  try {
    const month = monthOf(req.query.month);
    const days = daysOf('?.user_id = ? AND ?.work_date LIKE ?', [req.user.id, `${month}-%`]).reverse();
    res.json({
      today: todayVN(), month, days, totals: totalsOf(days),
      today_record: days.find((d) => d.work_date === todayVN()) || null,
      manager: can(req.user, 'attendance.manage'),
    });
  } catch (err) { next(err); }
});

/** Chấm vào / ra đã bỏ: báo rõ cho máy còn giữ giao diện cũ. */
const selfClockRemoved = (req, res) => res.status(403).json({
  message: 'Chấm công do quản lý thực hiện. Nếu thiếu công, vui lòng báo quản lý.',
});
router.post('/clock-in', selfClockRemoved);
router.post('/clock-out', selfClockRemoved);

/**
 * GET /api/attendance/month?month=YYYY-MM — bảng công cả tháng (quản lý): mỗi nhân viên một dòng, mỗi
 * ngày một ô số công. Gồm nhân viên đang làm và cả người đã nghỉ nhưng có công trong tháng.
 */
router.get('/month', requirePermission('attendance.manage'), (req, res, next) => {
  try {
    const month = monthOf(req.query.month);
    const rows = daysOf('?.work_date LIKE ?', [`${month}-%`]);
    const people = db.prepare(`
      SELECT id, full_name, staff_title, role FROM users
      WHERE attendance_tracked <> 0 AND (
            (role = 'staff' AND is_locked = 0)
         OR id IN (SELECT user_id FROM attendance WHERE work_date LIKE ?)
         OR id IN (SELECT user_id FROM attendance_marks WHERE work_date LIKE ?))
      ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, full_name
    `).all(`${month}-%`, `${month}-%`);
    const staff = people.map((p) => {
      const own = rows.filter((r) => r.user_id === p.id);
      return {
        id: p.id, full_name: p.full_name, staff_title: p.staff_title || (p.role === 'admin' ? 'Chủ cửa hàng' : null),
        days: Object.fromEntries(own.map((r) => [Number(r.work_date.slice(8, 10)), r])),
        totals: totalsOf(own),
      };
    });
    res.json({ month, days_in_month: daysInMonth(month), today: todayVN(), staff, units: MARK_UNITS, window: markWindow(req.user) });
  } catch (err) { next(err); }
});

/**
 * PUT /api/attendance/mark — quản lý tích công. body: { user_ids: [id…] (hoặc user_id), work_date,
 * units: 1 | 0.5 | 0 | null, note?, only_empty? }. units = 0 là Nghỉ; null là bỏ ô đã tích. `only_empty`
 * (tích cả cột một ngày) thì chỉ tích những người chưa có công ngày đó. Có nhật ký thay đổi.
 * Quản lý không tự tích công cho chính mình (trừ chủ cửa hàng).
 */
router.put('/mark', requirePermission('attendance.manage'), (req, res, next) => {
  try {
    const body = req.body || {};
    const ids = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : [body.user_id]).map((v) => toInteger(v, { min: 1 })))];
    const workDate = String(body.work_date || '');
    const units = body.units === null ? null : Number(body.units);
    const note = cleanText(body.note, 300);
    const errors = {};
    if (!ids.length || ids.some((v) => !v) || ids.length > 200) errors.user_id = 'Chọn nhân viên.';
    if (!validDay(workDate)) errors.work_date = 'Ngày không hợp lệ.';
    else if (workDate > todayVN()) errors.work_date = 'Không chấm công trước cho ngày chưa tới.';
    if (units !== null && !MARK_UNITS.includes(units)) errors.units = 'Chỉ tích 1 công, 0,5 công hoặc Nghỉ.';
    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chấm công chưa hợp lệ.', errors);
    // Cửa sổ chấm công 17h00 – 24h00 của chính ngày hôm đó (chủ cửa hàng được đính chính ngày cũ).
    const win = markWindow(req.user);
    if (!win.owner_override) {
      if (workDate !== win.day) {
        throw new HttpError(403, `Đã hết hạn chấm công ngày ${workDate.split('-').reverse().join('/')} (đóng lúc 24h00 cùng ngày). Cần sửa thì báo chủ cửa hàng.`, { work_date: 'Đã hết hạn chấm công.' });
      }
      if (!win.open) throw new HttpError(403, 'Chấm công mở lúc 17h00 (cuối ca) và đóng lúc 24h00. Vui lòng quay lại sau 17h00.', { work_date: 'Chưa tới giờ chấm công.' });
    }

    const people = db.prepare(`SELECT id, full_name, attendance_tracked FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND role IN ('staff', 'admin')`).all(...ids);
    if (people.length !== ids.length) throw new HttpError(400, 'Có người không phải nhân viên.', { user_id: 'Không tìm thấy nhân viên.' });
    const untracked = people.filter((p) => p.attendance_tracked === 0);
    if (untracked.length) throw new HttpError(400, `${untracked.map((p) => p.full_name).join(', ')} không cần chấm công (bỏ tích ở Quản trị → Nhân viên).`, { user_id: 'Người này không cần chấm công.' });
    if (req.user.role !== 'admin' && ids.includes(req.user.id)) {
      throw new HttpError(403, 'Bạn không tự chấm công cho chính mình được. Vui lòng nhờ chủ cửa hàng.');
    }

    const changes = db.transaction(() => {
      const findMark = db.prepare('SELECT units FROM attendance_marks WHERE user_id = ? AND work_date = ?');
      const hasClock = db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?');
      const upsert = db.prepare(`
        INSERT INTO attendance_marks (user_id, work_date, units, note, marked_by, marker_name, marked_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT (user_id, work_date) DO UPDATE SET units = excluded.units, note = excluded.note,
          marked_by = excluded.marked_by, marker_name = excluded.marker_name, marked_at = excluded.marked_at
      `);
      const remove = db.prepare('DELETE FROM attendance_marks WHERE user_id = ? AND work_date = ?');
      const done = [];
      for (const person of people) {
        const before = findMark.get(person.id, workDate)?.units ?? null;
        if (body.only_empty && (before !== null || hasClock.get(person.id, workDate))) continue;
        if (units === null) {
          if (before === null) continue;
          remove.run(person.id, workDate);
        } else {
          if (before === units && !note) continue;
          upsert.run(person.id, workDate, units, note, req.user.id, req.user.full_name);
        }
        done.push({ person: person.full_name, before, after: units });
      }
      return done;
    })();

    if (changes.length) {
      writeAdminAudit(req, { action: 'attendance_mark', entityType: 'attendance', entityId: workDate, after: { work_date: workDate, note, changes } });
    }
    res.json({ changed: changes.length, days: daysOf(`?.work_date = ? AND ?.user_id IN (${ids.map(() => '?').join(',')})`, [workDate, ...ids]) });
  } catch (err) { next(err); }
});

export const canManageAttendance = (user) => can(user, 'attendance.manage');
export default router;
