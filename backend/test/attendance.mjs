// Chấm công (từ 18/11/2026): CHỈ QUẢN LÝ tích 1 công / 0,5 công / Nghỉ cho nhân viên mỗi ngày và xem bảng
// công cả tháng; nhân viên không tự chấm vào / ra nữa, chỉ xem công của mình.
// 21/11/2026: chấm vào cuối ngày — bảng mở 17h00, đóng 24h00 cùng ngày (chủ cửa hàng được đính chính ngày cũ);
// nhân viên không cần chấm công (bỏ tích khi tạo tài khoản) không hiện trong bảng.
// Cách chạy: node test/attendance.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const short = (v) => String(JSON.stringify(v)).slice(0, 300);

// Giờ thử: 18h00 (bảng chấm công đang mở).
let app = await fixture({ ATTENDANCE_TEST_NOW: '18:00' });
let { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = `6${String(Date.now() % 1e6).padStart(6, '0')}`;   // chữ số thứ ba luôn là 6 → đầu số di động hợp lệ
  const phone = (p, n) => `${p}${suffix}${n}`;
  const catalog = (await call('/admin/staff', { token: owner })).data;
  check('Quyền chấm công mô tả đúng quy chuẩn mới (quản lý tích 1 / 0,5 công)', /0,5 công/.test(catalog.permissions['attendance.manage'] || ''), catalog.permissions['attendance.manage']);
  check('Mẫu Kế toán vẫn có quyền chấm công', catalog.presets['ke-toan'].permissions.includes('attendance.manage'));
  const make = async (name, p, permissions, extra = {}) => {
    const r = await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: p, password: 'chamcong26', permissions, ...extra } });
    return { id: r.data.staff.find((s) => s.phone === p)?.id, token: await login(p, 'chamcong26'), row: r.data.staff.find((s) => s.phone === p) };
  };
  const shipper = await make('Anh Giao Chấm Công', phone('03', 1), ['delivery']);
  const seller = await make('Em Bán Hàng Chấm Công', phone('05', 2), ['orders.view', 'retail.sell']);
  const manager = await make('Chị Quản Lý', phone('07', 3), ['orders.view', 'attendance.manage']);
  const mom = await make('Mẹ Duyệt Cuối', phone('08', 5), ['orders.view', 'debt.final'], { attendance_tracked: false });
  const customer = (await call('/auth/register', { method: 'POST', body: { full_name: 'Khách', phone: phone('09', 4), password: 'gao2024!' } })).data.token;
  check('Tạo tài khoản: mặc định cần chấm công; bỏ tích thì ghi "không chấm công"', shipper.row?.attendance_tracked === true && mom.row?.attendance_tracked === false, short([shipper.row, mom.row]));

  /* Ai được vào */
  check('Khách hàng không vào được chấm công (403)', (await call('/attendance/me', { token: customer })).status === 403);
  check('Chưa đăng nhập bị chặn (401)', (await call('/attendance/me')).status === 401);

  /* Nhân viên không tự chấm nữa */
  const selfIn = await call('/attendance/clock-in', { method: 'POST', token: shipper.token });
  check('Nhân viên tự chấm vào bị từ chối, báo "do quản lý thực hiện" (403)', selfIn.status === 403 && /quản lý/.test(selfIn.data.message || ''), short(selfIn.data));
  check('Quản lý cũng không "chấm vào" kiểu cũ (403)', (await call('/attendance/clock-out', { method: 'POST', token: manager.token })).status === 403);
  const me0 = (await call('/attendance/me', { token: shipper.token })).data;
  check('Nhân viên xem được công của mình (chưa có ngày nào)', me0.days?.length === 0 && me0.totals.cong === 0 && me0.manager === false, short(me0));

  const today = me0.today;
  const month = today.slice(0, 7);
  const day1 = `${month}-01`;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const mark = (token, body) => call('/attendance/mark', { method: 'PUT', token, body });
  check('Nhân viên giao hàng không tích công được (403)', (await mark(shipper.token, { user_id: shipper.id, work_date: today, units: 1 })).status === 403);
  check('Nhân viên giao hàng không xem bảng công cả tháng (403)', (await call('/attendance/month', { token: shipper.token })).status === 403);

  /* Quản lý tích công trong giờ mở (18h00) */
  await mark(manager.token, { user_id: seller.id, work_date: today, units: 0.5 });
  const column = await mark(manager.token, { user_ids: [shipper.id, seller.id], work_date: today, units: 1, only_empty: true });
  const sellerToday = column.data.days.find((d) => d.user_id === seller.id);
  const shipperToday = column.data.days.find((d) => d.user_id === shipper.id);
  check('Tích cả cột hôm nay: chỉ người chưa có công được tích, người đã tích giữ nguyên', column.status === 200 && column.data.changed === 1
    && shipperToday?.cong === 1 && shipperToday.source === 'mark' && sellerToday?.cong === 0.5, short(column.data));
  const half = await mark(manager.token, { user_id: shipper.id, work_date: today, units: 0.5, note: 'Về sớm buổi chiều' });
  check('Đổi sang 0,5 công, ghi ai tích và ghi chú', half.data.days[0]?.cong === 0.5 && half.data.days[0].marked_by_name === 'Chị Quản Lý' && half.data.days[0].note === 'Về sớm buổi chiều', short(half.data));
  check('Số công khác 1 / 0,5 / Nghỉ bị từ chối (400)', (await mark(manager.token, { user_id: shipper.id, work_date: today, units: 0.7 })).status === 400
    && (await mark(manager.token, { user_id: shipper.id, work_date: today, units: 2 })).status === 400);
  const future = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
  check('Không tích công trước cho ngày chưa tới (400)', (await mark(manager.token, { user_id: shipper.id, work_date: future, units: 1 })).status === 400);
  check('Ngày không có thật bị từ chối (400)', (await mark(manager.token, { user_id: shipper.id, work_date: `${month}-32`, units: 1 })).status === 400);
  check('Quản lý không tự tích công cho chính mình (403)', (await mark(manager.token, { user_id: manager.id, work_date: today, units: 1 })).status === 403);
  check('Khách hàng (không phải nhân viên) không tích công được (400)', (await mark(owner, { user_id: 999999, work_date: today, units: 1 })).status === 400);
  const off = await mark(manager.token, { user_id: seller.id, work_date: today, units: 0 });
  check('Tích Nghỉ (0 công)', off.data.days.find((d) => d.user_id === seller.id)?.cong === 0);

  /* Hết hạn lúc 24h00: ngày cũ không sửa được (trừ chủ cửa hàng đính chính) */
  const expired = await mark(manager.token, { user_id: shipper.id, work_date: yesterday, units: 1 });
  check('Quản lý không chấm / sửa công ngày hôm qua: đã hết hạn 24h00 (403)', expired.status === 403 && /hết hạn/.test(expired.data.message || ''), short(expired.data));
  const ownerMark = await mark(owner, { user_id: manager.id, work_date: day1, units: 1 });
  const ownerFix = await mark(owner, { user_id: shipper.id, work_date: day1, units: 1 });
  check('Chủ cửa hàng vẫn đính chính được ngày cũ', ownerMark.status === 200 && ownerMark.data.days[0]?.cong === 1 && ownerFix.status === 200);

  /* Bảng tháng và công của tôi */
  const table = (await call(`/attendance/month?month=${month}`, { token: manager.token })).data;
  const row = (id) => table.staff?.find((s) => s.id === id);
  const shipperExpected = today === day1 ? 1 : 1.5;
  check('Bảng công cả tháng: ô theo ngày và tổng công đúng', row(shipper.id)?.totals.cong === shipperExpected && table.days_in_month >= 28 && Array.isArray(table.units),
    short(row(shipper.id)?.totals));
  check('Bảng tháng đếm ngày Nghỉ riêng, không cộng công', row(seller.id)?.totals.cong === 0 && row(seller.id)?.totals.off === 1, short(row(seller.id)?.totals));
  check('Bảng tháng có đủ nhân viên cần chấm công', [shipper.id, seller.id, manager.id].every((id) => !!row(id)));
  check('Người không cần chấm công (mẹ) không hiện trong bảng công', !row(mom.id));
  check('Bảng tháng báo cửa sổ chấm công đang mở (17h00 – 24h00) cho hôm nay', table.window?.open === true && table.window.editable_day === today
    && table.window.owner_override === false && /17h00/.test(table.window.policy), short(table.window));
  check('Tháng sai dạng bị từ chối (400)', (await call('/attendance/month?month=2026-13', { token: manager.token })).status === 400);
  check('Không lộ mật khẩu trong bảng công', !/password/.test(JSON.stringify(table)));
  const mine = (await call('/attendance/me', { token: shipper.token })).data;
  check('Nhân viên thấy công quản lý tích cho mình, kèm tên người tích', mine.totals.cong === shipperExpected && mine.days.every((d) => d.source === 'mark' && d.marked_by_name), short(mine.totals));

  /* Người không cần chấm công */
  const momMark = await mark(manager.token, { user_id: mom.id, work_date: today, units: 1 });
  check('Tích công cho người không cần chấm công bị từ chối (400)', momMark.status === 400 && /không cần chấm công/.test(momMark.data.message || ''), short(momMark.data));
  const tracked = await call(`/admin/staff/${mom.id}`, { method: 'PUT', token: owner, body: { attendance_tracked: true } });
  const table2 = (await call(`/attendance/month?month=${month}`, { token: manager.token })).data;
  check('Sửa tài khoản, tích "cần chấm công" thì hiện lại trong bảng', tracked.status === 200 && table2.staff.some((s) => s.id === mom.id));
  await call(`/admin/staff/${mom.id}`, { method: 'PUT', token: owner, body: { attendance_tracked: false } });
  check('Bỏ tích lại thì ẩn khỏi bảng (kể cả khi đã có công trong tháng)', !(await call(`/attendance/month?month=${month}`, { token: manager.token })).data.staff.some((s) => s.id === mom.id));

  /* Bỏ ô đã tích */
  if (today !== day1) {
    check('Quản lý không bỏ được ô ngày cũ (403)', (await mark(manager.token, { user_id: shipper.id, work_date: day1, units: null })).status === 403);
  }
  const clear = await mark(owner, { user_id: shipper.id, work_date: day1, units: null });
  const after = (await call(`/attendance/month?month=${month}`, { token: manager.token })).data.staff.find((s) => s.id === shipper.id);
  check('Bỏ ô đã tích (units null) xoá công ngày đó', clear.status === 200 && (today === day1 ? true : !after.days[1]), short(after?.days?.[1]));

  const logs = (await call('/admin/activity?limit=50', { token: owner })).data;
  check('Mỗi lần tích công có ghi nhật ký', JSON.stringify(logs).includes('attendance_mark'));
} finally {
  await app.close();
}

