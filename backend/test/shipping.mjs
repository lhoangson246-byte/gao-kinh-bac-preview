// Phí giao hàng: dưới 100.000đ tiền hàng thu 15.000đ, từ 100.000đ freeship, tự đến lấy không mất phí.
// Cách chạy: node test/shipping.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture();
const { call } = app;
try {
  const admin = (await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } })).data.token;
  const suffix = Date.now() % 1e7;
  const makeProduct = async (price) => (await call('/admin/products', {
    method: 'POST', token: admin, body: { name: `Gạo phí ship ${price} ${suffix}`, price, cost_price: 1000, unit: 'túi', stock: 500 },
  })).data.product;
  const p50 = await makeProduct(50000);
  const p99 = await makeProduct(99999);
  const p100 = await makeProduct(100000);

  const phone = `07${String(suffix).padStart(7, '0')}1`;
  const customer = (await call('/auth/register', { method: 'POST', body: { full_name: 'Khách Phí Ship', phone, password: 'gao2024!' } })).data.token;
  const order = (items, extra = {}) => call('/orders', {
    method: 'POST', token: customer,
    body: { receiver_name: 'Khách Phí Ship', phone, address: 'Số 3 đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh', payment_method: 'cod', items, ...extra },
  });

  /* Đơn đầu tiên giảm 20.000đ: tiền hàng 100.000đ vẫn freeship dù sau giảm còn 80.000đ */
  const first = (await order([{ product_id: p100.id, quantity: 1 }])).data.order;
  check('Tiền hàng đúng 100.000đ: freeship, giảm giá không làm mất freeship', first?.shipping_fee === 0 && first.discount === 20000 && first.total === 80000, JSON.stringify(first));

  const under = (await order([{ product_id: p50.id, quantity: 1 }])).data.order;
  check('Tiền hàng 50.000đ: phí giao 15.000đ, cộng vào tổng', under?.subtotal === 50000 && under.shipping_fee === 15000 && under.total === 65000, JSON.stringify(under));
  const edge = (await order([{ product_id: p99.id, quantity: 1 }])).data.order;
  check('Tiền hàng 99.999đ vẫn bị tính phí', edge?.shipping_fee === 15000 && edge.total === 114999, JSON.stringify(edge));
  const two = (await order([{ product_id: p50.id, quantity: 2 }])).data.order;
  check('Hai túi 50.000đ đủ 100.000đ: freeship', two?.shipping_fee === 0 && two.total === 100000, JSON.stringify(two));

  const forged = await order([{ product_id: p50.id, quantity: 1 }], { shipping_fee: 0 });
  check('Trình duyệt không tự gửi được phí giao', forged.status === 400, String(forged.status));

  /* Mua nhanh không tài khoản */
  const guestPhone = `06${String(suffix).padStart(7, '0')}2`;
  const guestBody = { receiver_name: 'Cô Mua Nhanh', phone: guestPhone, address: 'Số 9 đường Lý Thái Tổ, phường Suối Hoa', delivery_area: 'bac-ninh', payment_method: 'cod', items: [{ product_id: p50.id, quantity: 1 }] };
  const g1 = (await call('/orders/guest', { method: 'POST', body: guestBody })).data.order;
  check('Mua nhanh đơn đầu: giảm 20.000đ và vẫn tính phí giao', g1?.discount === 20000 && g1.shipping_fee === 15000 && g1.total === 45000, JSON.stringify(g1));

  /* Tra cứu đơn và màn quản trị thấy phí */
  const track = await call('/orders/track', { method: 'POST', body: { phone: guestPhone, code: g1.code } });
  const tracked = track.data.orders?.[0] ?? track.data.order;
  check('Tra cứu đơn thấy phí giao', tracked?.shipping_fee === 15000, JSON.stringify(track.data).slice(0, 200));
  const list = await call('/admin/orders?limit=50', { token: admin });
  check('Quản trị thấy phí giao', list.data.orders?.find((o) => o.id === under.id)?.shipping_fee === 15000);

  /* Phí giao không tích điểm */
  for (const status of ['confirmed', 'shipping', 'completed']) {
    await call(`/admin/orders/${under.id}/status`, { method: 'PATCH', token: admin, body: { status } });
  }
  const done = (await call('/admin/orders?limit=50', { token: admin })).data.orders.find((o) => o.id === under.id);
  check('Hoàn thành: điểm tính trên tiền hàng, không tính phí giao', done?.status === 'completed' && done.points_earned === 50, JSON.stringify({ s: done?.status, p: done?.points_earned }));

  /* Đơn nhân viên nhập tay */
  const manual = (home) => call('/admin/orders', {
    method: 'POST', token: admin,
    body: { receiver_name: 'Anh Gọi Điện', phone: `05${String(suffix).padStart(7, '0')}${home ? 3 : 4}`, home_delivery: home, address: home ? 'Số 5 đường Trần Hưng Đạo, phường Đại Phúc' : null, payment_method: 'cod', items: [{ product_id: p50.id, quantity: 1 }] },
  });
  const delivered = await manual(true);
  check('Nhân viên nhập đơn giao tận nơi dưới 100.000đ: có phí', delivered.data.order?.shipping_fee === 15000, JSON.stringify(delivered.data).slice(0, 220));
  const pickup = await manual(false);
  check('Khách lấy tại cửa hàng: không mất phí', pickup.data.order?.shipping_fee === 0, JSON.stringify(pickup.data).slice(0, 220));

  /* Huỷ đơn: hoàn kho như thường */
  const stockBefore = (await call('/admin/products', { token: admin })).data.products.find((p) => p.id === p99.id)?.stock;
  await call(`/admin/orders/${edge.id}/status`, { method: 'PATCH', token: admin, body: { status: 'cancelled' } });
  const stockAfter = (await call('/admin/products', { token: admin })).data.products.find((p) => p.id === p99.id)?.stock;
  check('Huỷ đơn có phí giao vẫn hoàn kho một lần', stockAfter === stockBefore + 1, `${stockBefore} -> ${stockAfter}`);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
