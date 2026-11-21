// Quản trị → CẬP NHẬT: thông tin hoá đơn, mã QR, thông báo nghỉ lễ / cập nhật trang web (20/11/2026).
// Cách chạy: node test/business.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const short = (value) => String(JSON.stringify(value)).slice(0, 300);
const day = (offset) => new Date(Date.now() + 7 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = `6${String(Date.now() % 1e6).padStart(6, '0')}`;   // chữ số thứ ba luôn là 6 → đầu số di động hợp lệ

  let pub = (await call('/settings/storefront')).data.settings;
  check('Mặc định: điện thoại trên hoá đơn là 0986.407.975 - 0979.848.405', pub.invoice?.phones === '0986.407.975 - 0979.848.405', short(pub.invoice));
  check('Mặc định: tài khoản Vietcombank 1204372888, chủ tài khoản công ty', pub.invoice.bank_number === '1204372888' && /LÚA VÀNG/.test(pub.invoice.bank_holder));
  check('Chưa có thông báo nào', Array.isArray(pub.notices) && pub.notices.length === 0);

  const invoice = { ...pub.invoice, phones: '0986.407.975', address2: '', bank_name: 'BIDV', bank_number: '1234 5678 90' };
  const saved = await call('/admin/settings/business', { method: 'PUT', token: owner, body: { invoice, bank_qr_url: '/bank-qr.png' } });
  check('Chủ cửa hàng lưu thông tin hoá đơn', saved.status === 200 && saved.data.invoice.bank_name === 'BIDV' && saved.data.invoice.address2 === '', short(saved.data));
  pub = (await call('/settings/storefront')).data.settings;
  check('Trang khách nhận thông tin mới (khung chuyển khoản, hoá đơn)', pub.invoice.bank_number === '1234 5678 90' && pub.invoice.phones === '0986.407.975');
  check('Thiếu số tài khoản (400)', (await call('/admin/settings/business', { method: 'PUT', token: owner, body: { invoice: { ...invoice, bank_number: '' } } })).status === 400);
  check('Số tài khoản có chữ (400)', (await call('/admin/settings/business', { method: 'PUT', token: owner, body: { invoice: { ...invoice, bank_number: 'abc123456' } } })).status === 400);
  check('Ảnh QR không an toàn (400)', (await call('/admin/settings/business', { method: 'PUT', token: owner, body: { bank_qr_url: 'javascript:alert(1)' } })).status === 400);

  const staffPhone = `03${suffix}1`;
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Em Quản Lý', phone: staffPhone, password: 'nhanvien26', permissions: ['orders.view', 'orders.manage', 'products.manage'] } });
  const staff = await login(staffPhone, 'nhanvien26');
  check('Nhân viên (kể cả quản lý sản phẩm) không sửa được mục CẬP NHẬT (403)', (await call('/admin/settings/business', { method: 'PUT', token: staff, body: { invoice } })).status === 403
    && (await call('/admin/settings/business', { token: staff })).status === 403);
  check('Chưa đăng nhập (401)', (await call('/admin/settings/business')).status === 401);

  const notices = [
    { kind: 'holiday', title: 'Nghỉ Tết Nguyên Đán', start: day(3), end: day(8), reopen: day(9), note: 'Đơn đặt trong lúc nghỉ giao từ ngày mở lại.' },
    { kind: 'maintenance', title: 'Cập nhật trang web', start: day(20), end: day(21) },
    { kind: 'holiday', title: 'Nghỉ lễ đã qua', start: day(-10), end: day(-8), reopen: day(-7) },
    { kind: 'maintenance', start: day(-1), end: day(0), show_from: day(-2) },
  ];
  const n = await call('/admin/settings/business', { method: 'PUT', token: owner, body: { notices } });
  check('Lưu 4 thông báo', n.status === 200 && n.data.notices.length === 4, short(n.data));
  pub = (await call('/settings/storefront')).data.settings;
  const kinds = pub.notices.map((x) => `${x.kind}:${x.start}`);
  check('Trang khách chỉ thấy thông báo trong khoảng hiện: Tết (trước 7 ngày) và cập nhật đang diễn ra', pub.notices.length === 2
    && kinds.includes(`holiday:${day(3)}`) && kinds.includes(`maintenance:${day(-1)}`), short(pub.notices));
  check('Thông báo Tết có ngày mở lại và ghi chú', pub.notices.find((x) => x.kind === 'holiday')?.reopen === day(9) && /mở lại/.test(pub.notices.find((x) => x.kind === 'holiday').note));
  const bad = async (notice) => (await call('/admin/settings/business', { method: 'PUT', token: owner, body: { notices: [notice] } })).status;
  check('Nghỉ lễ thiếu tên (400)', await bad({ kind: 'holiday', start: day(1), end: day(2) }) === 400);
  check('Ngày kết thúc trước ngày bắt đầu (400)', await bad({ kind: 'maintenance', start: day(5), end: day(2) }) === 400);
  check('Ngày mở lại không sau ngày nghỉ cuối (400)', await bad({ kind: 'holiday', title: 'Lễ', start: day(1), end: day(3), reopen: day(3) }) === 400);
  check('Ngày sai dạng (400)', await bad({ kind: 'holiday', title: 'Lễ', start: '2026-13-01', end: day(3) }) === 400);
  const cleared = await call('/admin/settings/business', { method: 'PUT', token: owner, body: { notices: [] } });
  check('Xoá hết thông báo: trang khách hết dải thông báo', cleared.status === 200 && (await call('/settings/storefront')).data.settings.notices.length === 0);
  // Khoá Google Maps cho bản đồ điều phối (21/11/2026)
  const KEY = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
  check('Khoá Google Maps sai dạng bị từ chối (400)', (await call('/admin/settings/business', { method: 'PUT', token: owner, body: { maps_api_key: 'abc' } })).status === 400);
  const mk = await call('/admin/settings/business', { method: 'PUT', token: owner, body: { maps_api_key: KEY } });
  check('Chủ cửa hàng lưu khoá Google Maps', mk.status === 200 && mk.data.maps_api_key === KEY, short(mk.data));
  check('Bản đồ điều phối nhận khoá Google Maps', (await call('/admin/dispatch', { token: owner })).data.maps_key === KEY);
  check('Trang khách không lộ khoá Google Maps', !JSON.stringify((await call('/settings/storefront')).data).includes(KEY));
  check('Nhân viên không sửa được khoá Google Maps (403)', (await call('/admin/settings/business', { method: 'PUT', token: staff, body: { maps_api_key: '' } })).status === 403);
  const actLog = JSON.stringify((await call('/admin/activity?limit=5', { token: owner })).data);
  check('Nhật ký chỉ ghi 4 ký tự cuối của khoá', !actLog.includes(KEY) && actLog.includes(KEY.slice(-4)));
  check('Xoá khoá Google Maps', (await call('/admin/settings/business', { method: 'PUT', token: owner, body: { maps_api_key: '' } })).data.maps_api_key === '');
  const log = (await call('/admin/activity?limit=5', { token: owner })).data;
  check('Nhật ký ghi lại thay đổi', JSON.stringify(log).includes('business_info'), short(log).slice(0, 200));
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