// Giờ thử: 16h30 (chưa tới giờ chấm công).
app = await fixture({ ATTENDANCE_TEST_NOW: '16:30' });
({ call } = app);
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = `6${String(Date.now() % 1e6).padStart(6, '0')}`;   // chữ số thứ ba luôn là 6 → đầu số di động hợp lệ
  const mk = async (name, p, permissions) => {
    const r = await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: p, password: 'chamcong26', permissions } });
    return { id: r.data.staff.find((s) => s.phone === p)?.id, token: await login(p, 'chamcong26') };
  };
  const worker = await mk('Em Bán Hàng', `05${suffix}6`, ['orders.view', 'retail.sell']);
  const accountant = await mk('Chị Kế Toán', `07${suffix}7`, ['orders.view', 'attendance.manage']);
  const today = (await call('/attendance/me', { token: worker.token })).data.today;
  const early = await call('/attendance/mark', { method: 'PUT', token: accountant.token, body: { user_id: worker.id, work_date: today, units: 1 } });
  check('Trước 17h00: kế toán chưa chấm công được (403, báo mở lúc 17h00)', early.status === 403 && /17h00/.test(early.data.message || ''), short(early.data));
  const board = (await call('/attendance/month', { token: accountant.token })).data;
  check('Trước 17h00: bảng tháng báo chưa mở', board.window?.open === false && board.window.editable_day === null);
  check('Chủ cửa hàng vẫn chấm được khi cần', (await call('/attendance/mark', { method: 'PUT', token: owner, body: { user_id: worker.id, work_date: today, units: 1 } })).status === 200);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
