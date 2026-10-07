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

/* --- Đơn online: ưu đãi 20.000đ cho đơn ĐẦU TIÊN của mỗi tài khoản --- */
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

  /* Đơn ĐẦU TIÊN của tài khoản: giảm 20.000đ */
  const first = await call('/orders', {
    method: 'POST', token, body: { ...order, items: [{ product_id: item.id, quantity: 1 }] },
  });
  const firstOrder = first.data.order;
  check('Đơn online đầu tiên được giảm 20.000₫',
    firstOrder?.discount === 20000 && firstOrder?.total === firstOrder.subtotal - 20000,
    JSON.stringify({ s: firstOrder?.subtotal, d: firstOrder?.discount, t: firstOrder?.total }));

  /* Đơn thứ hai: không còn được giảm */
  const mid = await call('/orders', {
    method: 'POST', token, body: { ...order, items: [{ product_id: item.id, quantity: 3 }] },
  });
  const midOrder = mid.data.order;
  check('Đơn online thứ hai không còn được giảm',
    midOrder?.discount === 0 && midOrder?.total === midOrder.subtotal,
    JSON.stringify({ s: midOrder?.subtotal, d: midOrder?.discount, t: midOrder?.total }));

  /* Mua nhiều cũng không được giảm nữa — ưu đãi chỉ dành cho đơn đầu */
  const big = await call('/orders', {
    method: 'POST', token, body: { ...order, items: [{ product_id: item.id, quantity: 4 }] },
  });
  check('Đơn online lớn về sau vẫn không được giảm', big.data.order?.discount === 0,
    String(big.data.order?.discount));

  /* Tài khoản khác vẫn được ưu đãi đơn đầu của mình */
  {
    const otherPhone = phoneOf(2);
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { full_name: 'Khách Mới Toanh', phone: otherPhone, password: 'matkhau123!test' },
    });
    const other = await call('/orders', {
      method: 'POST', token: reg.data.token,
      body: { ...order, phone: otherPhone, items: [{ product_id: item.id, quantity: 1 }] },
    });
    check('Tài khoản khác vẫn được giảm cho đơn đầu của mình',
      other.data.order?.discount === 20000,
      `reg=${reg.status} order=${other.status} ${JSON.stringify(other.data).slice(0, 200)}`);

    /* Huỷ đơn đầu thì ưu đãi vẫn còn cho lần đặt sau */
    await call(`/orders/${other.data.order.id}/cancel`, { method: 'PATCH', token: reg.data.token });
    const retry = await call('/orders', {
      method: 'POST', token: reg.data.token,
      body: { ...order, phone: otherPhone, items: [{ product_id: item.id, quantity: 1 }] },
    });
    check('Huỷ đơn đầu rồi đặt lại vẫn được giảm',
      retry.data.order?.discount === 20000, String(retry.data.order?.discount));

    /* API xem trước ưu đãi khớp với thực tế */
    const preview = await call('/orders/discount', { token: reg.data.token });
    check('API xem trước báo đã hết ưu đãi sau khi đã có đơn',
      preview.status === 200 && preview.data.available === false, JSON.stringify(preview.data));
  }

  /* Tiền giảm không bao giờ vượt quá tiền hàng */
  {
    const cheapPhone = phoneOf(3);
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { full_name: 'Khách Mua Ít', phone: cheapPhone, password: 'matkhau123!test' },
    });
    const before = await call('/orders/discount', { token: reg.data.token });
    check('API xem trước báo còn ưu đãi cho tài khoản mới',
      before.data.available === true && before.data.amount === 20000, JSON.stringify(before.data));

    const cheap = (await call('/products')).data.products
      .filter((p) => p.price > 0 && p.price < 20000 && p.stock > 0)
      .sort((a, b) => a.price - b.price)[0];
    if (cheap) {
      const tiny = await call('/orders', {
        method: 'POST', token: reg.data.token,
        body: { ...order, phone: cheapPhone, items: [{ product_id: cheap.id, quantity: 1 }] },
      });
      check('Đơn rẻ hơn 20.000₫ thì chỉ giảm bằng đúng tiền hàng',
        tiny.data.order?.discount === cheap.price && tiny.data.order?.total === 0,
        JSON.stringify({ p: cheap.price, d: tiny.data.order?.discount, t: tiny.data.order?.total }));
    } else {
      check('Đơn rẻ hơn 20.000₫ thì chỉ giảm bằng đúng tiền hàng', true, 'không có loại gạo dưới 20.000₫');
    }
  }

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

