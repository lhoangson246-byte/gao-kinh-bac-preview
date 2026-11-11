// Khách buôn: mã cố định, bảng giá cố định, đơn nhân viên tạo theo giá buôn, không mã giảm giá,
// đăng nhập bằng mã khách buôn, đặt trên web vẫn giá web.
// Cách chạy: node test/wholesale.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture({ PROMO_TODAY: '2026-11-10' });
const { call } = app;
const login = async (identifier, password) => call('/auth/login', { method: 'POST', body: { identifier, password } });
try {
  const owner = (await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD)).data.token;
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  const phone = (p, n) => `${p}${suffix}${n}`;
  const make = async (name, price, stock = 500) => (await call('/admin/products', {
    method: 'POST', token: owner, body: { name: `${name} ${suffix}`, price, cost_price: 1000, unit: 'bao 25kg', stock },
  })).data.product;
  const st25 = await make('Gạo ST25 buôn', 450000);
  const thom = await make('Gạo thơm buôn', 380000);

  // Nhân viên bán hàng (được tạo đơn, không quản lý khách buôn) và nhân viên giao hàng
  const salesPhone = phone('05', 1);
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Em Bán Hàng', phone: salesPhone, password: 'banhang26', permissions: ['orders.view', 'orders.manage', 'orders.create'] } });
  const sales = (await login(salesPhone, 'banhang26')).data.token;
  const shipPhone = phone('03', 2);
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Anh Giao', phone: shipPhone, password: 'giaohang26', permissions: ['delivery'] } });
  const shipper = (await login(shipPhone, 'giaohang26')).data.token;

  /* Thêm khách buôn */
  const custPhone = phone('09', 3);
  const created = await call('/admin/wholesale', { method: 'POST', token: owner, body: {
    company: 'Công ty Bếp Ăn Kinh Bắc', contact_name: 'Anh Toàn', phone: custPhone, address: 'KCN Quế Võ, Bắc Ninh', password: 'khachbuon26',
  } });
  const ws = created.data.customer;
  check('Chủ cửa hàng thêm khách buôn, mã KB tự cấp', created.status === 201 && /^KB\d{4}$/.test(ws?.code || '') && ws.has_login === true, JSON.stringify(created.data));
  check('Nhân viên bán hàng không thêm khách buôn được (403)', (await call('/admin/wholesale', { method: 'POST', token: sales, body: { company: 'X', contact_name: 'Y Z', phone: phone('09', 4) } })).status === 403);
  check('Nhân viên giao hàng không xem danh sách khách buôn (403)', (await call('/admin/wholesale', { token: shipper })).status === 403);
  check('Trùng số điện thoại khách buôn bị từ chối (409)', (await call('/admin/wholesale', { method: 'POST', token: owner, body: { company: 'Trùng', contact_name: 'Chị Trùng', phone: custPhone } })).status === 409);
  check('Thiếu tên công ty bị từ chối (400)', (await call('/admin/wholesale', { method: 'POST', token: owner, body: { contact_name: 'Chị A', phone: phone('09', 5) } })).status === 400);

  /* Bảng giá cố định */
  const prices = await call(`/admin/wholesale/${ws.id}/prices`, { method: 'PUT', token: owner, body: { prices: [{ product_id: st25.id, price: 400000 }] } });
  check('Đặt giá cố định cho khách buôn', prices.status === 200 && prices.data.prices.some((p) => p.product_id === st25.id && p.price === 400000));
  check('Giá 0 bị từ chối', (await call(`/admin/wholesale/${ws.id}/prices`, { method: 'PUT', token: owner, body: { prices: [{ product_id: st25.id, price: 0 }] } })).status === 400);
  check('Nhân viên bán hàng không sửa bảng giá được (403)', (await call(`/admin/wholesale/${ws.id}/prices`, { method: 'PUT', token: sales, body: { prices: [{ product_id: st25.id, price: 1 }] } })).status === 403);
  const search = await call(`/admin/wholesale?q=${encodeURIComponent('bếp ăn')}`, { token: sales });
  check('Nhân viên bán hàng tìm được khách buôn theo tên công ty', search.status === 200 && search.data.customers.some((c) => c.id === ws.id));
  check('Tìm theo mã khách buôn', (await call(`/admin/wholesale?q=${ws.code}`, { token: sales })).data.customers.some((c) => c.id === ws.id));
  const detail = await call(`/admin/wholesale/${ws.id}`, { token: sales });
  check('Nhân viên bán hàng xem được bảng giá để tạo đơn', detail.status === 200 && detail.data.prices.length === 1 && !/password/.test(JSON.stringify(detail.data)));

  /* Đơn nhân viên tạo cho khách buôn */
  const order = (body) => call('/admin/orders', { method: 'POST', token: sales, body: {
    receiver_name: 'Anh Toàn', phone: custPhone, home_delivery: true, address: 'KCN Quế Võ, Bắc Ninh', payment_method: 'cod', ...body,
  } });
  const w1 = await order({ customer_type: 'wholesale', wholesale_customer_id: ws.id, items: [{ product_id: st25.id, quantity: 10 }, { product_id: thom.id, quantity: 2 }] });
  const lineOf = (o, id) => o?.items?.find((i) => i.product_id === id);
  check('Đơn khách buôn: loại có giá cố định tính giá cố định, loại chưa có tính giá web',
    w1.status === 201 && lineOf(w1.data.order, st25.id)?.price === 400000 && lineOf(w1.data.order, thom.id)?.price === 380000
      && w1.data.order.subtotal === 4000000 + 760000, JSON.stringify(w1.data).slice(0, 300));
  check('Đơn khách buôn không có ưu đãi đơn đầu', w1.data.order?.discount === 0 && w1.data.order.wholesale_customer_id === ws.id);
  const w2 = await order({ customer_type: 'wholesale', wholesale_customer_id: ws.id, items: [{ product_id: st25.id, quantity: 5, price: 395000 }] });
  check('Nhân viên sửa giá dòng cho khách buôn', w2.status === 201 && lineOf(w2.data.order, st25.id)?.price === 395000 && w2.data.order.total === 1975000, JSON.stringify(w2.data).slice(0, 200));
  const w3 = await order({ customer_type: 'wholesale', wholesale_customer_id: ws.id, discount_code: 'GAOKINHBAC11', items: [{ product_id: st25.id, quantity: 1 }] });
  check('Khách buôn không dùng mã giảm giá (400)', w3.status === 400 && /mã giảm giá/.test(w3.data.errors?.discount_code || ''), JSON.stringify(w3.data));
  check('Thiếu khách buôn bị từ chối (400)', (await order({ customer_type: 'wholesale', items: [{ product_id: st25.id, quantity: 1 }] })).status === 400);

  /* Khách lẻ: không sửa giá */
  const r1 = await order({ phone: phone('08', 6), items: [{ product_id: st25.id, quantity: 1, price: 1000 }] });
  check('Khách lẻ gửi giá riêng bị từ chối (400)', r1.status === 400, JSON.stringify(r1.data));
  const r2 = await order({ phone: phone('08', 7), items: [{ product_id: st25.id, quantity: 1 }] });
  check('Khách lẻ tính đúng giá web', r2.status === 201 && lineOf(r2.data.order, st25.id)?.price === 450000 && r2.data.order.wholesale_customer_id == null);

  /* Đăng nhập bằng mã khách buôn */
  const byCode = await login(ws.code.toLowerCase(), 'khachbuon26');
  check('Khách buôn đăng nhập bằng mã khách buôn', byCode.status === 200 && byCode.data.user?.role === 'customer', JSON.stringify(byCode.data).slice(0, 200));
  check('Sai mật khẩu với mã khách buôn (401)', (await login(ws.code, 'saimatkhau')).status === 401);
  check('Mã khách buôn không có thật (401)', (await login('KB9999', 'khachbuon26')).status === 401);
  const custToken = byCode.data.token;
  const mine = await call('/orders', { token: custToken });
  check('Khách buôn thấy đơn nhân viên tạo trong lịch sử đơn', (mine.data.orders || []).some((o) => o.id === w1.data.order?.id), JSON.stringify(mine.data).slice(0, 200));

  /* Khách buôn tự đặt trên web: giá web, không khuyến mãi */
  const discountInfo = (await call('/orders/discount', { token: custToken })).data;
  check('Khách buôn không có ưu đãi đơn đầu trên web', discountInfo.available === false, JSON.stringify(discountInfo).slice(0, 150));
  const ship = { receiver_name: 'Anh Toàn', phone: custPhone, address: 'Số 1 đường Lý Thái Tổ, phường Suối Hoa', delivery_area: 'bac-ninh' };
  const web = await call('/orders', { method: 'POST', token: custToken, body: { ...ship, items: [{ product_id: st25.id, quantity: 1 }] } });
  check('Khách buôn đặt trên web: giá web, không giảm', web.status === 201 && lineOf(web.data.order, st25.id)?.price === 450000 && web.data.order.discount === 0, JSON.stringify(web.data).slice(0, 250));
  const webCode = await call('/orders', { method: 'POST', token: custToken, body: { ...ship, discount_code: 'GAOKINHBAC11', items: [{ product_id: st25.id, quantity: 1 }] } });
  check('Khách buôn nhập mã trên web bị từ chối', webCode.status === 400, JSON.stringify(webCode.data).slice(0, 200));

  /* Không tích điểm */
  for (const status of ['shipping', 'completed']) await call(`/admin/orders/${w1.data.order.id}/status`, { method: 'PATCH', token: owner, body: { status } });
  const done = (await call('/admin/orders?limit=100', { token: owner })).data.orders.find((o) => o.id === w1.data.order.id);
  check('Đơn khách buôn hoàn thành không cộng điểm', done?.status === 'completed' && (done.points_earned || 0) === 0, JSON.stringify({ s: done?.status, p: done?.points_earned }));
  check('Danh sách đơn quản trị có mã và tên công ty khách buôn', done?.wholesale_code === ws.code && done.wholesale_company === 'Công ty Bếp Ăn Kinh Bắc');

  /* Ngừng khách buôn */
  await call(`/admin/wholesale/${ws.id}`, { method: 'PUT', token: owner, body: { is_active: false } });
  check('Khách buôn đã ngừng: không đăng nhập bằng mã được', (await login(ws.code, 'khachbuon26')).status === 401);
  check('Khách buôn đã ngừng: không tạo đơn giá buôn được', (await order({ customer_type: 'wholesale', wholesale_customer_id: ws.id, items: [{ product_id: st25.id, quantity: 1 }] })).status === 400);
  check('Danh sách mặc định ẩn khách đã ngừng', !(await call('/admin/wholesale', { token: sales })).data.customers.some((c) => c.id === ws.id));

  /* Số điện thoại đã có tài khoản khách: gắn vào, không đổi mật khẩu */
  const oldPhone = phone('07', 8);
  await call('/auth/register', { method: 'POST', body: { full_name: 'Chị Đã Có TK', phone: oldPhone, password: 'matkhaucu1' } });
  const linked = await call('/admin/wholesale', { method: 'POST', token: owner, body: { company: 'Nhà hàng Cũ', contact_name: 'Chị Đã Có TK', phone: oldPhone, password: 'matkhaumoi1' } });
  check('Số đã có tài khoản: gắn vào tài khoản đó', linked.status === 201 && linked.data.customer.has_login && /mật khẩu cũ/.test(linked.data.message || ''), JSON.stringify(linked.data));
  check('Không đổi mật khẩu của tài khoản khách đã có', (await login(linked.data.customer.code, 'matkhaucu1')).status === 200 && (await login(linked.data.customer.code, 'matkhaumoi1')).status === 401);
  check('Số điện thoại của nhân viên không gắn làm khách buôn được (409)', (await call('/admin/wholesale', { method: 'POST', token: owner, body: { company: 'NV', contact_name: 'Em Bán Hàng', phone: salesPhone, password: 'abcdefgh9' } })).status === 409);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
