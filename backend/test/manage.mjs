// Kiểm thử quản lý tài khoản khách, nhập kho và giá nhập.
// Cách chạy:  npm run test:manage   (API phải đang chạy)
const BASE = process.env.BASE || 'http://localhost:4000';

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name} ${detail}`); }
};

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const suffix = Date.now();
const phoneOf = (n) => `09${String(suffix).slice(-7)}${n}`;

/* ---------- Đăng nhập quản trị ---------- */
const login = await call('/auth/login', {
  method: 'POST',
  body: {
    identifier: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
});
if (login.status === 429) {
  console.error('Đã chạm giới hạn tần suất đăng nhập. Khởi động lại API rồi chạy lại.');
  process.exit(2);
}
check('Đăng nhập quản trị', login.status === 200 && login.data.user?.role === 'admin');
const admin = login.data.token;

/* ================================================================== *
 * 1. Quản lý tài khoản khách hàng
 * ================================================================== */

const cust = { full_name: 'Khách Quản Lý', phone: phoneOf(1), password: 'matkhau123!test' };
const reg = await call('/auth/register', { method: 'POST', body: cust });
check('Tạo tài khoản khách để thử', reg.status === 201, JSON.stringify(reg.data));
const custId = reg.data.user?.id;
let custToken = reg.data.token;

/* --- Phân quyền --- */
{
  check('Khách vãng lai không xem được danh sách khách (401)',
    (await call('/admin/customers')).status === 401);
  check('Khách thường không xem được danh sách khách (403)',
    (await call('/admin/customers', { token: custToken })).status === 403);
}

/* --- Danh sách và tìm kiếm --- */
{
  const list = await call('/admin/customers', { token: admin });
  check('Xem được danh sách khách', list.status === 200 && list.data.customers.length > 0);
  check('Danh sách KHÔNG chứa password_hash', !JSON.stringify(list.data).includes('password_hash'));
  check('Danh sách chỉ gồm khách, không có admin',
    list.data.customers.every((c) => c.role === 'customer'));
  check('Có số đơn đã đặt', list.data.customers.every((c) => typeof c.order_count === 'number'));

  const byPhone = await call(`/admin/customers?q=${cust.phone}`, { token: admin });
  check('Tìm khách theo số điện thoại', byPhone.data.customers.some((c) => c.id === custId));

  const byName = await call(`/admin/customers?q=${encodeURIComponent('Quản Lý')}`, { token: admin });
  check('Tìm khách theo tên', byName.data.customers.some((c) => c.id === custId));

  const page = await call('/admin/customers?limit=1', { token: admin });
  check('Phân trang danh sách khách', page.data.customers.length === 1 && page.data.total >= 1);
}

/* --- Chi tiết --- */
{
  const detail = await call(`/admin/customers/${custId}`, { token: admin });
  check('Xem chi tiết một khách', detail.status === 200 && detail.data.customer.id === custId);
  check('Chi tiết kèm đơn và sổ địa chỉ',
    Array.isArray(detail.data.orders) && Array.isArray(detail.data.addresses));

  const admins = await call('/admin/customers', { token: admin });
  const adminId = login.data.user.id;
  check('Không thao tác được trên tài khoản quản trị (403)',
    (await call(`/admin/customers/${adminId}`, { token: admin })).status === 403);
  check('Id không tồn tại trả 404',
    (await call('/admin/customers/999999', { token: admin })).status === 404);
}

/* --- Đặt lại mật khẩu --- */
{
  const short = await call(`/admin/customers/${custId}/reset-password`, {
    method: 'POST', token: admin, body: { password: '123' },
  });
  check('Mật khẩu mới quá ngắn bị từ chối (400)', short.status === 400);

  const reset = await call(`/admin/customers/${custId}/reset-password`, {
    method: 'POST', token: admin, body: { password: 'matkhaumoi999' },
  });
  check('Đặt lại mật khẩu thành công', reset.status === 200 && reset.data.ok === true);
  check('Phản hồi không chứa password_hash', !JSON.stringify(reset.data).includes('password_hash'));

  const oldPw = await call('/auth/login', {
    method: 'POST', body: { identifier: cust.phone, password: cust.password },
  });
  check('Mật khẩu cũ không dùng được nữa (401)', oldPw.status === 401);

  const newPw = await call('/auth/login', {
    method: 'POST', body: { identifier: cust.phone, password: 'matkhaumoi999' },
  });
  check('Đăng nhập được bằng mật khẩu mới', newPw.status === 200 && !!newPw.data.token);
  custToken = newPw.data.token;
}

/* --- Khoá và mở khoá --- */
{
  const lock = await call(`/admin/customers/${custId}/lock`, {
    method: 'PATCH', token: admin, body: { is_locked: true },
  });
  check('Khoá tài khoản thành công', lock.status === 200 && lock.data.customer.is_locked === 1);

  const loginLocked = await call('/auth/login', {
    method: 'POST', body: { identifier: cust.phone, password: 'matkhaumoi999' },
  });
  check('Tài khoản bị khoá không đăng nhập được (403)', loginLocked.status === 403,
    `status=${loginLocked.status}`);

  const useOldToken = await call('/auth/me', { token: custToken });
  check('Token cũ của tài khoản bị khoá hết hiệu lực (403)', useOldToken.status === 403,
    `status=${useOldToken.status}`);

  const orderLocked = await call('/orders', {
    method: 'POST', token: custToken,
    body: { items: [{ product_id: 1, quantity: 1 }], delivery_area: 'bac-ninh' },
  });
  check('Tài khoản bị khoá không đặt hàng được', orderLocked.status === 403);

  const unlock = await call(`/admin/customers/${custId}/lock`, {
    method: 'PATCH', token: admin, body: { is_locked: false },
  });
  check('Mở khoá tài khoản thành công', unlock.status === 200 && unlock.data.customer.is_locked === 0);
  check('Mở khoá xong đăng nhập lại được',
    (await call('/auth/login', { method: 'POST', body: { identifier: cust.phone, password: 'matkhaumoi999' } })).status === 200);

  const self = await call(`/admin/customers/${login.data.user.id}/lock`, {
    method: 'PATCH', token: admin, body: { is_locked: true },
  });
  check('Không tự khoá được tài khoản của mình (400)', self.status === 400, `status=${self.status}`);
}

/* --- Lọc theo trạng thái khoá --- */
{
  await call(`/admin/customers/${custId}/lock`, { method: 'PATCH', token: admin, body: { is_locked: true } });
  const locked = await call('/admin/customers?locked=1', { token: admin });
  check('Lọc được khách đang bị khoá', locked.data.customers.every((c) => c.is_locked === 1)
    && locked.data.customers.some((c) => c.id === custId));
  await call(`/admin/customers/${custId}/lock`, { method: 'PATCH', token: admin, body: { is_locked: false } });
}

/* --- Sửa tên khách --- */
custToken = (await call('/auth/login', {
  method: 'POST', body: { identifier: cust.phone, password: 'matkhaumoi999' },
})).data.token;
{
  const r = await call(`/admin/customers/${custId}`, {
    method: 'PUT', token: admin, body: { full_name: 'Khách Đã Sửa Tên' },
  });
  check('Sửa được tên khách', r.status === 200 && r.data.customer.full_name === 'Khách Đã Sửa Tên');
  check('Tên rỗng bị từ chối (400)',
    (await call(`/admin/customers/${custId}`, { method: 'PUT', token: admin, body: { full_name: '' } })).status === 400);
}

/* ================================================================== *
 * 2. Nhập kho và giá nhập
 * ================================================================== */

const created = await call('/admin/products', {
  method: 'POST', token: admin,
  body: { name: `Gạo nhập kho ${suffix}`, price: 200000, cost_price: 150000, unit: 'bao 10kg', stock: 10 },
});
check('Thêm sản phẩm kèm giá nhập (201)', created.status === 201, JSON.stringify(created.data));
check('Giá nhập được lưu', created.data.product?.cost_price === 150000, String(created.data.product?.cost_price));
const pid = created.data.product?.id;

/* --- Nhập thêm hàng --- */
{
  const before = created.data.product.stock;
  const r = await call(`/admin/products/${pid}/stock`, {
    method: 'POST', token: admin, body: { quantity: 20, note: 'Lấy từ kho Hưng Yên' },
  });
  check('Nhập kho thành công (201)', r.status === 201, JSON.stringify(r.data));
  check('Tồn kho được CỘNG THÊM, không ghi đè', r.data.product.stock === before + 20,
    `${before} + 20 -> ${r.data.product?.stock}`);
  check('Lịch sử ghi lại lần nhập', r.data.entries[0]?.quantity === 20);
  check('Lịch sử lưu tồn kho sau khi nhập', r.data.entries[0]?.stock_after === before + 20);
  check('Lịch sử lưu ghi chú', r.data.entries[0]?.note === 'Lấy từ kho Hưng Yên');

  const again = await call(`/admin/products/${pid}/stock`, {
    method: 'POST', token: admin, body: { quantity: 5 },
  });
  check('Nhập lần hai cộng dồn tiếp', again.data.product.stock === before + 25,
    String(again.data.product?.stock));
  check('Lịch sử có 2 lần nhập', again.data.entries.length === 2);
}

/* --- Nhập kho kèm giá nhập mới --- */
{
  const r = await call(`/admin/products/${pid}/stock`, {
    method: 'POST', token: admin, body: { quantity: 3, cost_price: 160000, note: 'Giá lên' },
  });
  check('Nhập kho cập nhật luôn giá nhập', r.data.product.cost_price === 160000,
    String(r.data.product?.cost_price));
  check('Lịch sử lưu giá nhập của lần đó', r.data.entries[0]?.cost_price === 160000);
}

/* --- Kiểm tra dữ liệu --- */
{
  check('Số lượng nhập 0 bị từ chối (400)',
    (await call(`/admin/products/${pid}/stock`, { method: 'POST', token: admin, body: { quantity: 0 } })).status === 400);
  check('Số lượng nhập âm bị từ chối (400)',
    (await call(`/admin/products/${pid}/stock`, { method: 'POST', token: admin, body: { quantity: -5 } })).status === 400);
  check('Số lượng không phải số bị từ chối (400)',
    (await call(`/admin/products/${pid}/stock`, { method: 'POST', token: admin, body: { quantity: 'abc' } })).status === 400);
  check('Giá nhập âm bị từ chối (400)',
    (await call(`/admin/products/${pid}/stock`, { method: 'POST', token: admin, body: { quantity: 1, cost_price: -1 } })).status === 400);
  check('Nhập kho cho sản phẩm không tồn tại trả 404',
    (await call('/admin/products/999999/stock', { method: 'POST', token: admin, body: { quantity: 1 } })).status === 404);
  check('Khách thường không nhập kho được (403)',
    (await call(`/admin/products/${pid}/stock`, { method: 'POST', token: custToken, body: { quantity: 1 } })).status === 403);
  check('Giá nhập âm khi sửa sản phẩm bị từ chối (400)',
    (await call(`/admin/products/${pid}`, { method: 'PUT', token: admin, body: { cost_price: -100 } })).status === 400);
}

/* --- Lịch sử nhập kho --- */
{
  const one = await call(`/admin/products/${pid}/stock`, { token: admin });
  check('Xem được lịch sử nhập của một loại gạo', one.status === 200 && one.data.entries.length >= 3);
  check('Lịch sử xếp mới nhất trước', one.data.entries[0].id > one.data.entries[1].id);

  const all = await call('/admin/stock-entries?limit=5', { token: admin });
  check('Xem được các lần nhập kho gần đây', all.status === 200 && all.data.entries.length > 0);
  check('Lịch sử chung kèm tên sản phẩm', !!all.data.entries[0].product_name);
}

/* --- Giá trị tồn kho và lãi --- */
{
  const stats = await call('/admin/stats', { token: admin });
  check('Thống kê có giá trị tồn kho', typeof stats.data.stats.inventoryValue === 'number'
    && stats.data.stats.inventoryValue > 0, String(stats.data.stats.inventoryValue));
  check('Thống kê đếm loại chưa khai giá nhập', typeof stats.data.stats.missingCost === 'number');

  // Bán 2 bao tại quầy để kiểm tra lãi: (200.000 − 160.000) × 2 = 80.000
  const inv = await call('/retail/invoices', {
    method: 'POST', token: admin, body: { items: [{ product_id: pid, quantity: 2 }] },
  });
  check('Bán được sản phẩm vừa nhập', inv.status === 201, JSON.stringify(inv.data));

  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const rev = await call(`/admin/revenue?period=day&date=${today}`, { token: admin });
  check('Báo cáo có phần lãi', !!rev.data.profit && typeof rev.data.profit.gross === 'number',
    JSON.stringify(rev.data.profit));
  check('Lãi = doanh thu − giá vốn',
    rev.data.profit.gross === rev.data.total.revenue - rev.data.profit.cost);
  check('Giá vốn lớn hơn 0 sau khi bán hàng có giá nhập', rev.data.profit.cost > 0,
    String(rev.data.profit?.cost));

  // Đổi giá nhập rồi kiểm tra hoá đơn cũ không đổi lãi.
  const costBefore = rev.data.profit.cost;
  await call(`/admin/products/${pid}`, { method: 'PUT', token: admin, body: { cost_price: 999 } });
  const rev2 = await call(`/admin/revenue?period=day&date=${today}`, { token: admin });
  check('Đổi giá nhập KHÔNG làm sai lãi của đơn cũ', rev2.data.profit.cost === costBefore,
    `${costBefore} -> ${rev2.data.profit?.cost}`);
}

/* ================================================================== *
 * 3. Nhật ký thay đổi và đăng nhập
 * ================================================================== */
{
  const activity = await call('/admin/activity?limit=100', { token: admin });
  check('Quản trị viên xem được nhật ký hệ thống', activity.status === 200);
  check('Lịch sử lưu lần đăng nhập thành công',
    activity.data.logins?.some((row) => row.user_id === login.data.user.id));
  check('Nhật ký lưu thay đổi của quản trị viên',
    activity.data.audit?.some((row) => row.entity_type === 'product' && row.entity_id === String(pid)));
  check('Nhật ký không chứa mật khẩu hoặc token',
    !/password_hash|matkhaumoi999|authorization|"token"/.test(JSON.stringify(activity.data)));
  check('Khách thường không xem được nhật ký (403)',
    (await call('/admin/activity', { token: custToken })).status === 403);
}

/* ================================================================== *
 * 3. Một số điện thoại — một hồ sơ điểm cho cả quầy lẫn online
 * ================================================================== */

/* --- Tạo tài khoản đặt hàng online ngay tại quầy --- */
const posPhone = phoneOf(8);
{
  const before = await call(`/retail/customers?phone=${posPhone}`, { token: admin });
  check('Số chưa có tài khoản thì báo account = null', before.data.account === null,
    JSON.stringify(before.data.account));

  const bad = await call('/retail/customers/account', {
    method: 'POST', token: admin, body: { phone: '123', full_name: 'A B', password: 'matkhau123!test' },
  });
  check('SĐT sai định dạng bị từ chối (400)', bad.status === 400);

  const shortPw = await call('/retail/customers/account', {
    method: 'POST', token: admin, body: { phone: posPhone, full_name: 'Cô Tám', password: '123' },
  });
  check('Mật khẩu ngắn bị từ chối (400)', shortPw.status === 400);

  const created = await call('/retail/customers/account', {
    method: 'POST', token: admin,
    body: { phone: posPhone, full_name: 'Cô Tám', password: 'matkhau123!test' },
  });
  check('Tạo được tài khoản online tại quầy (201)', created.status === 201, JSON.stringify(created.data));
  check('Phản hồi không chứa password_hash', !JSON.stringify(created.data).includes('password_hash'));
  check('Tạo tài khoản kèm luôn hồ sơ tích điểm', created.data.customer?.phone === posPhone);

  const dup = await call('/retail/customers/account', {
    method: 'POST', token: admin,
    body: { phone: posPhone, full_name: 'Cô Tám', password: 'matkhau123!test' },
  });
  check('Tạo trùng số bị từ chối (409)', dup.status === 409, `status=${dup.status}`);

  const login = await call('/auth/login', {
    method: 'POST', body: { identifier: posPhone, password: 'matkhau123!test' },
  });
  check('Khách đăng nhập được bằng tài khoản quầy tạo', login.status === 200 && !!login.data.token);

  const after = await call(`/retail/customers?phone=${posPhone}`, { token: admin });
  check('Tra cứu tại quầy thấy tài khoản online', after.data.account?.phone === posPhone);
  check('Tra cứu kèm số đơn online', typeof after.data.onlineOrders === 'number');
}

/* --- Đơn online được giảm giá theo mốc --- */
{
  const login = await call('/auth/login', {
    method: 'POST', body: { identifier: posPhone, password: 'matkhau123!test' },
  });
  const token = login.data.token;

  const prods = (await call('/products')).data.products.filter((p) => p.price > 0 && p.stock > 5);
  const item = prods.find((p) => p.price >= 145000);
  check('Có sản phẩm để đặt online', !!item);

  const order = {
    receiver_name: 'Cô Tám', phone: posPhone,
    address: 'Số 9, đường Ngô Gia Tự, phường Tiền An',
    delivery_area: 'bac-ninh', payment_method: 'cod',
  };

  /* Dưới 300k: không giảm */
  const small = await call('/orders', {
    method: 'POST', token, body: { ...order, items: [{ product_id: item.id, quantity: 1 }] },
  });
  check('Đơn online dưới 300k không được giảm',
    small.data.order?.discount === 0 && small.data.order?.total === small.data.order?.subtotal,
    JSON.stringify({ s: small.data.order?.subtotal, d: small.data.order?.discount }));

  /* Từ 300k: giảm 10k */
  const mid = await call('/orders', {
    method: 'POST', token, body: { ...order, items: [{ product_id: item.id, quantity: 3 }] },
  });
  const midOrder = mid.data.order;
  check('Đơn online từ 300k được giảm 10.000₫',
    midOrder?.discount === 10000 && midOrder?.total === midOrder.subtotal - 10000,
    JSON.stringify({ s: midOrder?.subtotal, d: midOrder?.discount, t: midOrder?.total }));

  /* Từ 500k: giảm 20k */
  const big = await call('/orders', {
    method: 'POST', token, body: { ...order, items: [{ product_id: item.id, quantity: 4 }] },
  });
  check('Đơn online từ 500k được giảm 20.000₫', big.data.order?.discount === 20000,
    String(big.data.order?.discount));

  /* --- Điểm chỉ cộng khi đơn HOÀN THÀNH --- */
  const pointsBefore = (await call(`/retail/customers?phone=${posPhone}`, { token: admin }))
    .data.customer?.points ?? 0;
  check('Đơn mới đặt chưa cộng điểm', midOrder?.points_earned === 0, String(midOrder?.points_earned));

  const id = midOrder.id;
  await call(`/admin/orders/${id}/status`, { method: 'PATCH', token: admin, body: { status: 'confirmed' } });
  await call(`/admin/orders/${id}/status`, { method: 'PATCH', token: admin, body: { status: 'shipping' } });

  const midway = (await call(`/retail/customers?phone=${posPhone}`, { token: admin })).data.customer?.points ?? 0;
  check('Đơn đang giao vẫn chưa cộng điểm', midway === pointsBefore, `${pointsBefore} -> ${midway}`);

  const done = await call(`/admin/orders/${id}/status`, {
    method: 'PATCH', token: admin, body: { status: 'completed' },
  });
  check('Đơn hoàn thành ghi lại số điểm đã cộng', done.data.order?.points_earned > 0,
    String(done.data.order?.points_earned));

  const afterPoints = (await call(`/retail/customers?phone=${posPhone}`, { token: admin })).data.customer.points;
  const expected = pointsBefore + Math.floor(midOrder.total / 1000);
  check('Điểm đơn online cộng vào ĐÚNG hồ sơ SĐT', afterPoints === expected,
    `${afterPoints} vs ${expected}`);

  /* --- Điểm quầy và điểm online dồn chung một hồ sơ --- */
  const inv = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: posPhone, items: [{ product_id: item.id, quantity: 1 }] },
  });
  check('Mua tại quầy cộng tiếp vào cùng hồ sơ',
    inv.data.customer?.points === afterPoints + Math.floor(inv.data.invoice.total / 1000),
    `${inv.data.customer?.points}`);
}

/* --- Đơn huỷ không cộng điểm --- */
{
  const login = await call('/auth/login', {
    method: 'POST', body: { identifier: posPhone, password: 'matkhau123!test' },
  });
  const prods = (await call('/products')).data.products.filter((p) => p.price > 0 && p.stock > 2);
  const before = (await call(`/retail/customers?phone=${posPhone}`, { token: admin })).data.customer.points;

  const made = await call('/orders', {
    method: 'POST', token: login.data.token,
    body: {
      receiver_name: 'Cô Tám', phone: posPhone,
      address: 'Số 9, đường Ngô Gia Tự, phường Tiền An',
      delivery_area: 'bac-ninh', items: [{ product_id: prods[0].id, quantity: 1 }],
    },
  });
  await call(`/orders/${made.data.order.id}/cancel`, { method: 'PATCH', token: login.data.token });
  const after = (await call(`/retail/customers?phone=${posPhone}`, { token: admin })).data.customer.points;
  check('Đơn bị huỷ không cộng điểm', after === before, `${before} -> ${after}`);
}

console.log(results.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