/* --- Tải ảnh sản phẩm lên --- */
{
  const { readFileSync } = await import('node:fs');
  const jpg = readFileSync(new URL('../../frontend/public/products/lvs-gao-sach-st25-5kg.jpg', import.meta.url));

  const send = (body, tok, type = 'image/jpeg') => fetch(`${BASE}/api/admin/images`, {
    method: 'POST',
    headers: { 'Content-Type': type, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body,
  });

  const up = await send(jpg, admin);
  const upBody = await up.json().catch(() => ({}));
  check('Quản trị tải được ảnh lên', up.status === 201 || up.status === 200, `status=${up.status}`);
  check('Trả về đường dẫn /api/images/…',
    /^\/api\/images\/[0-9a-f]{32}\.jpg$/.test(upBody.url || ''), JSON.stringify(upBody));

  const got = await fetch(`${BASE}${upBody.url}`);
  const bytes = Buffer.from(await got.arrayBuffer());
  check('Xem lại ảnh đúng nguyên vẹn',
    got.status === 200 && bytes.equals(jpg), `status=${got.status} ${bytes.length}/${jpg.length}`);
  check('Ảnh trả đúng kiểu image/jpeg', (got.headers.get('content-type') || '').startsWith('image/jpeg'));

  // Tải lại đúng tấm ảnh đó thì dùng lại bản cũ, không lưu thêm một bản nữa.
  const again = await send(jpg, admin);
  const againBody = await again.json().catch(() => ({}));
  check('Tải trùng ảnh thì dùng lại bản cũ',
    againBody.url === upBody.url && againBody.reused === true, JSON.stringify(againBody));

  const lib = await call('/admin/images', { token: admin });
  check('Thư viện ảnh liệt kê ảnh vừa tải lên',
    lib.status === 200 && lib.data.uploaded?.some((i) => i.url === upBody.url),
    `status=${lib.status}`);
  check('Thư viện ảnh không lặp ảnh trùng nội dung',
    new Set((lib.data.uploaded || []).map((i) => i.url)).size === (lib.data.uploaded || []).length);
  check('Thư viện ảnh kèm ảnh các loại gạo đang dùng',
    Array.isArray(lib.data.inUse) && lib.data.inUse.length > 0, JSON.stringify(lib.data.inUse?.length));
  const libGuest = await fetch(`${BASE}/api/admin/images`);
  check('Khách không xem được thư viện ảnh (401)', libGuest.status === 401, `status=${libGuest.status}`);

  // Nhận dạng bằng byte đầu tệp, không tin Content-Type trình duyệt gửi lên.
  const fake = await send(Buffer.from('<html><script>alert(1)</script></html>'), admin);
  check('Tệp giả danh ảnh bị từ chối (400)', fake.status === 400, `status=${fake.status}`);

  const anon = await send(jpg, null);
  check('Chưa đăng nhập không tải ảnh được (401)', anon.status === 401, `status=${anon.status}`);

  const guest = await call('/auth/register', {
    method: 'POST',
    body: { full_name: 'Khách Thử Ảnh', phone: phoneOf(7), password: 'matkhau123!test' },
  });
  const asGuest = await send(jpg, guest.data.token);
  check('Khách thường không tải ảnh được (403)', asGuest.status === 403, `status=${asGuest.status}`);

  const missing = await fetch(`${BASE}/api/images/${'0'.repeat(32)}.jpg`);
  check('Ảnh không tồn tại trả 404', missing.status === 404, `status=${missing.status}`);
  const badId = await fetch(`${BASE}/api/images/..%2F..%2Fetc%2Fpasswd`);
  check('Id ảnh bất thường trả 404', badId.status === 404, `status=${badId.status}`);

  // Gắn ảnh vừa tải lên vào một sản phẩm rồi trả lại như cũ.
  const list = await call('/admin/products', { token: admin });
  const target = list.data.products[0];
  const set = await call(`/admin/products/${target.id}`, {
    method: 'PUT', token: admin, body: { image_url: upBody.url },
  });
  check('Gắn ảnh vào sản phẩm', set.data.product?.image_url === upBody.url,
    JSON.stringify(set.data.product?.image_url));
  await call(`/admin/products/${target.id}`, {
    method: 'PUT', token: admin, body: { image_url: target.image_url || '' },
  });
}

/* --- Tài khoản khách dùng để thử phân quyền xoá --- */
const guestToken = (await call('/auth/register', {
  method: 'POST',
  body: { full_name: 'Khách Thử Quyền', phone: phoneOf(6), password: 'matkhau123!test' },
})).data.token;

/* --- Xoá hẳn loại gạo --- */
{
  const made = await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Gạo thử xoá ${suffix}`, price: 12000, unit: 'túi 1kg', stock: 3 },
  });
  const pid = made.data.product?.id;
  check('Tạo loại gạo để thử xoá', made.status === 201, `status=${made.status}`);

  // "Ẩn" chỉ tắt hiển thị, dòng sản phẩm vẫn còn.
  const hidden = await call(`/admin/products/${pid}`, { method: 'DELETE', token: admin });
  const afterHide = (await call('/admin/products', { token: admin })).data.products.find((p) => p.id === pid);
  check('Ẩn sản phẩm thì vẫn còn trong danh sách quản trị',
    hidden.status === 200 && afterHide?.is_active === 0, JSON.stringify(afterHide?.is_active));

  const gone = await call(`/admin/products/${pid}/permanent`, { method: 'DELETE', token: admin });
  const afterDelete = (await call('/admin/products', { token: admin })).data.products.some((p) => p.id === pid);
  check('Xoá hẳn thì sản phẩm biến mất', gone.status === 200 && afterDelete === false,
    `status=${gone.status} còn=${afterDelete}`);
  check('Xoá hẳn lần nữa trả 404',
    (await call(`/admin/products/${pid}/permanent`, { method: 'DELETE', token: admin })).status === 404);
  check('Khách thường không xoá hẳn được sản phẩm (403)',
    (await call(`/admin/products/${pid}/permanent`, { method: 'DELETE', token: guestToken })).status === 403);
}

/* --- Xoá hẳn loại gạo ĐÃ BÁN: hoá đơn cũ phải còn nguyên --- */
{
  const made = await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Gạo đã bán ${suffix}`, price: 45000, unit: 'túi 1kg', stock: 10 },
  });
  const pid = made.data.product.id;
  const inv = await call('/retail/invoices', {
    method: 'POST', token: admin, body: { items: [{ product_id: pid, quantity: 2 }] },
  });
  const code = inv.data.invoice?.code;

  const gone = await call(`/admin/products/${pid}/permanent`, { method: 'DELETE', token: admin });
  check('Xoá hẳn được cả loại đã bán', gone.status === 200, `status=${gone.status}`);
  check('Thông báo nhắc rằng lịch sử vẫn giữ', /vẫn giữ nguyên/.test(gone.data.message || ''), gone.data.message);

  const reread = await call(`/retail/invoices/${code}`, { token: admin });
  const line = reread.data.invoice?.items?.[0];
  check('Hoá đơn cũ vẫn giữ đúng tên và giá lúc bán',
    reread.status === 200 && line?.product_name === `Gạo đã bán ${suffix}` && line?.price === 45000,
    JSON.stringify(line));
  check('Dòng hoá đơn cũ bỏ liên kết tới sản phẩm đã xoá', line?.product_id === null, String(line?.product_id));
}

/* --- Xoá hẳn tài khoản khách --- */
{
  const phone = phoneOf(4);
  await call('/auth/register', {
    method: 'POST', body: { full_name: 'Khách Xoá Thử', phone, password: 'matkhau123!test' },
  });
  const found = (await call(`/admin/customers?q=${phone}`, { token: admin })).data.customers?.[0];
  check('Tìm được khách vừa tạo', !!found, JSON.stringify(found));

  const gone = await call(`/admin/customers/${found.id}`, { method: 'DELETE', token: admin });
  const left = (await call(`/admin/customers?q=${phone}`, { token: admin })).data.customers?.length ?? -1;
  check('Xoá hẳn tài khoản chưa đặt đơn nào', gone.status === 200 && left === 0,
    `status=${gone.status} còn=${left}`);
  check('Xoá lần nữa trả 404',
    (await call(`/admin/customers/${found.id}`, { method: 'DELETE', token: admin })).status === 404);
}

/* --- Khách ĐÃ đặt đơn thì không xoá được, và không mất gì --- */
{
  const phone = phoneOf(5);
  const reg = await call('/auth/register', {
    method: 'POST', body: { full_name: 'Khách Có Đơn', phone, password: 'matkhau123!test' },
  });
  const prod = (await call('/products')).data.products.find((p) => p.price > 0 && p.stock > 0);
  const order = await call('/orders', {
    method: 'POST', token: reg.data.token,
    body: {
      receiver_name: 'Khách Có Đơn', phone,
      address: 'Số 9, đường Ngô Gia Tự, phường Tiền An',
      delivery_area: 'bac-ninh', items: [{ product_id: prod.id, quantity: 1 }],
    },
  });
  const found = (await call(`/admin/customers?q=${phone}`, { token: admin })).data.customers?.[0];

  const refused = await call(`/admin/customers/${found.id}`, { method: 'DELETE', token: admin });
  check('Khách đã đặt đơn thì không xoá được (409)', refused.status === 409, `status=${refused.status}`);
  check('Báo lỗi khuyên khoá tài khoản thay vì xoá', /kho[áa] t[àa]i kho[ảa]n/i.test(refused.data.message || ''),
    refused.data.message);

  const stillThere = (await call(`/admin/customers?q=${phone}`, { token: admin })).data.customers?.length ?? 0;
  const orderKept = (await call('/admin/orders', { token: admin })).data.orders
    .some((o) => o.id === order.data.order?.id);
  check('Từ chối xong tài khoản vẫn còn', stillThere === 1, String(stillThere));
  check('Từ chối xong đơn hàng vẫn còn', orderKept === true, String(orderKept));

  check('Khách thường không xoá được tài khoản người khác (403)',
    (await call(`/admin/customers/${found.id}`, { method: 'DELETE', token: reg.data.token })).status === 403);
}

