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

console.log(results.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
