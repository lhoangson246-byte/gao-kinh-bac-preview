// Chấm công: tự chấm vào / ra theo giờ máy chủ, quy đổi số công, bảng công tháng và sửa giờ có nhật ký.
// Cách chạy: node test/attendance.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  const phone = (p, n) => `${p}${suffix}${n}`;
  const catalog = (await call('/admin/staff', { token: owner })).data;
  check('Mẫu Kế toán có sẵn quyền chấm công', catalog.presets['ke-toan'].permissions.includes('attendance.manage') && !!catalog.permissions['attendance.manage']);
  const make = async (name, p, permissions) => {
    const r = await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: p, password: 'chamcong26', permissions } });
    return { id: r.data.staff.find((s) => s.phone === p)?.id, token: await login(p, 'chamcong26') };
  };
  const shipper = await make('Anh Giao Chấm Công', phone('03', 1), ['delivery']);
  const accountant = await make('Chị Kế Toán Chấm Công', phone('07', 2), catalog.presets['ke-toan'].permissions);
  const customer = (await call('/auth/register', { method: 'POST', body: { full_name: 'Khách', phone: phone('09', 3), password: 'gao2024!' } })).data.token;

  /* Ai được chấm */
  check('Khách hàng không vào được chấm công (403)', (await call('/attendance/me', { token: customer })).status === 403);
  check('Chưa đăng nhập bị chặn (401)', (await call('/attendance/me')).status === 401);

  /* Tự chấm vào / ra */
  const me0 = (await call('/attendance/me', { token: shipper.token })).data;
  check('Chưa chấm: chưa có bản ghi hôm nay', me0.record === null && /^\d{4}-\d{2}-\d{2}$/.test(me0.today), JSON.stringify(me0).slice(0, 200));
  check('Không gửi được giờ tự chọn khi chấm vào (400)', (await call('/attendance/clock-in', { method: 'POST', token: shipper.token, body: { clock_in: '07:00' } })).status === 400);
  check('Chưa chấm vào thì chưa chấm ra được (400)', (await call('/attendance/clock-out', { method: 'POST', token: shipper.token })).status === 400);
  const inRes = await call('/attendance/clock-in', { method: 'POST', token: shipper.token });
  check('Chấm vào thành công, giờ do máy chủ ghi', inRes.status === 201 && /^\d\d:\d\d$/.test(inRes.data.record?.in_time || '') && inRes.data.record.open === true && inRes.data.record.cong === 0,
    JSON.stringify(inRes.data.record));
  const again = await call('/attendance/clock-in', { method: 'POST', token: shipper.token });
  check('Chấm vào lần hai trong ngày bị từ chối (409)', again.status === 409 && /đã chấm công vào/.test(again.data.message || ''));
  const outRes = await call('/attendance/clock-out', { method: 'POST', token: shipper.token });
  check('Chấm ra thành công, đóng ca', outRes.status === 200 && !outRes.data.record.open && outRes.data.record.minutes >= 0);
  check('Chấm ra lần hai bị từ chối (409)', (await call('/attendance/clock-out', { method: 'POST', token: shipper.token })).status === 409);
  check('Lịch sử tháng của mình có ngày hôm nay', outRes.data.days.length === 1 && outRes.data.totals.days === 1);

  /* Quyền xem bảng tháng và sửa giờ */
  check('Nhân viên giao hàng không xem bảng công cả tháng (403)', (await call('/attendance/month', { token: shipper.token })).status === 403);
  const today = me0.today;
  const month = today.slice(0, 7);
  const firstDay = `${month}-01`;
  const put = (token, body) => call('/attendance/entry', { method: 'PUT', token, body });
  check('Nhân viên giao hàng không sửa giờ được (403)', (await put(shipper.token, { user_id: shipper.id, work_date: firstDay, in_time: '07:00', out_time: '17:00', note: 'tự sửa thử' })).status === 403);

  // Ngày 01 dùng để thử quy đổi công (ghi đè nhiều lần trên cùng một ngày).
  const set = async (inTime, outTime) => (await put(accountant.token, { user_id: shipper.id, work_date: firstDay, in_time: inTime, out_time: outTime, note: 'Quên chấm, điện thoại hết pin' })).data.record;
  const full = await set('07:30', '17:45');
  check('Vào 07:30 ra 17:45 (10 tiếng 15 phút) = 1 công', full?.minutes === 615 && full.cong === 1 && full.in_time === '07:30' && full.out_time === '17:45', JSON.stringify(full));
  const seven = await set('07:00', '14:00');
  check('Đúng 7 tiếng = 1 công', seven?.minutes === 420 && seven.cong === 1, JSON.stringify(seven));
  const half = await set('08:00', '14:59');
  check('Dưới 7 tiếng (6 tiếng 59 phút) = 0,5 công', half?.minutes === 419 && half.cong === 0.5, JSON.stringify(half));
  const open = await set('07:15', '');
  check('Chưa có giờ ra = chưa tính công', open?.open === true && open.cong === 0 && open.minutes === null, JSON.stringify(open));
  check('Sửa giờ ghi rõ ai sửa', open?.edited_by_name === 'Chị Kế Toán Chấm Công' && open.note === 'Quên chấm, điện thoại hết pin');

  /* Kiểm tra dữ liệu sửa */
  const bad = async (body) => (await put(accountant.token, { user_id: shipper.id, work_date: firstDay, in_time: '07:00', out_time: '17:00', note: 'lý do hợp lệ', ...body }));
  check('Giờ ra trước giờ vào bị từ chối', (await bad({ out_time: '06:00' })).status === 400);
  check('Thiếu lý do sửa bị từ chối', (await bad({ note: '' })).status === 400);
  check('Giờ sai dạng bị từ chối', (await bad({ in_time: '7h' })).status === 400);
  const future = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
  check('Không chấm công trước cho ngày chưa tới', (await bad({ work_date: future })).status === 400);
  check('Ngày không có thật bị từ chối', (await bad({ work_date: `${month}-32` })).status === 400);
  check('Kế toán không tự sửa giờ của chính mình (403)', (await bad({ user_id: accountant.id })).status === 403);
  const ownerSelf = await put(owner, { user_id: accountant.id, work_date: firstDay, in_time: '07:45', out_time: '17:30', note: 'Chủ cửa hàng bổ sung' });
  check('Chủ cửa hàng sửa được giờ cho kế toán', ownerSelf.status === 200 && ownerSelf.data.record.cong === 1);

  /* Bảng công tháng */
  await set('07:30', '17:45');
  const table = (await call(`/attendance/month?month=${month}`, { token: accountant.token })).data;
  const row = table.staff?.find((s) => s.id === shipper.id);
  const expected = today === firstDay ? 1 : 1 + (outRes.data.record.cong || 0);
  check('Bảng tháng có từng nhân viên, ô theo ngày và tổng công', row && row.days[1]?.cong === 1 && row.totals.cong === expected && table.days_in_month >= 28,
    JSON.stringify(row?.totals));
  check('Bảng tháng có cả nhân viên chưa chấm ngày nào', table.staff.some((s) => s.id === accountant.id));
  check('Tháng sai dạng bị từ chối', (await call('/attendance/month?month=2026-13', { token: accountant.token })).status === 400);
  check('Không lộ mật khẩu trong bảng công', !/password/.test(JSON.stringify(table)));

  /* Xoá ngày công chấm nhầm */
  const del = await put(accountant.token, { user_id: shipper.id, work_date: firstDay, in_time: '', note: 'Chấm nhầm ngày nghỉ' });
  const after = (await call(`/attendance/month?month=${month}`, { token: accountant.token })).data.staff.find((s) => s.id === shipper.id);
  check('Bỏ trống giờ vào = xoá ngày công', del.status === 200 && del.data.record === null && (today === firstDay || !after.days[1]));
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