/* --- Excel thực: đọc ngược tệp và đối chiếu số với báo cáo cùng kỳ --- */
{
  const { default: ExcelJS } = await import('exceljs');
  const requestExport = (query, token = admin) => fetch(`${BASE}/api/admin/export/orders${query ? '?' + query : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  check('Xuất Excel yêu cầu đăng nhập (401)', (await requestExport('', null)).status === 401);
  check('Khách thường không xuất được giá nhập (403)', (await requestExport('', guestToken)).status === 403);
  check('Ngày không tồn tại bị chặn (400)', (await requestExport('period=day&date=2026-02-30')).status === 400);
  check('Khoảng quá 366 ngày bị chặn (400)', (await requestExport('period=range&from=2025-01-01&to=2026-09-01')).status === 400);
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  for (const query of ['', `period=day&date=${today}`, `period=month&month=${today.slice(0, 7)}`, `period=range&from=${today}&to=${today}`]) {
    const response = await requestExport(query);
    check('Excel trả đúng kiểu tệp và no-store: ' + (query || 'hôm nay'), response.status === 200
      && response.headers.get('content-type')?.includes('spreadsheetml.sheet')
      && response.headers.get('cache-control') === 'no-store'
      && response.headers.get('content-disposition')?.includes("filename*=UTF-8''"));
    if (response.status !== 200) continue;
    const workbook = new ExcelJS.Workbook();
    const bytes = await response.arrayBuffer();
    await workbook.xlsx.load(bytes);
    const summary = workbook.getWorksheet('Tổng hợp theo ngày');
    const report = (await call('/admin/revenue' + (query ? '?' + query : ''), { token: admin })).data;
    const sums = Array(9).fill(0);
    summary.eachRow((row, index) => { if (index > 1) for (let column = 2; column <= 8; column++) sums[column] += row.getCell(column).value; });
    check('Tổng Excel khớp báo cáo doanh thu: ' + (query || 'hôm nay'), sums[2] === report.online.orders
      && sums[3] === report.online.revenue && sums[4] === report.retail.invoices
      && sums[5] === report.retail.revenue && sums[7] === report.total.revenue && sums[8] === report.profit.gross);
    check('Tệp có ba sheet, số thực và hàng tiêu đề cố định', bytes.byteLength > 1000
      && workbook.worksheets.length === 3 && typeof summary.getCell('G2').value === 'number'
      && summary.views[0].ySplit === 1 && summary.getCell('G2').numFmt === '#,##0');
  }
  const first = await call('/admin/orders?limit=1&offset=0', { token: admin });
  const second = await call('/admin/orders?limit=1&offset=1', { token: admin });
  check('Phân trang đơn không lặp và giữ tổng', first.data.orders.length === 1 && second.data.orders.length === 1
    && first.data.orders[0].id !== second.data.orders[0].id && first.data.total === second.data.total);
  check('Số lượng từng trạng thái cộng lại đúng tổng', Object.entries(first.data.counts)
    .filter(([key]) => key !== 'all').reduce((sum, [, value]) => sum + value, 0) === first.data.total);
  const completed = await call('/admin/orders?status=completed&limit=1', { token: admin });
  check('Lọc trạng thái kết hợp phân trang', completed.data.total === first.data.counts.completed
    && completed.data.orders.every(order => order.status === 'completed'));
  check('Giới hạn phân trang không hợp lệ bị chặn', (await call('/admin/orders?limit=101', { token: admin })).status === 400);
}

/* --- Bộ lọc danh mục: giảm giá, gạo nhà hàng, thực phẩm khô --- */
{
  const made = [];
  const create = async (body) => {
    const r = await call('/admin/products', { method: 'POST', token: admin, body });
    if (r.data.product) made.push(r.data.product.id);
    return r;
  };

  // Gạo đang giảm giá: giá gốc cao hơn giá bán.
  const sale = await create({ name: `Gạo giảm giá ${suffix}`, price: 90000, original_price: 120000, unit: 'túi 5kg', stock: 10 });
  check('Tạo sản phẩm có giá gốc (201)', sale.status === 201, `status=${sale.status} ${JSON.stringify(sale.data).slice(0, 120)}`);
  check('Lưu đúng giá gốc', sale.data.product?.original_price === 120000, String(sale.data.product?.original_price));
  check('Mặc định nhóm hàng là gạo', sale.data.product?.category === 'gao', String(sale.data.product?.category));

  // Giá gốc không cao hơn giá bán thì bị từ chối.
  const bad = await create({ name: `Gạo giá gốc sai ${suffix}`, price: 90000, original_price: 90000, unit: 'túi 5kg', stock: 1 });
  check('Giá gốc bằng giá bán bị từ chối (400)', bad.status === 400 && !!bad.data.errors?.original_price, `status=${bad.status}`);

  // Đồ khô và gạo bao 25kg.
  const dry = await create({ name: `Nấm hương khô ${suffix}`, price: 80000, unit: 'gói 200g', stock: 5, category: 'do-kho' });
  check('Tạo sản phẩm nhóm thực phẩm khô', dry.status === 201 && dry.data.product?.category === 'do-kho', JSON.stringify(dry.data).slice(0, 120));
  const bag = await create({ name: `Gạo bao nhà hàng ${suffix}`, price: 400000, unit: 'bao 25kg', stock: 5 });
  check('Bao 25kg tự nhận 25kg', bag.data.product?.weight_kg === 25, String(bag.data.product?.weight_kg));

  const bogus = await create({ name: `Nhóm lạ ${suffix}`, price: 10000, unit: 'kg', stock: 1, category: 'dien-thoai' });
  check('Nhóm hàng lạ bị từ chối (400)', bogus.status === 400, `status=${bogus.status}`);

  const ids = async (group) => (await call(`/products?group=${group}`)).data.products.map((p) => p.id);
  const saleIds = await ids('giam-gia');
  const restaurantIds = await ids('nha-hang');
  const dryIds = await ids('do-kho');

  check('Lọc "Đang giảm giá" có sản phẩm giảm giá', saleIds.includes(sale.data.product.id));
  check('Lọc "Đang giảm giá" không lẫn hàng giá thường', !saleIds.includes(bag.data.product.id) && !saleIds.includes(dry.data.product.id));
  check('Lọc "Gạo nhà hàng" có gạo bao 25kg', restaurantIds.includes(bag.data.product.id));
  check('Lọc "Gạo nhà hàng" không lẫn túi 5kg hay đồ khô', !restaurantIds.includes(sale.data.product.id) && !restaurantIds.includes(dry.data.product.id));
  check('Lọc "Thực phẩm khô" chỉ có đồ khô', dryIds.includes(dry.data.product.id) && !dryIds.includes(bag.data.product.id));

  const odd = await call('/products?group=constructor');
  check('Nhóm lọc lạ bị từ chối (400)', odd.status === 400, `status=${odd.status}`);

  const publicList = JSON.stringify((await call('/products?group=giam-gia')).data);
  check('Danh mục công khai trả giá gốc để hiện nhãn giảm giá', publicList.includes('original_price'));
  check('Danh mục công khai vẫn không lộ giá nhập', !publicList.includes('cost_price'));

  // Khách đặt sản phẩm đang giảm giá: tiền hàng tính theo giá bán, không phải giá gốc.
  const order = await call('/orders', {
    method: 'POST', token: guestToken,
    body: {
      receiver_name: 'Khách Mua Hàng Giảm Giá', phone: phoneOf(6),
      address: 'Số 12, đường Lý Thái Tổ, phường Suối Hoa', delivery_area: 'bac-ninh',
      items: [{ product_id: sale.data.product.id, quantity: 2 }],
    },
  });
  check('Đặt sản phẩm giảm giá tính theo giá bán (2 × 90.000đ)', order.data.order?.subtotal === 180000,
    `status=${order.status} subtotal=${order.data.order?.subtotal}`);

  // Sửa giá bán lên cao hơn giá gốc cũ: phải bị chặn vì nhãn giảm giá sẽ sai.
  const raise = await call(`/admin/products/${sale.data.product.id}`, { method: 'PUT', token: admin, body: { price: 130000 } });
  check('Nâng giá bán vượt giá gốc cũ bị từ chối (400)', raise.status === 400, `status=${raise.status}`);
  const clear = await call(`/admin/products/${sale.data.product.id}`, { method: 'PUT', token: admin, body: { original_price: '' } });
  check('Xoá giá gốc là thôi giảm giá', clear.status === 200 && clear.data.product?.original_price === 0, JSON.stringify(clear.data).slice(0, 120));
  check('Thôi giảm giá thì rời khỏi bộ lọc giảm giá', !(await ids('giam-gia')).includes(sale.data.product.id));

  // Khách vẫn trả đúng giá bán, không phải giá gốc.
  for (const id of made) {
    await call(`/admin/products/${id}/permanent`, { method: 'DELETE', token: admin });
  }
}

/* --- Ảnh banner trang chủ đổi được --- */
{
  const original = (await call('/settings/storefront')).data.settings || null;
  const before = original?.banner_image_url ?? null;
  check('Khách xem được cài đặt banner mà không cần đăng nhập', before !== null, String(before));

  const set = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin, body: { banner_image_url: '/products/co-may-4-mua-5kg.jpg' },
  });
  check('Quản trị đổi được ảnh banner', set.status === 200 && set.data.settings?.banner_image_url === '/products/co-may-4-mua-5kg.jpg',
    `status=${set.status} ${JSON.stringify(set.data).slice(0, 120)}`);
  check('Khách thấy ngay ảnh banner mới',
    (await call('/settings/storefront')).data.settings?.banner_image_url === '/products/co-may-4-mua-5kg.jpg');

  check('Chưa đăng nhập không đổi được banner (401)',
    (await call('/admin/settings/storefront', { method: 'PUT', body: { banner_image_url: '/x.jpg' } })).status === 401);
  check('Khách thường không đổi được banner (403)',
    (await call('/admin/settings/storefront', { method: 'PUT', token: guestToken, body: { banner_image_url: '/x.jpg' } })).status === 403);
  for (const bad of ['javascript:alert(1)', '//evil.example/x.jpg']) {
    const r = await call('/admin/settings/storefront', { method: 'PUT', token: admin, body: { banner_image_url: bad } });
    check(`Đường dẫn banner nguy hiểm bị chặn: ${bad}`, r.status === 400, `status=${r.status}`);
  }
  const extra = await call('/admin/settings/storefront', { method: 'PUT', token: admin, body: { banner_image_url: '', role: 'x' } });
  check('Không nhận trường lạ khi đổi banner (400)', extra.status === 400, `status=${extra.status}`);

  const clear = await call('/admin/settings/storefront', { method: 'PUT', token: admin, body: { banner_image_url: '' } });
  check('Bỏ ảnh banner để quay về banner màu', clear.status === 200 && clear.data.settings?.banner_image_url === '');

  /* Nhiều ảnh chạy vòng, đúng thứ tự, bỏ ảnh trùng */
  const many = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin,
    body: { banner_images: ['/products/co-may-4-mua-5kg.jpg', '/logo-mark.png', '/products/co-may-4-mua-5kg.jpg'] },
  });
  check('Lưu được nhiều ảnh banner theo thứ tự, bỏ ảnh trùng',
    many.status === 200 && JSON.stringify(many.data.settings?.banner_images) === JSON.stringify(['/products/co-may-4-mua-5kg.jpg', '/logo-mark.png']),
    `status=${many.status} ${JSON.stringify(many.data.settings)}`);
  check('Ảnh đầu vẫn trả ở banner_image_url cho bản cũ', many.data.settings?.banner_image_url === '/products/co-may-4-mua-5kg.jpg');
  const seven = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin, body: { banner_images: Array.from({ length: 7 }, (_, i) => `/b${i}.jpg`) },
  });
  check('Quá 6 ảnh banner bị từ chối (400)', seven.status === 400, `status=${seven.status}`);
  const badList = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin, body: { banner_images: ['/ok.jpg', 'javascript:alert(1)'] },
  });
  check('Một ảnh nguy hiểm trong danh sách thì từ chối cả lần lưu', badList.status === 400, `status=${badList.status}`);

  /* Số điện thoại tư vấn */
  const phoneSet = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin, body: { contact_phone: '+84 912 345 678' },
  });
  check('Lưu số tư vấn, tự chuẩn hoá về 0xxxxxxxxx',
    phoneSet.status === 200 && phoneSet.data.settings?.contact_phone === '0912345678', JSON.stringify(phoneSet.data.settings));
  check('Đổi số tư vấn không đụng tới danh sách ảnh',
    JSON.stringify(phoneSet.data.settings?.banner_images) === JSON.stringify(['/products/co-may-4-mua-5kg.jpg', '/logo-mark.png']));
  check('Khách thấy số tư vấn mà không cần đăng nhập',
    (await call('/settings/storefront')).data.settings?.contact_phone === '0912345678');
  const badPhone = await call('/admin/settings/storefront', { method: 'PUT', token: admin, body: { contact_phone: '12345' } });
  check('Số tư vấn sai bị từ chối (400)', badPhone.status === 400 && !!badPhone.data.errors?.contact_phone, `status=${badPhone.status}`);
  check('Khách thường không đổi được số tư vấn (403)',
    (await call('/admin/settings/storefront', { method: 'PUT', token: guestToken, body: { contact_phone: '0912345678' } })).status === 403);
  const phoneClear = await call('/admin/settings/storefront', { method: 'PUT', token: admin, body: { contact_phone: '' } });
  check('Xoá số tư vấn để ẩn khung liên hệ', phoneClear.status === 200 && phoneClear.data.settings?.contact_phone === '');

  // Trả lại đúng như trước khi thử.
  await call('/admin/settings/storefront', {
    method: 'PUT', token: admin,
    body: { banner_images: original?.banner_images ?? (before ? [before] : []), contact_phone: original?.contact_phone || '' },
  });
}

/* --- Mã đơn online tự tạo --- */
{
  const prod = (await call('/products')).data.products.find((p) => p.price > 0 && p.stock > 0);
  const made = await call('/orders', {
    method: 'POST', token: guestToken,
    body: {
      receiver_name: 'Khách Thử Mã Đơn', phone: phoneOf(6),
      address: 'Số 12, đường Lý Thái Tổ, phường Suối Hoa', delivery_area: 'bac-ninh',
      items: [{ product_id: prod.id, quantity: 1 }],
    },
  });
  const order = made.data.order;
  check('Đơn mới có mã dạng DH000123', /^DH\d{6}$/.test(order?.code || ''), String(order?.code));
  check('Mã đơn khớp số thứ tự đơn', order?.code === `DH${String(order?.id).padStart(6, '0')}`, `${order?.code} / id ${order?.id}`);

  const mine = (await call('/orders', { token: guestToken })).data.orders || [];
  check('Khách thấy mã trong danh sách đơn của mình', mine.some((o) => o.code === order.code));
  const adminList = (await call('/admin/orders?limit=100', { token: admin })).data.orders || [];
  check('Quản trị thấy mã trong danh sách đơn', adminList.some((o) => o.code === order.code));
  check('Mọi đơn trong danh sách quản trị đều có mã', adminList.every((o) => /^DH\d{6}$/.test(o.code || '')),
    adminList.filter((o) => !o.code).map((o) => o.id).join(','));
}

/* --- Đợt giảm giá 26/09 và thứ tự danh mục --- */
{
  const all = (await call('/products')).data.products;
  const find = (image) => all.find((p) => p.image_url === image);
  const bon = find('/products/co-may-4-mua-5kg.jpg');
  const lotus = find('/products/co-may-thom-deo-vua-5kg.jpg');
  if (bon?.original_price > 0) {
    // Cơ sở dữ liệu đã có sản phẩm trước đợt giảm giá: phải đúng từng đồng.
    check('Gạo 4 Mùa giảm 25% (140.000đ → 105.000đ)', bon.price === 105000 && bon.original_price === 140000,
      `${bon.price}/${bon.original_price}`);
    check('Cỏ May thơm bông sen giảm 25% (120.000đ → 90.000đ)', lotus?.price === 90000 && lotus?.original_price === 120000,
      `${lotus?.price}/${lotus?.original_price}`);
  } else {
    // Cơ sở dữ liệu tạo mới: đợt giảm giá chỉ chạy một lần, không đụng sản phẩm thêm sau đó.
    check('Đợt giảm giá không áp lên sản phẩm tạo sau lúc triển khai', bon?.price === 140000 && lotus?.price === 120000,
      `${bon?.price}/${lotus?.price}`);
  }

  // Tự tạo một sản phẩm giảm giá để thứ tự luôn kiểm tra được trên mọi cơ sở dữ liệu.
  const promo = await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Gạo thử thứ tự ${suffix}`, price: 50000, original_price: 60000, unit: 'túi 5kg', stock: 5 },
  });
  const list = (await call('/products')).data.products.filter((p) => p.stock > 0);
  const onSale = (p) => p.original_price > p.price && p.price > 0;
  const firstRegular = list.findIndex((p) => !onSale(p));
  const lastSale = list.map(onSale).lastIndexOf(true);
  check('Hàng đang giảm giá hiện lên đầu danh mục', lastSale !== -1 && (firstRegular === -1 || lastSale < firstRegular),
    `giam gia cuoi o vi tri ${lastSale}, gia thuong dau o vi tri ${firstRegular}`);
  if (promo.data.product) await call(`/admin/products/${promo.data.product.id}/permanent`, { method: 'DELETE', token: admin });
}

