// Hồ sơ khách tự lưu từ các đơn (tên, địa chỉ, định vị, tự cập nhật) và lọc ngày ở trang Đơn hàng theo đúng
// ngày của từng mục (Hoàn thành theo ngày giao xong, Đã huỷ theo ngày huỷ) — 18/11/2026.
// Cách chạy: node test/profiles.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import path from 'node:path';
import Database from 'better-sqlite3';
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const short = (v) => JSON.stringify(v).slice(0, 300);

const app = await fixture();
const { call } = app;
let db = null;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  const phone = (p, n) => `${p}${suffix}${n}`;
  const product = (await call('/admin/products', { method: 'POST', token: owner, body: { name: `Gạo hồ sơ ${suffix}`, price: 120000, cost_price: 1000, unit: 'túi 5kg', stock: 500 } })).data.product;
  const staff = async (name, n, permissions) => {
    const p = phone('03', n);
    await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: p, password: 'nhanvien26', permissions } });
    return login(p, 'nhanvien26');
  };
  const sales = await staff('Em Bán Hàng', 1, ['orders.view', 'orders.manage', 'orders.create']);
  const shipper = await staff('Anh Giao', 2, ['delivery']);
  const lookup = (p, token = sales) => call(`/admin/customer-profiles/lookup?phone=${p}`, { token });

  /* ---------- Hồ sơ khách tự lưu ---------- */
  const lan = phone('09', 3);
  const guest = await call('/orders/guest', { method: 'POST', body: {
    receiver_name: 'Chị Lan', phone: lan, address: 'Số 8 đường Ngô Gia Tự, phường Suối Hoa', delivery_area: 'bac-ninh',
    payment_method: 'cod', latitude: 21.1861, longitude: 106.0763, items: [{ product_id: product.id, quantity: 1 }],
  } });
  let p1 = (await lookup(lan)).data.profile;
  check('Khách đặt online lần đầu: tự lưu tên, địa chỉ, vị trí khách ghim', guest.status === 201 && p1?.full_name === 'Chị Lan' && /Ngô Gia Tự/.test(p1.address || '')
    && /query=21\.1861,106\.0763/.test(p1.location || '') && p1.order_count === 1 && p1.last_order_code === guest.data.order.code, short(p1));

  const order = (body) => call('/admin/orders', { method: 'POST', token: sales, body: {
    receiver_name: 'Chị Lan Anh', phone: lan, home_delivery: true, address: 'Số 8 đường Ngô Gia Tự, phường Suối Hoa', payment_method: 'cod',
    items: [{ product_id: product.id, quantity: 1 }], ...body,
  } });
  await order({ address: 'Số 8 đường Ngô Gia Tự, phường Suối Hoa, Bắc Ninh' });
  p1 = (await lookup(lan)).data.profile;
  check('Đơn sau cùng địa chỉ, không gửi định vị: giữ định vị cũ, cập nhật tên, đếm 2 đơn', p1.full_name === 'Chị Lan Anh' && /query=21\.1861/.test(p1.location || '') && p1.order_count === 2, short(p1));
  await order({ address: 'Số 20 đường Lý Thái Tổ, phường Suối Hoa' });
  p1 = (await lookup(lan)).data.profile;
  check('Đổi sang địa chỉ khác mà không có định vị: lưu địa chỉ mới, bỏ định vị cũ', /Lý Thái Tổ/.test(p1.address) && p1.location === null && p1.order_count === 3, short(p1));
  await order({ address: 'Số 20 đường Lý Thái Tổ, phường Suối Hoa', map_url: 'https://maps.app.goo.gl/NhaChiLan' });
  p1 = (await lookup(lan)).data.profile;
  check('Đơn có link định vị: lưu định vị mới', p1.location === 'https://maps.app.goo.gl/NhaChiLan' && p1.map_url === 'https://maps.app.goo.gl/NhaChiLan', short(p1));
  await order({ home_delivery: false, address: null });
  p1 = (await lookup(lan)).data.profile;
  check('Đơn khách lấy tại cửa hàng: giữ nguyên địa chỉ và định vị đã lưu', /Lý Thái Tổ/.test(p1.address) && p1.location === 'https://maps.app.goo.gl/NhaChiLan' && p1.order_count === 5, short(p1));
  check('Tra số chưa từng đặt: không có hồ sơ', (await lookup(phone('09', 9))).data.profile === null);
  check('Tra bằng số dạng +84 / có dấu cách vẫn ra', (await lookup(`%2B84${lan.slice(1)}`)).data.profile?.phone === lan);

  const list = (await call('/admin/customer-profiles?q=ly%20thai%20to', { token: owner })).data;
  check('Danh sách hồ sơ: tìm không dấu theo địa chỉ', list.profiles?.some((x) => x.phone === lan) && list.total >= 1, short(list));
  check('Danh sách hồ sơ: tìm theo số điện thoại', (await call(`/admin/customer-profiles?q=${lan.slice(2, 8)}`, { token: owner })).data.profiles.some((x) => x.phone === lan));
  check('Nhân viên giao hàng không xem hồ sơ khách (403)', (await lookup(lan, shipper)).status === 403);
  check('Chưa đăng nhập không xem hồ sơ khách (401)', (await call(`/admin/customer-profiles/lookup?phone=${lan}`)).status === 401);
  check('Khách trên web không có đường nào tra hồ sơ người khác', (await call(`/orders/track`, { method: 'POST', body: { phone: lan } })).data.orders?.every((o) => !('address' in o)));

  /* ---------- Lọc ngày ở trang Đơn hàng ---------- */
  db = new Database(path.join(app.directory, 'app.db'));
  db.pragma('busy_timeout = 5000');
  const vnDay = (offsetDays = 0) => new Date(Date.now() + 7 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
  const today = vnDay(0);
  const yesterday = vnDay(-1);
  const made = (await order({ receiver_name: 'Khách Hôm Qua', phone: phone('07', 4), address: 'Số 5 đường Trần Hưng Đạo, phường Tiền An' })).data.order;
  const cancelledOrder = (await order({ receiver_name: 'Khách Huỷ Hôm Nay', phone: phone('07', 5), address: 'Số 6 đường Trần Hưng Đạo, phường Tiền An' })).data.order;
  // Hai đơn đặt từ hôm qua (giờ Việt Nam 22:40), hôm nay mới giao xong / huỷ.
  db.prepare("UPDATE orders SET created_at = datetime(?, '-7 hours'), confirmed_at = datetime(?, '-7 hours') WHERE id IN (?, ?)")
    .run(`${yesterday} 22:40:00`, `${yesterday} 22:45:00`, made.id, cancelledOrder.id);
  for (const status of ['shipping', 'completed']) await call(`/admin/orders/${made.id}/status`, { method: 'PATCH', token: owner, body: { status } });
  await call(`/admin/orders/${cancelledOrder.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  const list2 = async (status, day) => (await call(`/admin/orders?${status === 'all' ? '' : `status=${status}&`}from=${day}&to=${day}&limit=300`, { token: owner })).data;
  const doneToday = await list2('completed', today);
  check('Hoàn thành + Hôm nay: thấy đơn đặt hôm qua nhưng giao xong hôm nay (lỗi cũ)', doneToday.orders.some((o) => o.id === made.id) && doneToday.counts.completed >= 1, short(doneToday.counts));
  check('Hoàn thành + Hôm qua: không còn đơn đó (chưa giao xong hôm qua)', !(await list2('completed', yesterday)).orders.some((o) => o.id === made.id));
  check('Đã huỷ + Hôm nay: thấy đơn đặt hôm qua, huỷ hôm nay', (await list2('cancelled', today)).orders.some((o) => o.id === cancelledOrder.id));
  const allToday = await list2('all', today);
  check('Tất cả + Hôm nay: gồm đơn giao xong / huỷ hôm nay, số đếm từng mục cộng lại đúng bằng Tất cả', allToday.orders.some((o) => o.id === made.id) && allToday.orders.some((o) => o.id === cancelledOrder.id)
    && allToday.counts.all === ['pending', 'confirmed', 'shipping', 'completed', 'cancelled'].reduce((n, s) => n + allToday.counts[s], 0), short(allToday.counts));
  const fresh = (await order({ receiver_name: 'Khách Mới', phone: phone('07', 6), address: 'Số 7 đường Trần Hưng Đạo, phường Tiền An' })).data.order;
  check('Đơn đang xử lý vẫn lọc theo ngày đặt', (await list2('confirmed', today)).orders.some((o) => o.id === fresh.id) && !(await list2('confirmed', yesterday)).orders.some((o) => o.id === fresh.id));
} catch (err) {
  results.push(`FAIL  Lỗi khi chạy: ${err.stack || err.message}`);
} finally {
  db?.close();
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
