// Định vị Google Maps khi tạo đơn; thêm khách buôn kèm định vị, gạo hay đặt và giá cố định trong một lần lưu.
// Cách chạy: node test/map-link.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';
import { parseMapLink } from '../src/map-link.js';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

/* Hàm đọc link */
const SHORT = 'https://maps.app.goo.gl/AbCd123xYz';
check('Link rút gọn Google Maps', parseMapLink(SHORT).url === SHORT);
check('Dán kèm chữ: lấy đúng link, bỏ dấu chấm cuối', parseMapLink(`Vị trí của em: ${SHORT}. Giao giúp em nhé`).url === SHORT, JSON.stringify(parseMapLink(`Vị trí của em: ${SHORT}.`)));
check('Link đầy đủ google.com/maps', /^https:\/\/www\.google\.com\/maps\/place\//.test(parseMapLink('https://www.google.com/maps/place/B%E1%BA%AFc+Ninh/@21.18,106.07,15z').url || ''));
check('http tự đổi sang https', parseMapLink('http://maps.google.com/?q=21.18,106.07').url === 'https://maps.google.com/?q=21.18,106.07');
check('Link goo.gl/maps cũ', parseMapLink('https://goo.gl/maps/abc123').url === 'https://goo.gl/maps/abc123');
check('Toạ độ đổi thành link Google Maps', parseMapLink('21.1861, 106.0763').url === 'https://www.google.com/maps/search/?api=1&query=21.1861,106.0763');
check('Để trống = không có định vị', parseMapLink('').url === null && parseMapLink(null).url === null && parseMapLink('   ').url === null);
for (const [name, bad] of [
  ['Trang lạ', 'https://evil.example.com/maps'],
  ['Tên miền giả dạng', 'https://maps.app.goo.gl.evil.com/x'],
  ['javascript:', 'javascript:alert(1)'],
  ['Google nhưng không phải bản đồ', 'https://www.google.com/search?q=gao'],
  ['Link có tài khoản đăng nhập', 'https://user:pw@maps.app.goo.gl/x'],
  ['goo.gl không phải bản đồ', 'https://goo.gl/abc'],
  ['Toạ độ ngoài phạm vi', '95.0,200.0'],
  ['Chữ không có link', 'ngã tư gần chợ'],
]) check(`Từ chối: ${name}`, !!parseMapLink(bad).error && !parseMapLink(bad).url, JSON.stringify(parseMapLink(bad)));

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  const phone = (p, n) => `${p}${suffix}${n}`;
  const make = async (name, price) => (await call('/admin/products', { method: 'POST', token: owner, body: { name: `${name} ${suffix}`, price, cost_price: 1000, unit: 'bao 25kg', stock: 500 } })).data.product;
  const st25 = await make('Gạo ST25 định vị', 450000);
  const thom = await make('Gạo thơm định vị', 380000);
  const salesPhone = phone('05', 1);
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Em Bán Hàng', phone: salesPhone, password: 'banhang26', permissions: ['orders.view', 'orders.manage', 'orders.create'] } });
  const sales = await login(salesPhone, 'banhang26');
  const shipPhone = phone('03', 2);
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Anh Giao', phone: shipPhone, password: 'giaohang26', permissions: ['delivery'] } });
  const shipper = await login(shipPhone, 'giaohang26');
  const shipperId = (await call('/admin/shippers', { token: sales })).data.shippers[0].id;

  /* Đơn nhân viên tạo có định vị */
  const order = (body) => call('/admin/orders', { method: 'POST', token: sales, body: {
    receiver_name: 'Chị Hoa', phone: phone('09', 3), home_delivery: true, address: 'Số 12 đường Nguyễn Trãi, phường Võ Cường', payment_method: 'cod',
    items: [{ product_id: st25.id, quantity: 1 }], ...body,
  } });
  const o1 = await order({ map_url: `Em gửi định vị ạ ${SHORT}`, shipper_id: shipperId });
  check('Tạo đơn kèm định vị: lưu đúng link', o1.status === 201 && o1.data.order.map_url === SHORT, JSON.stringify(o1.data).slice(0, 250));
  const mineToShip = (await call('/delivery/orders', { token: shipper })).data;
  const shipRow = [...(mineToShip.orders || []), ...(mineToShip.active || [])].find((o) => o.id === o1.data.order?.id);
  check('Nhân viên giao hàng thấy định vị của đơn', shipRow?.map_url === SHORT, JSON.stringify(mineToShip).slice(0, 250));
  const adminRow = (await call('/admin/orders?limit=20', { token: owner })).data.orders.find((o) => o.id === o1.data.order?.id);
  check('Danh sách đơn quản trị có định vị', adminRow?.map_url === SHORT);
  const bad = await order({ phone: phone('09', 4), map_url: 'https://evil.example.com/maps' });
  check('Link không phải Google Maps bị từ chối (400), báo đúng ô', bad.status === 400 && /Google Maps/.test(bad.data.errors?.map_url || ''), JSON.stringify(bad.data));
  const none = await order({ phone: phone('09', 5) });
  check('Không dán định vị vẫn tạo đơn được', none.status === 201 && none.data.order.map_url == null);
  const pickup = await order({ phone: phone('09', 6), home_delivery: false, address: null, map_url: SHORT });
  check('Khách tự đến lấy: không lưu định vị', pickup.status === 201 && pickup.data.order.map_url == null, JSON.stringify(pickup.data).slice(0, 200));
  const coords = await order({ phone: phone('09', 7), map_url: '21.1861,106.0763' });
  check('Dán toạ độ: đổi thành link Google Maps', coords.status === 201 && coords.data.order.map_url === 'https://www.google.com/maps/search/?api=1&query=21.1861,106.0763');

  /* Thêm khách buôn kèm định vị, gạo hay đặt và giá cố định trong một lần */
  const custPhone = phone('08', 8);
  const body = { company: 'Bếp ăn Trường Tiểu học Suối Hoa', contact_name: 'Cô Lan', phone: custPhone, address: 'Đường Lý Thái Tổ, phường Suối Hoa', map_url: SHORT };
  const badPrice = await call('/admin/wholesale', { method: 'POST', token: owner, body: { ...body, prices: [{ product_id: st25.id, price: 400000 }, { product_id: 99999999, price: 1000 }] } });
  check('Gạo hay đặt có loại không tồn tại: từ chối, không lưu dở khách', badPrice.status === 400
    && !(await call(`/admin/wholesale?q=${custPhone}`, { token: owner })).data.customers.length, JSON.stringify(badPrice.data));
  check('Định vị sai khi thêm khách bị từ chối (400)', (await call('/admin/wholesale', { method: 'POST', token: owner, body: { ...body, map_url: 'https://example.com/x' } })).status === 400);
  const created = await call('/admin/wholesale', { method: 'POST', token: owner, body: { ...body, prices: [{ product_id: st25.id, price: 400000 }, { product_id: thom.id, price: 350000 }] } });
  const ws = created.data.customer;
  check('Thêm khách kèm định vị, gạo hay đặt và giá cố định trong một lần', created.status === 201 && ws?.map_url === SHORT
    && created.data.prices?.length === 2 && created.data.prices.some((p) => p.product_id === thom.id && p.price === 350000), JSON.stringify(created.data).slice(0, 300));
  check('Nhân viên bán hàng không thêm khách kèm giá được (403)', (await call('/admin/wholesale', { method: 'POST', token: sales, body: { ...body, phone: phone('08', 9), prices: [{ product_id: st25.id, price: 1 }] } })).status === 403);
  const detail = await call(`/admin/wholesale/${ws.id}`, { token: sales });
  check('Nhân viên bán hàng thấy định vị và gạo hay đặt để tạo đơn', detail.data.customer?.map_url === SHORT && detail.data.prices.length === 2);
  const w1 = await order({ phone: custPhone, receiver_name: 'Cô Lan', customer_type: 'wholesale', wholesale_customer_id: ws.id, map_url: ws.map_url, items: [{ product_id: thom.id, quantity: 4 }] });
  check('Đơn khách buôn: đúng giá cố định, có định vị', w1.status === 201 && w1.data.order.items[0].price === 350000 && w1.data.order.map_url === SHORT, JSON.stringify(w1.data).slice(0, 250));

  /* Sửa khách: đổi giá, bỏ một loại, xoá định vị */
  const updated = await call(`/admin/wholesale/${ws.id}`, { method: 'PUT', token: owner, body: { map_url: null, prices: [{ product_id: st25.id, price: 410000 }, { product_id: thom.id, price: null }] } });
  check('Sửa khách: đổi giá một loại, bỏ một loại, xoá định vị', updated.status === 200 && updated.data.customer.map_url === null
    && updated.data.prices.length === 1 && updated.data.prices[0].price === 410000, JSON.stringify(updated.data).slice(0, 300));
  check('Sửa khách với giá 0 bị từ chối (400)', (await call(`/admin/wholesale/${ws.id}`, { method: 'PUT', token: owner, body: { prices: [{ product_id: st25.id, price: 0 }] } })).status === 400);
  const relink = await call(`/admin/wholesale/${ws.id}`, { method: 'PUT', token: owner, body: { map_url: '21.1861,106.0763' } });
  check('Sửa khách: dán toạ độ làm định vị', /query=21\.1861,106\.0763$/.test(relink.data.customer?.map_url || ''));
  check('Danh sách khách buôn có định vị', (await call('/admin/wholesale', { token: sales })).data.customers.find((c) => c.id === ws.id)?.map_url === relink.data.customer.map_url);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