/* ================================================================== *
 * 02/10/2026: định vị giao hàng, điểm theo loại gạo, nhóm khách,
 * đổi 1.000 điểm lấy voucher 30.000đ hoặc quà 1kg
 * ================================================================== */
{
  const phone = phoneOf(9);
  const signup = await call('/auth/register', {
    method: 'POST', body: { full_name: 'Khách Đổi Điểm', phone, password: 'matkhau123!test' },
  });
  const token = signup.data.token;
  const userId = signup.data.user?.id;
  check('Tạo khách thử đổi điểm', signup.status === 201, JSON.stringify(signup.data).slice(0, 120));

  /* --- Sản phẩm thử: một loại có điểm riêng, một loại làm quà --- */
  const pointy = (await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Gạo điểm riêng ${suffix}`, price: 100000, unit: 'túi 5kg', stock: 50, points_per_unit: 150 },
  })).data.product;
  const gift = (await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Quà nếp 1kg ${suffix}`, price: 30000, unit: 'túi 1kg', stock: 5, is_reward: true },
  })).data.product;
  check('Admin đặt được điểm riêng mỗi túi', pointy?.points_per_unit === 150, JSON.stringify(pointy));
  check('Admin bật được làm quà đổi điểm', gift?.is_reward === 1);
  const publicPointy = (await call(`/products/${pointy.id}`)).data.product;
  check('Khách thấy điểm riêng của loại gạo', publicPointy?.points_per_unit === 150);
  check('Khách không thấy giá nhập', !('cost_price' in (publicPointy || {})));
  const badPoints = await call(`/admin/products/${pointy.id}`, { method: 'PUT', token: admin, body: { points_per_unit: -5 } });
  check('Điểm âm bị từ chối (400)', badPoints.status === 400, `status=${badPoints.status}`);
  const guestEdit = await call(`/admin/products/${pointy.id}`, { method: 'PUT', token, body: { points_per_unit: 9999 } });
  check('Khách thường không sửa được điểm sản phẩm (403)', guestEdit.status === 403);

  /* --- Ghim vị trí vào địa chỉ, đơn giữ bản sao vị trí --- */
  const addr = await call('/addresses', {
    method: 'POST', token,
    body: {
      label: 'Nhà riêng', receiver_name: 'Khách Đổi Điểm', phone,
      address: 'Số 12 đường Lý Thái Tổ, phường Suối Hoa',
      latitude: 21.1861234, longitude: 106.0763456, location_accuracy: 18.4,
    },
  });
  const saved = addr.data.address;
  check('Lưu được vị trí khách ghim (làm tròn ~1m)',
    addr.status === 201 && saved?.latitude === 21.18612 && saved?.longitude === 106.07635 && saved?.location_accuracy === 18,
    JSON.stringify(saved));
  const badLoc = await call('/addresses', {
    method: 'POST', token,
    body: { receiver_name: 'Khách', phone, address: 'Số 1 đường Trần Hưng Đạo', latitude: 200, longitude: 106 },
  });
  check('Vị trí sai bị từ chối (400)', badLoc.status === 400, `status=${badLoc.status}`);
  const keep = await call(`/addresses/${saved.id}`, {
    method: 'PUT', token,
    body: { label: 'Nhà riêng', receiver_name: 'Khách Đổi Điểm', phone, address: 'Số 12 đường Lý Thái Tổ, phường Suối Hoa' },
  });
  check('Sửa địa chỉ không gửi vị trí thì giữ nguyên vị trí cũ', keep.data.address?.latitude === 21.18612);

  /* --- Tích điểm tại quầy để có điểm đổi (bán quầy không trừ kho online) --- */
  const pos = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, full_name: 'Khách Đổi Điểm', items: [{ product_id: pointy.id, quantity: 20 }] },
  });
  check('Hoá đơn quầy cộng điểm theo loại gạo (20 túi × 150 điểm)',
    pos.status === 201 && pos.data.invoice?.points_earned === 3000, JSON.stringify(pos.data.invoice?.points_earned));

  const info = (await call('/orders/discount', { token })).data;
  check('Trang đặt hàng thấy điểm và danh sách quà',
    info.points === 3000 && info.voucherAmount === 30000 && info.rewards?.some((r) => r.id === gift.id),
    JSON.stringify({ points: info.points, voucher: info.voucherAmount }));

  /* --- Đặt online dùng 1 voucher + 1 quà: trừ 2.000 điểm --- */
  const orderBody = {
    address_id: saved.id, delivery_area: 'bac-ninh', payment_method: 'cod',
    items: [{ product_id: pointy.id, quantity: 2 }],
  };
  const tooMany = await call('/orders', {
    method: 'POST', token, body: { ...orderBody, voucher_count: 2, rewards: [{ product_id: gift.id, quantity: 2 }] },
  });
  check('Đổi quá số điểm đang có bị từ chối (400)', tooMany.status === 400, `status=${tooMany.status} ${tooMany.data.message}`);
  const bigVoucher = await call('/orders', {
    method: 'POST', token, body: { ...orderBody, items: [{ product_id: gift.id, quantity: 1 }], voucher_count: 1 },
  });
  check('Voucher lớn hơn tiền còn phải trả bị từ chối (400)', bigVoucher.status === 400, `status=${bigVoucher.status}`);
  const notGift = await call('/orders', {
    method: 'POST', token, body: { ...orderBody, rewards: [{ product_id: pointy.id, quantity: 1 }] },
  });
  check('Sản phẩm không phải quà thì không đổi được (400)', notGift.status === 400);
  check('Các lần bị từ chối không trừ điểm', (await call('/orders/discount', { token })).data.points === 3000);

  const giftStock = (await call(`/products/${gift.id}`)).data.product.stock;
  const made = await call('/orders', {
    method: 'POST', token, body: { ...orderBody, voucher_count: 1, rewards: [{ product_id: gift.id, quantity: 1 }] },
  });
  const order = made.data.order;
  check('Đơn dùng voucher: giảm đơn đầu 20.000đ + voucher 30.000đ',
    made.status === 201 && order.subtotal === 200000 && order.voucher_discount === 30000
      && order.discount === 50000 && order.total === 150000 && order.points_used === 2000,
    JSON.stringify({ s: made.status, ...order, items: undefined }).slice(0, 200));
  const giftLine = order?.items?.find((i) => i.product_id === gift.id);
  check('Quà nằm trong đơn với giá 0đ', giftLine?.price === 0 && giftLine?.is_reward === 1);
  check('Đơn giữ vị trí khách ghim', order?.delivery_lat === 21.18612 && order?.delivery_lng === 106.07635);
  check('Trừ 2.000 điểm ngay khi đặt', (await call('/orders/discount', { token })).data.points === 1000);
  check('Quà trừ kho như hàng bán', (await call(`/products/${gift.id}`)).data.product.stock === giftStock - 1);

  /* --- Huỷ đơn: hoàn điểm và hoàn kho đúng một lần --- */
  const cancel = await call(`/orders/${order.id}/cancel`, { method: 'PATCH', token });
  check('Khách huỷ được đơn đổi điểm', cancel.status === 200);
  check('Huỷ đơn hoàn lại 2.000 điểm', (await call('/orders/discount', { token })).data.points === 3000);
  check('Huỷ đơn trả quà về kho', (await call(`/products/${gift.id}`)).data.product.stock === giftStock);
  const again = await call(`/orders/${order.id}/cancel`, { method: 'PATCH', token });
  check('Huỷ lần hai bị từ chối, không hoàn điểm hai lần',
    again.status === 400 && (await call('/orders/discount', { token })).data.points === 3000);

  /* --- Hoàn thành đơn: điểm theo loại gạo --- */
  const plain = await call('/orders', { method: 'POST', token, body: orderBody });
  const plainId = plain.data.order?.id;
  for (const status of ['confirmed', 'shipping', 'completed']) {
    await call(`/admin/orders/${plainId}/status`, { method: 'PATCH', token: admin, body: { status } });
  }
  const done = (await call(`/orders/${plainId}`, { token })).data.order;
  check('Đơn giao xong cộng điểm riêng: 2 túi × 150 = 300 điểm (không phụ thuộc giảm giá)',
    done?.points_earned === 300, `points_earned=${done?.points_earned}`);

  /* --- Voucher tại quầy --- */
  const posVoucher = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, items: [{ product_id: pointy.id, quantity: 1 }], voucher_count: 1 },
  });
  const pv = posVoucher.data.invoice;
  check('Voucher tại quầy trừ 30.000đ và 1.000 điểm',
    posVoucher.status === 201 && pv.voucher_discount === 30000 && pv.total === 70000 && pv.points_used === 1000,
    JSON.stringify(pv && { total: pv.total, v: pv.voucher_discount, used: pv.points_used }));
  const posBig = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, items: [{ product_id: gift.id, quantity: 1 }], voucher_count: 2 },
  });
  check('Voucher quầy vượt tiền hàng bị từ chối (400)', posBig.status === 400);

  /* --- Nhóm khách --- */
  const seg = await call(`/admin/customers/${userId}/segment`, {
    method: 'PATCH', token: admin, body: { segment: 'nha-hang' },
  });
  check('Admin xếp khách vào nhóm nhà hàng', seg.status === 200 && seg.data.segment === 'nha-hang', JSON.stringify(seg.data));
  const listed = await call('/admin/customers?segment=nha-hang&limit=100', { token: admin });
  check('Lọc danh sách theo nhóm nhà hàng',
    listed.data.customers?.some((c) => c.id === userId && c.segment === 'nha-hang')
      && listed.data.customers.every((c) => c.segment === 'nha-hang'));
  check('Danh sách có số khách mỗi nhóm', (listed.data.segments?.['nha-hang'] ?? 0) >= 1);
  const lookup = await call(`/retail/customers?phone=${phone}`, { token: admin });
  check('Bán quầy thấy cùng nhóm khách theo số điện thoại', lookup.data.customer?.segment === 'nha-hang');
  const posSeg = await call(`/retail/customers/${lookup.data.customer.id}`, {
    method: 'PUT', token: admin, body: { segment: 'dai-ly' },
  });
  check('Bán quầy đổi được nhóm khách', posSeg.data.customer?.segment === 'dai-ly');
  const badSeg = await call(`/admin/customers/${userId}/segment`, { method: 'PATCH', token: admin, body: { segment: 'vip' } });
  check('Nhóm khách lạ bị từ chối (400)', badSeg.status === 400);
  const guestSeg = await call(`/admin/customers/${userId}/segment`, { method: 'PATCH', token, body: { segment: 'dai-ly' } });
  check('Khách thường không tự xếp nhóm được (403)', guestSeg.status === 403);

  // Dọn sản phẩm thử. Đơn và hoá đơn cũ vẫn giữ tên/giá lúc bán.
  for (const p of [pointy, gift]) await call(`/admin/products/${p.id}/permanent`, { method: 'DELETE', token: admin });
}

