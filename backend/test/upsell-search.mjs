// Mua kèm (upsale) ở giỏ hàng và ô tìm khách của nhân viên giao hàng (13/11/2026).
// Cách chạy: node test/upsell-search.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const short = (value) => JSON.stringify(value).slice(0, 300);

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  const phone = (p, n) => `${p}${suffix}${n}`;
  const staff = async (name, n, permissions) => {
    const p = phone('03', n);
    await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: p, password: 'nhanvien26', permissions } });
    return login(p, 'nhanvien26');
  };
  const make = async (name, unit, price, stock = 50) => (await call('/admin/products', {
    method: 'POST', token: owner, body: { name: `${name} ${suffix}`, price, cost_price: 1000, unit, stock },
  })).data.product;

  /* ---------- Mua kèm ---------- */
  const egg = await make('Trứng gà Dabaco 30 quả', 'khay', 92000);
  const mien = await make('Miến dong', 'gói', 52000);
  const hidden = await make('Hàng ẩn', 'gói', 10000);
  await call(`/admin/products/${hidden.id}`, { method: 'DELETE', token: owner });

  const set = (ids, token = owner) => call('/admin/upsell', { method: 'PUT', token, body: { ids } });
  const saved = await set([egg.id, mien.id, hidden.id]);
  const rank = (list, id) => list.find((p) => p.id === id)?.upsell_rank;
  check('Đặt danh sách mua kèm theo thứ tự', saved.status === 200 && rank(saved.data.products, egg.id) === 1 && rank(saved.data.products, mien.id) === 2, short(saved.data).slice(0, 200));
  const pub = (await call('/products')).data.products;
  check('Khách thấy sản phẩm mua kèm (upsell_rank) trong danh sách sản phẩm', rank(pub, egg.id) === 1 && rank(pub, mien.id) === 2);
  check('Sản phẩm đang ẩn không lộ ra trang khách dù nằm trong danh sách mua kèm', !pub.some((p) => p.id === hidden.id));
  check('Khách không thấy giá nhập', pub.every((p) => !('cost_price' in p)));
  const reorder = await set([mien.id, egg.id]);
  check('Đổi thứ tự, bỏ một sản phẩm khỏi mua kèm', rank(reorder.data.products, mien.id) === 1 && rank(reorder.data.products, egg.id) === 2 && rank(reorder.data.products, hidden.id) == null);
  check('Mã trùng trong danh sách bị từ chối (400)', (await set([egg.id, egg.id])).status === 400);
  check('Sản phẩm không tồn tại: từ chối, giữ nguyên danh sách cũ', (await set([egg.id, 99999999])).status === 400
    && rank((await call('/products')).data.products, mien.id) === 1);
  const sales = await staff('Em Bán Hàng', 1, ['orders.view', 'orders.create']);
  check('Nhân viên không có quyền sửa sản phẩm không đổi được mua kèm (403)', (await set([], sales)).status === 403);
  check('Chưa đăng nhập không đổi được mua kèm (401)', (await call('/admin/upsell', { method: 'PUT', body: { ids: [] } })).status === 401);
  const cleared = await set([]);
  check('Danh sách rỗng = tắt mua kèm', cleared.status === 200 && cleared.data.products.every((p) => p.upsell_rank == null));
  await set([egg.id]);
  // Đơn có trứng gà thêm từ giỏ: giá vẫn do máy chủ tính.
  const bought = await call('/orders/guest', { method: 'POST', body: {
    receiver_name: 'Chị Mua Kèm', phone: phone('09', 9), address: 'Số 3 đường Kinh Dương Vương, phường Vũ Ninh', delivery_area: 'bac-ninh',
    payment_method: 'cod', items: [{ product_id: mien.id, quantity: 1 }, { product_id: egg.id, quantity: 1 }],
  } });
  check('Đặt đơn có trứng gà mua kèm: giá do máy chủ tính (92.000đ)', bought.status === 201 && bought.data.order.items.some((i) => i.product_id === egg.id && i.price === 92000), short(bought.data));

  /* ---------- Tìm khách cho nhân viên giao hàng ---------- */
  const shipper = await staff('Anh Giao', 2, ['delivery']);
  const ws = (await call('/admin/wholesale', { method: 'POST', token: owner, body: {
    company: `Bếp ăn Trường Tiểu học Đáp Cầu ${suffix}`, contact_name: 'Cô Hằng', phone: phone('08', 3),
    address: 'Số 5 đường Quang Khải, phường Vệ An', map_url: 'https://maps.app.goo.gl/BepAnDapCau',
  } })).data.customer;
  const order = (body) => call('/admin/orders', { method: 'POST', token: owner, body: {
    receiver_name: 'Chị Lý Thị Hoa', phone: phone('09', 4), home_delivery: true, address: 'Số 12 ngõ 3 đường Lý Thái Tổ, phường Suối Hoa',
    payment_method: 'cod', items: [{ product_id: mien.id, quantity: 1 }], ...body,
  } });
  await order({ map_url: '21.1861,106.0763' });
  await order({});                                                   // cùng khách, cùng địa chỉ: gộp một dòng
  await order({ receiver_name: 'Anh Tuấn', phone: phone('07', 5), address: 'Thôn Đông, xã Hoà Long' });
  await order({ receiver_name: 'Khách Lấy Tại Quầy', phone: phone('07', 6), home_delivery: false, address: null });
  const cancelled = (await order({ receiver_name: 'Khách Đã Huỷ', phone: phone('07', 7), address: 'Số 9 đường Huỷ Bỏ' })).data.order;
  await call(`/admin/orders/${cancelled.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });

  const search = (q, token = shipper) => call(`/delivery/search?q=${encodeURIComponent(q)}`, { token });
  let r = await search('ly thai to');
  const hoa = r.data.results?.filter((x) => x.phone === phone('09', 4));
  check('Gõ không dấu "ly thai to" ra địa chỉ có dấu, kèm định vị', r.status === 200 && hoa.length === 1 && /Lý Thái Tổ/.test(hoa[0].address)
    && /query=21\.1861,106\.0763/.test(hoa[0].map_url || '') && hoa[0].order_count === 2, short(r.data));
  r = await search(phone('09', 4).slice(0, 4) + ' ' + phone('09', 4).slice(4));
  check('Tìm theo số điện thoại (gõ có dấu cách)', r.data.results?.[0]?.phone === phone('09', 4), short(r.data));
  r = await search(ws.code);
  check('Tìm theo mã khách buôn: ra công ty, định vị đã lưu', r.data.results?.[0]?.kind === 'wholesale' && r.data.results[0].company === ws.company
    && r.data.results[0].map_url === 'https://maps.app.goo.gl/BepAnDapCau', short(r.data));
  r = await search('dap cau');
  check('Tìm theo tên công ty không dấu', r.data.results?.some((x) => x.code === ws.code));
  r = await search('Hoà Long');
  check('Khách không có đơn giao cho mình vẫn tìm được (không định vị thì map_url rỗng)', r.data.results?.some((x) => x.name === 'Anh Tuấn' && x.map_url == null));
  check('Không ra đơn khách tự lấy tại cửa hàng', !(await search('Khách Lấy Tại Quầy')).data.results.length);
  check('Không ra địa chỉ của đơn đã huỷ', !(await search('Huỷ Bỏ')).data.results.length);
  check('Gõ dưới 2 ký tự: không trả gì', (await search('a')).data.results.length === 0);
  check('Kết quả không lộ ghi chú, mật khẩu, mã nội bộ', (await search('ly thai to')).data.results.every((x) => Object.keys(x).every((k) => ['kind', 'code', 'company', 'name', 'phone', 'address', 'map_url', 'order_count', 'last_order_at'].includes(k))));
  check('Chủ cửa hàng cũng tìm được', (await search('ly thai to', owner)).status === 200);
  check('Nhân viên bán hàng (không có quyền giao hàng) không tìm được (403)', (await search('ly thai to', sales)).status === 403);
  check('Chưa đăng nhập không tìm được (401)', (await call('/delivery/search?q=ly%20thai')).status === 401);
  check('Thiếu ô tìm kiếm: 400', (await call('/delivery/search', { token: shipper })).status === 400);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
