// Tài khoản nhân viên và phân quyền (kế toán, giao hàng, bán hàng) — kiểm tra ở máy chủ.
// Cách chạy: node test/staff.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } }));
try {
  const owner = (await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD)).data.token;
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  const phone = (p) => `${p}${suffix}${Math.floor(Math.random() * 10)}`;
  const staff = (body) => call('/admin/staff', { method: 'POST', token: owner, body });

  /* Chủ cửa hàng tạo tài khoản */
  const catalog = (await call('/admin/staff', { token: owner })).data;
  check('Có danh sách quyền và mẫu Kế toán / Giao hàng / Bán hàng', !!catalog.permissions?.['orders.view']
    && catalog.presets?.['ke-toan']?.permissions.includes('revenue.view') && catalog.presets?.['giao-hang']?.permissions[0] === 'delivery');
  const accPhone = phone('07');
  const shipPhone = phone('03');
  const salePhone = phone('05');
  const acc = await staff({ full_name: 'Chị Kế Toán', phone: accPhone, password: 'ketoan2026', staff_title: 'Kế toán', permissions: catalog.presets['ke-toan'].permissions });
  check('Tạo tài khoản kế toán', acc.status === 201, JSON.stringify(acc.data).slice(0, 200));
  check('Tạo tài khoản giao hàng', (await staff({ full_name: 'Anh Giao Hàng', phone: shipPhone, password: 'giaohang26', staff_title: 'Giao hàng', permissions: ['delivery'] })).status === 201);
  check('Tạo tài khoản bán hàng', (await staff({ full_name: 'Em Bán Hàng', phone: salePhone, password: 'banhang26', permissions: catalog.presets['ban-hang'].permissions })).status === 201);
  check('Quyền lạ bị từ chối (400)', (await staff({ full_name: 'Lạ', phone: phone('08'), password: 'abcdefgh9', permissions: ['root'] })).status === 400);
  check('Không chọn quyền nào bị từ chối (400)', (await staff({ full_name: 'Rỗng', phone: phone('08'), password: 'abcdefgh9', permissions: [] })).status === 400);
  check('Trùng số đăng nhập bị từ chối (409)', (await staff({ full_name: 'Trùng', phone: accPhone, password: 'abcdefgh9', permissions: ['orders.view'] })).status === 409);
  check('Không lộ mật khẩu trong danh sách', !JSON.stringify((await call('/admin/staff', { token: owner })).data).includes('password'));

  const accLogin = await login(accPhone, 'ketoan2026');
  const accountant = accLogin.data.token;
  check('Kế toán đăng nhập bằng số điện thoại, thấy đúng quyền', accLogin.status === 200 && accLogin.data.user.role === 'staff'
    && JSON.stringify(accLogin.data.user.permissions) === JSON.stringify(catalog.presets['ke-toan'].permissions), JSON.stringify(accLogin.data.user));
  const shipper = (await login(shipPhone, 'giaohang26')).data.token;
  const sales = (await login(salePhone, 'banhang26')).data.token;
  const me = (await call('/auth/me', { token: shipper })).data.user;
  check('/auth/me trả quyền và chức vụ', JSON.stringify(me.permissions) === '["delivery"]' && me.staff_title === 'Giao hàng');

  /* Kế toán: xem đơn, doanh thu, xuất Excel — không sửa gì */
  const status = async (token, path, opts = {}) => (await call(path, { token, ...opts })).status;
  check('Kế toán xem được danh sách đơn', await status(accountant, '/admin/orders') === 200);
  check('Kế toán xem được doanh thu', await status(accountant, '/admin/revenue') === 200);
  check('Kế toán xuất được Excel', await status(accountant, '/admin/export/orders') === 200);
  const stats = (await call('/admin/stats', { token: accountant })).data.stats;
  check('Kế toán: thống kê có doanh thu, không có giá trị vốn tồn kho', 'revenue' in stats && !('inventoryValue' in stats));
  for (const [label, path, opts] of [
    ['sửa sản phẩm', '/admin/products'],
    ['quản lý khách', '/admin/customers'],
    ['bán tại quầy', '/retail/invoices'],
    ['nhật ký', '/admin/activity'],
    ['cài đặt cửa hàng', '/admin/settings/storefront', { method: 'PUT', body: { contact_phone: '0912345678' } }],
    ['quản lý nhân viên', '/admin/staff'],
    ['mã giảm giá', '/admin/discount-codes'],
    ['trang Về chúng tôi', '/admin/about'],
    ['tải ảnh', '/admin/images'],
    ['trang giao hàng', '/delivery/orders'],
  ]) check(`Kế toán KHÔNG ${label} (403)`, await status(accountant, path, opts) === 403);

  /* Nhân viên giao hàng */
  check('Giao hàng KHÔNG xem danh sách đơn của cửa hàng (403)', await status(shipper, '/admin/orders') === 403);
  check('Giao hàng: chưa được phân công thì danh sách trống', (await call('/delivery/orders', { token: shipper })).data.orders?.length === 0);
  const product = (await call('/admin/products', { method: 'POST', token: owner, body: { name: `Gạo giao ${suffix}`, price: 100000, cost_price: 70000, unit: 'túi 5kg', stock: 50 } })).data.product;
  const guestPhone = phone('09');
  const order = (await call('/orders/guest', { method: 'POST', body: {
    receiver_name: 'Cô Nhận Hàng', phone: guestPhone, address: 'Số 1 đường Lý Thái Tổ, phường Suối Hoa', delivery_area: 'bac-ninh',
    payment_method: 'cod', items: [{ product_id: product.id, quantity: 2 }], latitude: 21.18, longitude: 106.07,
  } })).data.order;
  const shippers = (await call('/admin/shippers', { token: sales })).data.shippers;
  const shipperId = shippers?.find((s) => s.full_name === 'Anh Giao Hàng')?.id;
  check('Bán hàng thấy danh sách nhân viên giao hàng (chỉ người có quyền giao)', !!shipperId && shippers.length === 1, JSON.stringify(shippers));
  const accId = (await call('/admin/staff', { token: owner })).data.staff.find((s) => s.full_name === 'Chị Kế Toán').id;
  check('Không giao đơn cho người không phải nhân viên giao hàng (400)',
    await status(sales, `/admin/orders/${order.id}/shipper`, { method: 'PATCH', body: { shipper_id: accId } }) === 400);
  check('Kế toán phân công giao được (cập nhật các bước trước khi giao)',
    await status(accountant, `/admin/orders/${order.id}/shipper`, { method: 'PATCH', body: { shipper_id: shipperId } }) === 200);
  const assigned = await call(`/admin/orders/${order.id}/shipper`, { method: 'PATCH', token: sales, body: { shipper_id: shipperId } });
  check('Bán hàng phân công đơn cho nhân viên giao', assigned.status === 200 && assigned.data.order.shipper_name === 'Anh Giao Hàng');
  const adminList = (await call('/admin/orders', { token: owner })).data.orders;
  check('Danh sách đơn quản trị có tên người giao', adminList.find((o) => o.id === order.id)?.shipper_name === 'Anh Giao Hàng');
  check('Giao hàng: chưa xác nhận thì chưa hiện trong việc cần giao', (await call('/delivery/orders', { token: shipper })).data.orders.length === 0);
  check('Bán hàng xác nhận đơn được', await status(sales, `/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'confirmed' } }) === 200);
  const mine = (await call('/delivery/orders', { token: shipper })).data.orders;
  check('Giao hàng thấy đơn được giao: tên, SĐT, địa chỉ, vị trí, hàng, tiền thu', mine.length === 1 && mine[0].phone === guestPhone
    && mine[0].address.includes('Lý Thái Tổ') && mine[0].delivery_lat === 21.18 && mine[0].items[0].quantity === 2 && mine[0].total === order.total
    && !JSON.stringify(mine).includes('cost_price'), JSON.stringify(mine).slice(0, 200));
  check('Giao hàng không huỷ được đơn (400)', await status(shipper, `/delivery/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'cancelled' } }) === 400);
  check('Giao hàng: bắt đầu giao', await status(shipper, `/delivery/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'shipping' } }) === 200);
  check('Kế toán không bấm hoàn thành đơn giao tận nơi (nhân viên giao bấm) (403)',
    await status(accountant, `/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'completed' } }) === 403);
  // Giao xong phải kèm ảnh (12/11/2026).
  const proof = await (await fetch(`${app.base}/api/proofs`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${shipper}` },
    body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('anh-giao-hang-thu'.padEnd(40, 'x'))]) })).json();
  const done = await call(`/delivery/orders/${order.id}/status`, { method: 'PATCH', token: shipper, body: { status: 'completed', photo: proof.id } });
  check('Giao hàng: đã giao xong', done.status === 200 && done.data.order.status === 'completed' && !!done.data.order.completed_at);
  const tracked = (await call('/orders/track', { method: 'POST', body: { phone: guestPhone, code: order.code } })).data.order;
  check('Khách tra cứu thấy "đã giao xong" kèm giờ', tracked.status === 'completed' && !!tracked.shipping_at && !!tracked.completed_at);
  const points = (await call(`/admin/orders?status=completed`, { token: owner })).data.orders.find((o) => o.id === order.id)?.points_earned;
  check('Giao xong qua nhân viên vẫn cộng điểm cho khách', points > 0, String(points));
  const today = (await call('/delivery/orders', { token: shipper })).data.orders;
  check('Đơn đã giao hôm nay vẫn hiện ở mục đã giao', today.length === 1 && today[0].status === 'completed');

  // Đơn của người khác
  const other = (await call('/orders/guest', { method: 'POST', body: {
    receiver_name: 'Chú Khác', phone: phone('06'), address: 'Số 2 đường Lý Thái Tổ, phường Suối Hoa', delivery_area: 'bac-ninh',
    payment_method: 'cod', items: [{ product_id: product.id, quantity: 1 }],
  } })).data.order;
  await call(`/admin/orders/${other.id}/status`, { method: 'PATCH', token: owner, body: { status: 'confirmed' } });
  check('Giao hàng không đụng được đơn không phải của mình (404)',
    await status(shipper, `/delivery/orders/${other.id}/status`, { method: 'PATCH', body: { status: 'shipping' } }) === 404);
  check('Không đổi người giao cho đơn đã xong (400)',
    await status(owner, `/admin/orders/${order.id}/shipper`, { method: 'PATCH', body: { shipper_id: null } }) === 400);

  // Khách lấy tại cửa hàng: kế toán xác nhận → đang giao → khách đã nhận (không cần nhân viên giao).
  const pickup = (await call('/admin/orders', { method: 'POST', token: owner, body: {
    receiver_name: 'Cô Lấy Tại Quầy', phone: phone('07'), home_delivery: false, items: [{ product_id: product.id, quantity: 1 }],
  } })).data.order;
  await call(`/admin/orders/${pickup.id}/status`, { method: 'PATCH', token: accountant, body: { status: 'shipping' } });
  check('Đơn lấy tại cửa hàng: kế toán bấm hoàn thành được',
    await status(accountant, `/admin/orders/${pickup.id}/status`, { method: 'PATCH', body: { status: 'completed' } }) === 200);

  /* Chủ cửa hàng đổi quyền / khoá: có hiệu lực ngay */
  await call(`/admin/staff/${accId}`, { method: 'PUT', token: owner, body: { permissions: ['orders.view'] } });
  check('Bỏ quyền doanh thu: kế toán bị chặn ngay ở yêu cầu kế tiếp', await status(accountant, '/admin/revenue') === 403);
  check('Nhân viên không tự cấp quyền qua hồ sơ (400)', await status(accountant, '/auth/me', { method: 'PUT', body: { permissions: ['revenue.view'] } }) === 400);
  await call(`/admin/staff/${accId}/lock`, { method: 'PATCH', token: owner, body: { is_locked: true } });
  check('Khoá tài khoản: phiên cũ hết hiệu lực', [401, 403].includes(await status(accountant, '/admin/orders')));
  check('Khoá tài khoản: không đăng nhập được', (await login(accPhone, 'ketoan2026')).status === 403);
  await call(`/admin/staff/${accId}/lock`, { method: 'PATCH', token: owner, body: { is_locked: false } });
  await call(`/admin/staff/${accId}/reset-password`, { method: 'POST', token: owner, body: { password: 'matkhaumoi1' } });
  check('Đặt lại mật khẩu: đăng nhập bằng mật khẩu mới', (await login(accPhone, 'matkhaumoi1')).status === 200);

  /* Khách thường */
  const customer = (await call('/auth/register', { method: 'POST', body: { full_name: 'Khách Thường', phone: phone('08'), password: 'gao2024!' } })).data.token;
  check('Khách thường không vào quản lý nhân viên (403)', await status(customer, '/admin/staff') === 403);
  check('Khách thường không vào trang giao hàng (403)', await status(customer, '/delivery/orders') === 403);
  check('Khách thường không xem đơn cửa hàng (403)', await status(customer, '/admin/orders') === 403);
  check('Nhân viên không tạo được nhân viên khác (403)', await status(sales, '/admin/staff', { method: 'POST', body: { full_name: 'X', phone: phone('08'), password: 'abcdefgh9', permissions: ['orders.view'] } }) === 403);
  check('Danh sách khách không lẫn tài khoản nhân viên',
    !(await call('/admin/customers', { token: owner })).data.customers.some((c) => c.role === 'staff'));
} finally {
  await app.close();
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
assert.equal(failed, 0);