/* ================================================================== *
 * 03/10/2026: đơn huỷ không được cộng điểm; trả hàng tại quầy trừ lại điểm
 * ================================================================== */
{
  const phone = `08${String(suffix).slice(-8)}`;
  const signup = await call('/auth/register', {
    method: 'POST', body: { full_name: 'Khách Huỷ Đơn', phone, password: 'matkhau123!test' },
  });
  const token = signup.data.token;
  const product = (await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Gạo thử huỷ ${suffix}`, price: 100000, unit: 'túi 5kg', stock: 20 },
  })).data.product;
  const pointsNow = async () => (await call(`/retail/customers?phone=${phone}`, { token: admin })).data.customer?.points ?? 0;
  const setStatus = (id, status) => call(`/admin/orders/${id}/status`, { method: 'PATCH', token: admin, body: { status } });
  const body = {
    receiver_name: 'Khách Huỷ Đơn', phone, address: 'Số 3 đường Nguyễn Trãi, phường Ninh Xá',
    delivery_area: 'bac-ninh', payment_method: 'cod', items: [{ product_id: product.id, quantity: 1 }],
  };

  /* Đơn online bị huỷ ở bước đang giao: không cộng điểm */
  const first = (await call('/orders', { method: 'POST', token, body })).data.order;
  await setStatus(first.id, 'confirmed');
  await setStatus(first.id, 'shipping');
  const cancelled = await setStatus(first.id, 'cancelled');
  check('Admin huỷ đơn đang giao', cancelled.status === 200 && cancelled.data.order?.status === 'cancelled');
  check('Đơn huỷ không được cộng điểm', cancelled.data.order?.points_earned === 0 && (await pointsNow()) === 0,
    `points_earned=${cancelled.data.order?.points_earned} diem=${await pointsNow()}`);

  /* Khách tự huỷ đơn chờ xác nhận: cũng không cộng */
  const selfCancel = (await call('/orders', { method: 'POST', token, body })).data.order;
  await call(`/orders/${selfCancel.id}/cancel`, { method: 'PATCH', token });
  check('Khách tự huỷ đơn: không cộng điểm', (await pointsNow()) === 0);

  /* Đơn giao xong thì có điểm, và không huỷ được nữa để giữ điểm */
  const done = (await call('/orders', { method: 'POST', token, body })).data.order;
  for (const status of ['confirmed', 'shipping', 'completed']) await setStatus(done.id, status);
  const earned = await pointsNow();
  check('Đơn giao xong mới được cộng điểm (80.000đ sau ưu đãi đơn đầu = 80 điểm)', earned === 80, `diem=${earned}`);
  const lateCancel = await setStatus(done.id, 'cancelled');
  check('Không huỷ được đơn đã hoàn thành (400), điểm giữ nguyên',
    lateCancel.status === 400 && (await pointsNow()) === 80, `status=${lateCancel.status}`);

  /* Trả hàng tại quầy: trừ lại điểm theo tiền hoàn, không trừ trùng */
  const inv = (await call('/retail/invoices', {
    method: 'POST', token: admin, body: { phone, items: [{ product_id: product.id, quantity: 2 }] },
  })).data.invoice;
  check('Hoá đơn quầy 200.000đ cộng 200 điểm', inv?.points_earned === 200 && (await pointsNow()) === 280);
  const line = inv.items.find((i) => !i.is_reward);
  const ret = (extra) => call('/retail/returns', {
    method: 'POST', token: admin,
    body: { invoice_id: inv.id, reason: 'Khách trả hàng thử', items: [{ invoice_item_id: line.id, quantity: 1 }], ...extra },
  });
  const half = await ret({ return_type: 'return', refund_method: 'cash' });
  check('Trả 1/2 hoá đơn: trừ 100 điểm', half.status === 201 && half.data.return?.points_removed === 100 && (await pointsNow()) === 180,
    `status=${half.status} removed=${half.data.return?.points_removed} diem=${await pointsNow()}`);
  const rest = await ret({ return_type: 'return', refund_method: 'cash' });
  check('Trả nốt: trừ hết 200 điểm của hoá đơn, không trừ trùng',
    rest.data.return?.points_removed === 100 && (await pointsNow()) === 80, `removed=${rest.data.return?.points_removed}`);

  const inv2 = (await call('/retail/invoices', {
    method: 'POST', token: admin, body: { phone, items: [{ product_id: product.id, quantity: 1 }] },
  })).data.invoice;
  const exchange = await call('/retail/returns', {
    method: 'POST', token: admin,
    body: { invoice_id: inv2.id, return_type: 'exchange', reason: 'Đổi loại khác',
      items: [{ invoice_item_id: inv2.items[0].id, quantity: 1 }] },
  });
  check('Đổi hàng (không hoàn tiền) giữ nguyên điểm',
    exchange.status === 201 && exchange.data.return?.points_removed === 0 && (await pointsNow()) === 180);

  await call(`/admin/products/${product.id}/permanent`, { method: 'DELETE', token: admin });
}

/* ================================================================== *
 * 03/10/2026: đặt hàng nhanh không cần tài khoản
 * ================================================================== */
{
  const last8 = String(suffix).slice(-8);
  const gp1 = `07${last8}`;
  const gp2 = `03${last8}`;
  const gp3 = `05${last8}`;
  const product = (await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Gạo mua nhanh ${suffix}`, price: 100000, cost_price: 70000, unit: 'túi 5kg', stock: 100 },
  })).data.product;
  const guestBody = (phone, extra = {}) => ({
    receiver_name: 'Cô Hoa', phone, address: 'Số 8 đường Lê Văn Thịnh, phường Suối Hoa',
    delivery_area: 'bac-ninh', delivery_slot: 'chieu', payment_method: 'cod',
    items: [{ product_id: product.id, quantity: 2 }], ...extra,
  });

  const first = await call('/orders/guest', {
    method: 'POST', body: guestBody(gp1, { latitude: 21.18, longitude: 106.07, location_accuracy: 30 }),
  });
  const g1 = first.data.order;
  check('Đặt hàng không cần đăng nhập (201)', first.status === 201 && g1?.is_guest === 1 && /^DH\d{6}$/.test(g1?.code || ''),
    `status=${first.status} ${JSON.stringify(first.data).slice(0, 160)}`);
  check('Đơn mua nhanh đầu tiên của số điện thoại được giảm 20.000đ', g1?.discount === 20000 && g1?.total === 180000);
  check('Trả mã bí mật 48 ký tự để gắn đơn vào tài khoản sau', /^[a-f0-9]{48}$/.test(first.data.guest_token || ''));
  check('Không lộ mã băm và giá nhập trong phản hồi',
    !('guest_token_hash' in (g1 || {})) && !JSON.stringify(first.data).includes('cost_price'));
  check('Đơn mua nhanh giữ vị trí khách ghim', g1?.delivery_lat === 21.18 && g1?.delivery_lng === 106.07);

  const second = await call('/orders/guest', { method: 'POST', body: guestBody(gp1) });
  check('Cùng số điện thoại đặt lần hai: không giảm nữa', second.status === 201 && second.data.order?.discount === 0);

  const withVoucher = await call('/orders/guest', { method: 'POST', body: guestBody(gp3, { voucher_count: 1 }) });
  check('Mua nhanh không đổi điểm được (400)', withVoucher.status === 400, `status=${withVoucher.status}`);
  const tooMany = await call('/orders/guest', {
    method: 'POST', body: guestBody(gp3, { items: [{ product_id: product.id, quantity: 51 }] }),
  });
  check('Mua nhanh tối đa 50 mỗi loại (400)', tooMany.status === 400, `status=${tooMany.status}`);
  const badPhone = await call('/orders/guest', { method: 'POST', body: guestBody('12345') });
  check('Số điện thoại sai bị từ chối (400)', badPhone.status === 400 && !!badPhone.data.errors?.phone);
  const farAway = await call('/orders/guest', {
    method: 'POST', body: guestBody(gp3, { address: 'Số 1 phố Huế, quận Hai Bà Trưng, Hà Nội' }),
  });
  check('Địa chỉ ngoài Bắc Ninh bị từ chối (400)', farAway.status === 400 && !!farAway.data.errors?.address);

  /* Quản trị thấy đơn, nhãn mua nhanh, không lộ mã băm; tài khoản hệ thống không phải khách */
  const adminList = await call('/admin/orders?status=pending&limit=100', { token: admin });
  const listed = adminList.data.orders?.find((o) => o.id === g1.id);
  check('Quản trị thấy đơn mua nhanh', !!listed && listed.is_guest === 1 && !('guest_token_hash' in listed));
  const guestUserId = listed?.user_id;
  const customers = await call('/admin/customers?limit=100', { token: admin });
  check('Tài khoản hệ thống không nằm trong danh sách khách', !customers.data.customers?.some((c) => c.id === guestUserId));
  check('Không mở/sửa được tài khoản hệ thống (404)',
    (await call(`/admin/customers/${guestUserId}`, { token: admin })).status === 404
      && (await call(`/admin/customers/${guestUserId}/lock`, { method: 'PATCH', token: admin, body: { is_locked: 0 } })).status === 404);

  /* Giao xong: cộng điểm vào số điện thoại trên đơn */
  for (const status of ['confirmed', 'shipping', 'completed']) {
    await call(`/admin/orders/${g1.id}/status`, { method: 'PATCH', token: admin, body: { status } });
  }
  const pts = (await call(`/retail/customers?phone=${gp1}`, { token: admin })).data.customer?.points;
  check('Đơn mua nhanh giao xong được tích điểm vào số điện thoại (180 điểm)', pts === 180, `diem=${pts}`);

  /* Tạo tài khoản ngay sau khi đặt: đơn được gắn vào tài khoản */
  const placed = await call('/orders/guest', { method: 'POST', body: guestBody(gp2) });
  const claimToken = placed.data.guest_token;
  const claim = await call('/auth/register', {
    method: 'POST',
    body: { full_name: 'Cô Hoa', phone: gp2, password: 'matkhau123!test',
      guest_order: { id: placed.data.order.id, token: claimToken } },
  });
  const mine = (await call('/orders', { token: claim.data.token })).data.orders || [];
  check('Tạo tài khoản sau khi đặt: đơn hiện trong "Đơn của tôi"',
    claim.status === 201 && mine.some((o) => o.id === placed.data.order.id), `status=${claim.status} so don=${mine.length}`);
  check('Khách huỷ được đơn vừa gắn vào tài khoản',
    (await call(`/orders/${placed.data.order.id}/cancel`, { method: 'PATCH', token: claim.data.token })).status === 200);
  const reuse = await call('/auth/register', {
    method: 'POST',
    body: { full_name: 'Kẻ Dùng Lại', phone: `04${last8}`, password: 'matkhau123!test',
      guest_order: { id: placed.data.order.id, token: claimToken } },
  });
  const reusedOrders = reuse.data.token ? (await call('/orders', { token: reuse.data.token })).data.orders : null;
  check('Mã bí mật dùng rồi (hoặc sai) thì vẫn tạo tài khoản nhưng không lấy được đơn',
    reuse.status === 201 && Array.isArray(reusedOrders) && reusedOrders.length === 0,
    `status=${reuse.status} ${JSON.stringify(reuse.data).slice(0, 160)} orders=${JSON.stringify(reusedOrders)?.slice(0, 80)}`);

  await call(`/admin/products/${product.id}/permanent`, { method: 'DELETE', token: admin });
}

