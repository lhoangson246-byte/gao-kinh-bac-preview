// Kiểm thử luồng API chính của Gạo Kinh Bắc.
// Cách chạy:  npm run test:smoke   (API phải đang chạy)
const BASE = process.env.BASE || 'http://localhost:4000';

let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name} ${detail}`); }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const suffix = Date.now();
const phoneOf = (n) => `09${String(suffix).slice(-7)}${n}`;

const customer = {
  full_name: 'Nguyễn Văn Test',
  email: `test${suffix}@example.com`,
  phone: phoneOf(1),
  password: 'matkhau123!test',
};

/* ---------- 1. Health ---------- */
{
  const r = await call('/health');
  check('GET /health trả ok', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
}

/* ---------- 2. Đăng ký ---------- */
let token;
{
  const r = await call('/auth/register', { method: 'POST', body: customer });
  if (r.status === 429) {
    console.error(
      'Đã chạm giới hạn tần suất đăng ký (20 lần / 15 phút).\n' +
      'Đây là hành vi đúng của API. Hãy khởi động lại API rồi chạy lại bộ kiểm thử.'
    );
    process.exit(2);
  }
  check('Đăng ký tạo tài khoản mới', r.status === 201 && !!r.data.token, JSON.stringify(r.data));
  check('Đăng ký không trả về password_hash', !JSON.stringify(r.data).includes('password_hash'));
  token = r.data.token;

  const dupEmail = await call('/auth/register', { method: 'POST', body: { ...customer, phone: phoneOf(2) } });
  check('Đăng ký trùng email bị từ chối (409)', dupEmail.status === 409, `status=${dupEmail.status}`);

  const dupPhone = await call('/auth/register', {
    method: 'POST', body: { ...customer, email: `khac${suffix}@example.com` },
  });
  check('Đăng ký trùng số điện thoại bị từ chối (409)', dupPhone.status === 409, `status=${dupPhone.status}`);

  const shortPw = await call('/auth/register', {
    method: 'POST', body: { full_name: 'A B', phone: phoneOf(3), password: '123' },
  });
  check('Mật khẩu ngắn bị từ chối (400)', shortPw.status === 400 && !!shortPw.data.errors?.password);
}

/* ---------- 3. Đăng ký chỉ bằng số điện thoại (không cần email) ---------- */
let phoneOnlyToken;
{
  const noEmail = { full_name: 'Trần Không Email', phone: phoneOf(4), password: 'matkhau123!test' };
  const r = await call('/auth/register', { method: 'POST', body: noEmail });
  check('Đăng ký KHÔNG cần email', r.status === 201 && !!r.data.token, JSON.stringify(r.data));
  check('Tài khoản không email có email = null', r.data.user?.email === null, JSON.stringify(r.data.user?.email));
  phoneOnlyToken = r.data.token;

  const login = await call('/auth/login', { method: 'POST', body: { identifier: noEmail.phone, password: noEmail.password } });
  check('Đăng nhập bằng SĐT cho tài khoản không email', login.status === 200 && !!login.data.token);

  const spaced = await call('/auth/login', {
    method: 'POST',
    body: { identifier: noEmail.phone.replace(/^(\d{4})(\d{3})/, '$1 $2 '), password: noEmail.password },
  });
  check('SĐT có dấu cách vẫn đăng nhập được', spaced.status === 200 && !!spaced.data.token);

  const plus84 = await call('/auth/login', {
    method: 'POST', body: { identifier: `+84${noEmail.phone.slice(1)}`, password: noEmail.password },
  });
  check('SĐT dạng +84 vẫn đăng nhập được', plus84.status === 200 && !!plus84.data.token);

  const clear = await call('/auth/me', { method: 'PUT', token: phoneOnlyToken, body: { phone: '' } });
  check('Không cho xoá SĐT khi đó là cách đăng nhập duy nhất (400)',
    clear.status === 400 && !!clear.data.errors?.phone);
}

/* ---------- 4. Đăng nhập ---------- */
{
  const byEmail = await call('/auth/login', { method: 'POST', body: { identifier: customer.email, password: customer.password } });
  check('Đăng nhập bằng email', byEmail.status === 200 && !!byEmail.data.token);
  token = byEmail.data.token || token;

  const byPhone = await call('/auth/login', { method: 'POST', body: { identifier: customer.phone, password: customer.password } });
  check('Đăng nhập bằng số điện thoại', byPhone.status === 200 && !!byPhone.data.token);

  const bad = await call('/auth/login', { method: 'POST', body: { identifier: customer.email, password: 'sai-mat-khau' } });
  check('Đăng nhập sai mật khẩu bị từ chối (401)', bad.status === 401);
}

/* ---------- 5. Đăng nhập quản trị ---------- */
let savedAddressId;
{
  const home = await call('/addresses', {
    method: 'POST', token,
    body: {
      label: 'Nhà riêng', receiver_name: 'Nguyễn Văn Test', phone: '0912345678',
      address: 'Số 1, đường Ngô Gia Tự, phường Tiền An',
    },
  });
  check('Thêm địa chỉ giao hàng đầu tiên (201)', home.status === 201, JSON.stringify(home.data));
  check('Địa chỉ đầu tiên tự là mặc định', home.data.address?.is_default === 1);
  savedAddressId = home.data.address?.id;

  const office = await call('/addresses', {
    method: 'POST', token,
    body: {
      label: 'Văn phòng', receiver_name: 'Nguyễn Văn Test', phone: '0912345678',
      address: 'Số 2, đường Lý Thái Tổ, phường Suối Hoa',
    },
  });
  check('Lưu được nhiều địa chỉ', office.status === 201 && office.data.addresses?.length === 2);

  const makeDefault = await call(`/addresses/${office.data.address.id}/default`, { method: 'PATCH', token });
  check('Đổi địa chỉ mặc định',
    makeDefault.status === 200 && makeDefault.data.addresses.filter((a) => a.is_default).length === 1
      && makeDefault.data.address?.id === office.data.address.id);

  const edit = await call(`/addresses/${savedAddressId}`, {
    method: 'PUT', token,
    body: {
      label: 'Nhà riêng', receiver_name: 'Nguyễn Văn Test', phone: '0912345678',
      address: 'Số 1, đường Ngô Gia Tự, phường Tiền An',
    },
  });
  check('Sửa địa chỉ đã lưu', edit.status === 200 && /Bắc Ninh$/.test(edit.data.address?.address || ''));
}

/* ---------- 5b. Đăng nhập quản trị ---------- */
const adminLogin = await call('/auth/login', {
  method: 'POST',
  body: {
    identifier: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
});
check('Đăng nhập tài khoản quản trị', adminLogin.status === 200 && adminLogin.data.user?.role === 'admin',
  JSON.stringify(adminLogin.data));
const adminToken = adminLogin.data.token;

/* ---------- 6. Sản phẩm ---------- */
let product;
{
  const r = await call('/products');
  check('GET /products trả danh sách', r.status === 200 && r.data.products.length > 0);

  // Gõ "%" phải được hiểu là chữ "%", không phải ký tự đại diện của SQL:
  // chỉ những sản phẩm thật sự chứa dấu "%" mới được trả về.
  const wildcard = await call('/products?q=%25');
  const hasPercent = (p) => `${p.name}${p.origin || ''}${p.description || ''}`.includes('%');
  check('Ký tự % không bị coi là ký tự đại diện',
    wildcard.data.products.length < r.data.products.length && wildcard.data.products.every(hasPercent),
    `trả về ${wildcard.data.products.length}/${r.data.products.length} sản phẩm`);

  // Danh mục thật được seed với giá 0 — tạo một sản phẩm có giá để kiểm thử mua hàng.
  const created = await call('/admin/products', {
    method: 'POST', token: adminToken,
    body: { name: `Gạo kiểm thử ${suffix}`, price: 25000, unit: 'túi 5kg', stock: 40,
            image_url: '/products/gao-thom-que-25kg.jpg' },
  });
  check('Admin thêm sản phẩm (201)', created.status === 201, JSON.stringify(created.data));
  check('Chấp nhận đường dẫn ảnh nội bộ', created.data.product?.image_url === '/products/gao-thom-que-25kg.jpg');
  product = created.data.product;

  const search = await call('/products?q=' + encodeURIComponent('kiểm thử'));
  check('Tìm kiếm sản phẩm hoạt động', search.status === 200 && search.data.products.length > 0);
}

const baseOrder = {
  receiver_name: 'Nguyễn Văn Test',
  phone: '0912345678',
  address: 'Số 1, đường Ngô Gia Tự, phường Tiền An',
  delivery_area: 'bac-ninh',
  delivery_slot: 'sang',
  payment_method: 'cod',
};

/* ---------- 7. Sản phẩm chưa có giá thì không đặt được ---------- */
{
  const all = await call('/admin/products', { token: adminToken });
  const unpriced = all.data.products.find((p) => p.price <= 0);
  check('Danh mục thật được seed chưa có giá', !!unpriced);
  if (unpriced) {
    const r = await call('/orders', {
      method: 'POST', token,
      body: { ...baseOrder, items: [{ product_id: unpriced.id, quantity: 1 }] },
    });
    check('Không đặt được loại gạo chưa có giá (400)', r.status === 400, `status=${r.status}`);
  }
}

/* ---------- 8. Phân quyền ---------- */
{
  const r = await call('/orders', { method: 'POST', body: { items: [] } });
  check('Tạo đơn khi chưa đăng nhập bị chặn (401)', r.status === 401);
  check('API quản trị chặn khách vãng lai (401)', (await call('/admin/orders')).status === 401);
  check('Khách thường không vào được API quản trị (403)', (await call('/admin/orders', { token })).status === 403);
}

/* ---------- 9. Giới hạn khu vực Bắc Ninh ---------- */
{
  const outside = await call('/orders', {
    method: 'POST', token,
    body: { ...baseOrder, delivery_area: 'ha-noi', items: [{ product_id: product.id, quantity: 1 }] },
  });
  check('Đơn ngoài khu vực bị từ chối (400)', outside.status === 400 && !!outside.data.errors?.delivery_area);

  const hanoiText = await call('/orders', {
    method: 'POST', token,
    body: { ...baseOrder, address: 'Số 5, phố Bà Triệu, quận Hoàn Kiếm, Hà Nội', items: [{ product_id: product.id, quantity: 1 }] },
  });
  check('Địa chỉ ghi tỉnh khác bị từ chối (400)', hanoiText.status === 400 && !!hanoiText.data.errors?.address);
}

/* ---------- 9b. Khung giờ giao hàng ---------- */
{
  const bad = await call('/orders', {
    method: 'POST', token,
    body: { ...baseOrder, delivery_slot: 'nua-dem', items: [{ product_id: product.id, quantity: 1 }] },
  });
  check('Khung giờ giao không hợp lệ bị từ chối (400)',
    bad.status === 400 && !!bad.data.errors?.delivery_slot, `status=${bad.status}`);

  const none = await call('/orders', {
    method: 'POST', token,
    body: { ...baseOrder, delivery_slot: undefined, items: [{ product_id: product.id, quantity: 1 }] },
  });
  check('Không chọn khung giờ vẫn đặt được', none.status === 201, `status=${none.status}`);
  if (none.data.order) await call(`/orders/${none.data.order.id}/cancel`, { method: 'PATCH', token });
}

/* ---------- 10. Tạo đơn — máy chủ tự tính tổng tiền ---------- */
const stockBefore = product.stock;
let orderId;
{
  const tampered = await call('/orders', {
    method: 'POST', token,
    body: { ...baseOrder, total: 1, items: [{ product_id: product.id, quantity: 2, price: 1 }] },
  });
  check('Giá và tổng tiền do client gửi bị từ chối (400)', tampered.status === 400);
  const r = await call('/orders', {
    method: 'POST', token,
    body: {
      ...baseOrder, address_id: savedAddressId,
      receiver_name: 'Dữ liệu giả', phone: '000', address: 'Hà Nội',
      items: [{ product_id: product.id, quantity: 2 }],
    },
  });
  check('Tạo đơn thành công (201)', r.status === 201, JSON.stringify(r.data));
  check('Đơn lấy người nhận từ địa chỉ đã chọn',
    r.data.order?.receiver_name === 'Nguyễn Văn Test' && r.data.order?.phone === '0912345678');
  orderId = r.data.order?.id;
  check('Tổng tiền do máy chủ tính từ giá trong cơ sở dữ liệu',
    r.data.order?.total === product.price * 2, `nhận ${r.data.order?.total}, cần ${product.price * 2}`);
  check('Địa chỉ được chuẩn hoá kèm "Bắc Ninh"', /Bắc Ninh$/.test(r.data.order?.address || ''), r.data.order?.address);
  check('Khung giờ giao được lưu vào đơn', r.data.order?.delivery_slot === 'sang',
    JSON.stringify(r.data.order?.delivery_slot));

  const after = await call(`/products/${product.id}`);
  check('Tồn kho bị trừ đúng 2', after.data.product.stock === stockBefore - 2,
    `${after.data.product.stock} vs ${stockBefore - 2}`);

  // Giá nhập là thông tin nội bộ của cửa hàng, khách không được thấy.
  const mine = await call('/orders', { token });
  check('Đơn của khách KHÔNG lộ giá nhập (cost_price)',
    !JSON.stringify(mine.data).includes('cost_price'));
  const detail = await call(`/orders/${orderId}`, { token });
  check('Chi tiết đơn KHÔNG lộ giá nhập (cost_price)',
    detail.status === 200 && !JSON.stringify(detail.data).includes('cost_price'),
    `status=${detail.status}`);
}

/* ---------- 11. Gộp dòng trùng và chặn vượt kho ---------- */
{
  const r = await call('/orders', {
    method: 'POST', token,
    body: { ...baseOrder, items: [{ product_id: product.id, quantity: 1 }, { product_id: product.id, quantity: 1 }] },
  });
  check('Dòng trùng sản phẩm được gộp thành 1', r.data.order?.items?.length === 1);
  check('Số lượng gộp đúng bằng 2', r.data.order?.items?.[0]?.quantity === 2);
  await call(`/orders/${r.data.order.id}/cancel`, { method: 'PATCH', token });

  const over = await call('/orders', {
    method: 'POST', token,
    body: { ...baseOrder, items: [{ product_id: product.id, quantity: 999999 }] },
  });
  check('Đặt vượt tồn kho bị từ chối (400)', over.status === 400, `status=${over.status}`);
}

/* ---------- 12. Khách không xem/huỷ được đơn của người khác ---------- */
{
  const other = { full_name: 'Trần Thị B', phone: phoneOf(5), password: 'matkhau123!test' };
  const reg = await call('/auth/register', { method: 'POST', body: other });
  check('Khách khác không xem được đơn (404)', (await call(`/orders/${orderId}`, { token: reg.data.token })).status === 404);
  check('Khách khác không huỷ được đơn (404)',
    (await call(`/orders/${orderId}/cancel`, { method: 'PATCH', token: reg.data.token })).status === 404);
  const stealAddress = await call(`/addresses/${savedAddressId}`, {
    method: 'PUT', token: reg.data.token,
    body: { label: 'Khác', receiver_name: 'Người khác', phone: '0912345678', address: 'Số 3, phường Tiền An' },
  });
  check('Khách khác không sửa được địa chỉ (404)', stealAddress.status === 404);
}

/* ---------- 13. Quy trình xử lý đơn của admin ---------- */
{
  const stats = await call('/admin/stats', { token: adminToken });
  check('GET /admin/stats hoạt động', stats.status === 200 && typeof stats.data.stats.revenue === 'number');
  check('Thống kê đếm được sản phẩm chưa có giá', stats.data.stats.missingPrice > 0,
    `missingPrice=${stats.data.stats.missingPrice}`);

  const bad = await call(`/admin/orders/${orderId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'completed' } });
  check('Không thể nhảy thẳng pending → completed (400)', bad.status === 400);

  const c1 = await call(`/admin/orders/${orderId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'confirmed' } });
  check('Chờ xác nhận → Đã xác nhận', c1.status === 200 && c1.data.order.status === 'confirmed');
  const c2 = await call(`/admin/orders/${orderId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'shipping' } });
  check('Đã xác nhận → Đang giao', c2.data.order?.status === 'shipping');

  check('Khách không huỷ được đơn đang giao (400)',
    (await call(`/orders/${orderId}/cancel`, { method: 'PATCH', token })).status === 400);

  const c3 = await call(`/admin/orders/${orderId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'completed' } });
  check('Đang giao → Hoàn thành', c3.data.order?.status === 'completed');

  const afterDone = await call(`/products/${product.id}`);
  check('Đơn hoàn thành KHÔNG hoàn kho', afterDone.data.product.stock === stockBefore - 2);

  const stats2 = await call('/admin/stats', { token: adminToken });
  check('Doanh thu tính đơn đã hoàn thành', stats2.data.stats.revenue >= product.price * 2);
}

/* ---------- 14. Huỷ đơn hoàn kho đúng một lần ---------- */
{
  const created = await call('/orders', {
    method: 'POST', token, body: { ...baseOrder, items: [{ product_id: product.id, quantity: 3 }] },
  });
  const id = created.data.order.id;
  const before = (await call(`/products/${product.id}`)).data.product.stock;
  const [a, b] = await Promise.all([
    call(`/admin/orders/${id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'cancelled' } }),
    call(`/admin/orders/${id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'cancelled' } }),
  ]);
  check('Hai lệnh admin huỷ song song chỉ 1 lệnh thành công',
    [a, b].filter((r) => r.status === 200).length === 1, `${a.status}/${b.status}`);
  check('Admin huỷ đơn hoàn kho đúng 1 lần',
    (await call(`/products/${product.id}`)).data.product.stock === before + 3);
}
{
  const created = await call('/orders', {
    method: 'POST', token, body: { ...baseOrder, items: [{ product_id: product.id, quantity: 4 }] },
  });
  const id = created.data.order.id;
  const before = (await call(`/products/${product.id}`)).data.product.stock;
  const [a, b] = await Promise.all([
    call(`/orders/${id}/cancel`, { method: 'PATCH', token }),
    call(`/orders/${id}/cancel`, { method: 'PATCH', token }),
  ]);
  check('Khách bấm huỷ 2 lần chỉ thành công 1',
    [a, b].filter((r) => r.status === 200).length === 1, `${a.status}/${b.status}`);
  check('Khách huỷ đơn hoàn kho đúng 1 lần',
    (await call(`/products/${product.id}`)).data.product.stock === before + 4);
}

/* ---------- 15. Không bán vượt kho khi đặt đồng thời ---------- */
{
  const created = await call('/admin/products', {
    method: 'POST', token: adminToken,
    body: { name: `Gạo tồn ít ${suffix}`, price: 10000, unit: 'túi 5kg', stock: 5 },
  });
  const testId = created.data.product.id;
  const attempts = await Promise.all([1, 2, 3, 4].map(() =>
    call('/orders', { method: 'POST', token, body: { ...baseOrder, items: [{ product_id: testId, quantity: 3 }] } })
  ));
  const ok = attempts.filter((r) => r.status === 201).length;
  const stockNow = (await call(`/products/${testId}`)).data.product.stock;
  check('Đặt đồng thời không bán vượt kho', ok === 1 && stockNow >= 0,
    `thành công ${ok}, tồn kho còn ${stockNow}`);
}

/* ---------- 16. Kiểm tra dữ liệu sản phẩm ---------- */
{
  const neg = await call('/admin/products', { method: 'POST', token: adminToken, body: { name: 'Gạo lỗi', price: -1 } });
  check('Giá âm bị từ chối (400)', neg.status === 400);
  const nan = await call('/admin/products', { method: 'POST', token: adminToken, body: { name: 'Gạo lỗi', price: 'abc' } });
  check('Giá không phải số bị từ chối (400)', nan.status === 400);
  const negStock = await call(`/admin/products/${product.id}`, { method: 'PUT', token: adminToken, body: { stock: -5 } });
  check('Tồn kho âm bị từ chối (400)', negStock.status === 400);
  const badImg = await call(`/admin/products/${product.id}`, { method: 'PUT', token: adminToken, body: { image_url: 'javascript:alert(1)' } });
  check('URL ảnh nguy hiểm bị từ chối (400)', badImg.status === 400);
  const protoRel = await call(`/admin/products/${product.id}`, { method: 'PUT', token: adminToken, body: { image_url: '//evil.example/x.jpg' } });
  check('Đường dẫn //tên-miền-khác bị từ chối (400)', protoRel.status === 400);

  await call(`/admin/products/${product.id}`, { method: 'PUT', token: adminToken, body: { description: 'Mô tả gốc' } });
  await call(`/admin/products/${product.id}`, { method: 'PUT', token: adminToken, body: { price: 12000 } });
  const edited = (await call(`/products/${product.id}`)).data.product;
  check('Sửa giá không làm mất mô tả', edited.description === 'Mô tả gốc' && edited.price === 12000);
}

/* ---------- 17. Ẩn và mở bán lại (soft delete) ---------- */
{
  await call(`/admin/products/${product.id}`, { method: 'DELETE', token: adminToken });
  check('Sản phẩm bị ẩn không hiện với khách (404)', (await call(`/products/${product.id}`)).status === 404);
  const adminSees = await call('/admin/products', { token: adminToken });
  check('Admin vẫn thấy sản phẩm đã ẩn',
    adminSees.data.products.some((p) => p.id === product.id && p.is_active === 0));
  const orders = await call('/admin/orders', { token: adminToken });
  check('Đơn cũ vẫn giữ tên sản phẩm đã ẩn',
    orders.data.orders.some((o) => o.items.some((i) => i.product_name.includes('Gạo kiểm thử'))));
  await call(`/admin/products/${product.id}`, { method: 'PUT', token: adminToken, body: { is_active: 1 } });
  check('Mở bán lại sản phẩm đã ẩn', (await call(`/products/${product.id}`)).status === 200);
}

/* ---------- 18. Hồ sơ cá nhân ---------- */
{
  const r = await call('/auth/me', { method: 'PUT', token, body: { address: 'Thôn A, xã B' } });
  check('Cập nhật hồ sơ thành công', r.status === 200 && r.data.user.address === 'Thôn A, xã B');
  const clear = await call('/auth/me', { method: 'PUT', token, body: { address: '' } });
  check('Xoá được địa chỉ mặc định', clear.data.user.address === null);
  const badPhone = await call('/auth/me', { method: 'PUT', token, body: { phone: '123' } });
  check('SĐT sai định dạng bị từ chối (400)', badPhone.status === 400);
  const takenPhone = await call('/auth/me', { method: 'PUT', token, body: { phone: phoneOf(4) } });
  check('Không nhận SĐT đã thuộc tài khoản khác (400)', takenPhone.status === 400);
  check('/auth/me không lộ password_hash', !JSON.stringify((await call('/auth/me', { token })).data).includes('password_hash'));
}

/* ---------- 19. Lọc đơn theo trạng thái ---------- */
{
  const r = await call('/admin/orders?status=cancelled', { token: adminToken });
  check('Lọc đơn theo trạng thái hoạt động',
    r.status === 200 && r.data.orders.every((o) => o.status === 'cancelled'));
  check('Trạng thái lọc không hợp lệ bị từ chối (400)',
    (await call('/admin/orders?status=khong-ton-tai', { token: adminToken })).status === 400);
}

console.log(results.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