/* ================================================================== *
 * 07/10/2026: giờ máy chủ cho trang khách, các cơ sở ở chân trang
 * ================================================================== */
{
  const time = await call('/time');
  check('Có giờ chuẩn của máy chủ (GET /api/time)',
    time.status === 200 && Number.isFinite(Date.parse(time.data.now)), JSON.stringify(time.data));

  const original = (await call('/settings/storefront')).data.settings || {};
  check('Cài đặt công khai có danh sách cơ sở', Array.isArray(original.branches));

  const set = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin,
    body: { branches: [
      { name: 'Cơ sở thử 1', address: 'Số 1 đường Thử Nghiệm, phường Suối Hoa', phone: '+84 912 345 678' },
      { name: '', address: '', phone: '' },
      { name: '', address: 'Số 2 đường Thử Nghiệm, phường Ninh Xá', phone: '' },
    ] },
  });
  check('Lưu được các cơ sở, bỏ dòng trống, chuẩn hoá số điện thoại',
    set.status === 200 && set.data.settings?.branches?.length === 2
      && set.data.settings.branches[0].phone === '0912345678' && set.data.settings.branches[1].name === '',
    JSON.stringify(set.data).slice(0, 200));
  check('Khách thấy cơ sở mà không cần đăng nhập',
    (await call('/settings/storefront')).data.settings?.branches?.[0]?.name === 'Cơ sở thử 1');
  check('Đổi cơ sở không đụng tới banner và số tư vấn',
    JSON.stringify(set.data.settings.banner_images) === JSON.stringify(original.banner_images)
      && set.data.settings.contact_phone === original.contact_phone);

  const short = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin, body: { branches: [{ name: 'A', address: 'ngắn' }] },
  });
  check('Địa chỉ cơ sở quá ngắn bị từ chối (400)', short.status === 400 && !!short.data.errors?.branches);
  const badPhone = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin, body: { branches: [{ address: 'Số 3 đường Thử Nghiệm, phường Vệ An', phone: '123' }] },
  });
  check('Số điện thoại cơ sở sai bị từ chối (400)', badPhone.status === 400);
  const six = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin,
    body: { branches: Array.from({ length: 6 }, (_, i) => ({ address: `Số ${i + 10} đường Thử Nghiệm, phường Suối Hoa` })) },
  });
  check('Quá 5 cơ sở bị từ chối (400)', six.status === 400);
  const odd = await call('/admin/settings/storefront', {
    method: 'PUT', token: admin, body: { branches: [{ address: 'Số 4 đường Thử Nghiệm', map: 'x' }] },
  });
  check('Không nhận trường lạ trong cơ sở (400)', odd.status === 400);

  // Trả lại như trước khi thử.
  await call('/admin/settings/storefront', { method: 'PUT', token: admin, body: { branches: original.branches || [] } });
}

console.log(results.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
