// Kiểm thử hệ thống bán lẻ tại quầy: tích điểm, giảm giá theo bậc, tra cứu hoá đơn.
// Cách chạy:  npm run test:retail   (API phải đang chạy)
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
const phone = `09${String(suffix).slice(-8)}`;

/* ---------- Đăng nhập quản trị ---------- */
const login = await call('/auth/login', {
  method: 'POST',
  body: {
    identifier: process.env.ADMIN_EMAIL || 'admin@gaokinhbac.vn',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
});
if (login.status === 429) {
  console.error('Đã chạm giới hạn tần suất đăng nhập. Khởi động lại API rồi chạy lại.');
  process.exit(2);
}
check('Đăng nhập quản trị', login.status === 200 && login.data.user?.role === 'admin');
const admin = login.data.token;

/* ---------- Phân quyền ---------- */
{
  check('Khách vãng lai không vào được API bán lẻ (401)',
    (await call('/retail/invoices')).status === 401);

  const cust = { full_name: 'Khách Thường', phone: `09${String(suffix).slice(-7)}7`, password: 'matkhau123' };
  const reg = await call('/auth/register', { method: 'POST', body: cust });
  if (reg.status === 201) {
    check('Khách thường không vào được API bán lẻ (403)',
      (await call('/retail/invoices', { token: reg.data.token })).status === 403);
  } else {
    check('Khách thường không vào được API bán lẻ (403)', false, `đăng ký lỗi ${reg.status}`);
  }
}

/* ---------- Chính sách ---------- */
{
  const r = await call('/retail/policy', { token: admin });
  check('Lấy được chính sách giảm giá', r.status === 200 && r.data.policy.tiers.length === 2);
  check('Mốc giảm đúng: 500k→20k, 300k→10k',
    r.data.policy.tiers[0].minSubtotal === 500000 && r.data.policy.tiers[0].discount === 20000 &&
    r.data.policy.tiers[1].minSubtotal === 300000 && r.data.policy.tiers[1].discount === 10000,
    JSON.stringify(r.data.policy.tiers));
}

/* ---------- Chuẩn bị sản phẩm để bán ---------- */
const products = (await call('/products')).data.products.filter((p) => p.price > 0);
const p150 = products.find((p) => p.price === 150000);   // Gạo ST25 – Gạo sạch
const p35 = products.find((p) => p.price === 35000);     // Gạo nếp / gạo lứt
check('Có sản phẩm để bán tại quầy', !!p150 && !!p35);

/* ---------- Khách mới ---------- */
{
  const r = await call(`/retail/customers?phone=${phone}`, { token: admin });
  check('Tra số điện thoại chưa mua bao giờ → báo khách mới',
    r.status === 200 && r.data.customer === null && r.data.isNew === true);

  const bad = await call('/retail/customers?phone=123', { token: admin });
  check('SĐT sai định dạng bị từ chối (400)', bad.status === 400);
}

/* ---------- Hoá đơn dưới 300k: không giảm ---------- */
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, full_name: 'Cô Lan', items: [{ product_id: p35.id, quantity: 2 }] },
  });
  const inv = r.data.invoice;
  check('Tạo hoá đơn (201)', r.status === 201, JSON.stringify(r.data));
  check('Hoá đơn 70.000₫ không được giảm', inv?.subtotal === 70000 && inv?.discount === 0 && inv?.total === 70000,
    JSON.stringify({ s: inv?.subtotal, d: inv?.discount, t: inv?.total }));
  check('Điểm tích = 70 (1.000₫ = 1 điểm)', inv?.points_earned === 70, String(inv?.points_earned));
  check('Hoá đơn có mã dạng HD……', /^HD\d{6}$/.test(inv?.code || ''), inv?.code);
  check('Khách mới được tạo kèm tên', r.data.customer?.full_name === 'Cô Lan' && r.data.customer?.points === 70);
}

/* ---------- Hoá đơn 300k–499k: giảm 10k ---------- */
let invoice10k;
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, items: [{ product_id: p150.id, quantity: 2 }, { product_id: p35.id, quantity: 2 }] },
  });
  invoice10k = r.data.invoice;
  check('Hoá đơn 370.000₫ được giảm 10.000₫',
    invoice10k?.subtotal === 370000 && invoice10k?.discount === 10000 && invoice10k?.total === 360000,
    JSON.stringify({ s: invoice10k?.subtotal, d: invoice10k?.discount, t: invoice10k?.total }));
  check('Điểm tính trên số tiền thực trả (360)', invoice10k?.points_earned === 360, String(invoice10k?.points_earned));
  check('Điểm cộng dồn vào khách cũ (70 + 360 = 430)', r.data.customer?.points === 430, String(r.data.customer?.points));
  check('Số lần mua tăng lên 2', r.data.customer?.visit_count === 2, String(r.data.customer?.visit_count));
}

/* ---------- Hoá đơn từ 500k: giảm 20k ---------- */
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, items: [{ product_id: p150.id, quantity: 4 }] },
  });
  const inv = r.data.invoice;
  check('Hoá đơn 600.000₫ được giảm 20.000₫',
    inv?.subtotal === 600000 && inv?.discount === 20000 && inv?.total === 580000,
    JSON.stringify({ s: inv?.subtotal, d: inv?.discount, t: inv?.total }));
}

/* ---------- Đúng mốc 300k và 500k ---------- */
{
  const exact300 = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p150.id, quantity: 2 }] },   // 300.000₫
  });
  check('Đúng 300.000₫ được giảm 10.000₫', exact300.data.invoice?.discount === 10000,
    String(exact300.data.invoice?.discount));

  const p50 = products.find((p) => p.price === 50000);
  if (p50) {
    const exact500 = await call('/retail/invoices', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: p150.id, quantity: 3 }, { product_id: p50.id, quantity: 1 }] }, // 500.000₫
    });
    check('Đúng 500.000₫ được giảm 20.000₫', exact500.data.invoice?.discount === 20000,
      String(exact500.data.invoice?.discount));
  } else {
    check('Đúng 500.000₫ được giảm 20.000₫', false, 'không tìm được sản phẩm 50.000₫');
  }
}

/* ---------- Khách vãng lai: không số điện thoại thì không tích điểm ---------- */
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p35.id, quantity: 1 }] },
  });
  check('Bán cho khách vãng lai không cần SĐT', r.status === 201, JSON.stringify(r.data));
  check('Khách không SĐT thì không tích điểm', r.data.invoice?.points_earned === 0 && r.data.customer === null);
}

/* ---------- Máy chủ tự tính tiền, không tin trình duyệt ---------- */
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: {
      items: [{ product_id: p35.id, quantity: 1, price: 1 }],
      subtotal: 1, discount: 999999, total: 1, points_earned: 99999,
    },
  });
  const inv = r.data.invoice;
  check('Bỏ qua giá/giảm giá/điểm do trình duyệt gửi',
    inv?.subtotal === 35000 && inv?.discount === 0 && inv?.total === 35000 && inv?.points_earned === 0,
    JSON.stringify({ s: inv?.subtotal, d: inv?.discount, t: inv?.total, p: inv?.points_earned }));
}

/* ---------- Kiểm tra dữ liệu đầu vào ---------- */
{
  check('Hoá đơn rỗng bị từ chối (400)',
    (await call('/retail/invoices', { method: 'POST', token: admin, body: { items: [] } })).status === 400);
  check('Số lượng 0 bị từ chối (400)',
    (await call('/retail/invoices', { method: 'POST', token: admin,
      body: { items: [{ product_id: p35.id, quantity: 0 }] } })).status === 400);
  check('Sản phẩm không tồn tại bị từ chối (400)',
    (await call('/retail/invoices', { method: 'POST', token: admin,
      body: { items: [{ product_id: 999999, quantity: 1 }] } })).status === 400);
  check('Hình thức thanh toán lạ bị từ chối (400)',
    (await call('/retail/invoices', { method: 'POST', token: admin,
      body: { items: [{ product_id: p35.id, quantity: 1 }], payment_method: 'bitcoin' } })).status === 400);

  const unpriced = (await call('/admin/products', { token: admin })).data.products.find((p) => p.price <= 0);
  if (unpriced) {
    check('Không bán được loại chưa có giá (400)',
      (await call('/retail/invoices', { method: 'POST', token: admin,
        body: { items: [{ product_id: unpriced.id, quantity: 1 }] } })).status === 400);
  }

  const dup = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p35.id, quantity: 1 }, { product_id: p35.id, quantity: 2 }] },
  });
  check('Dòng trùng sản phẩm được gộp thành 1', dup.data.invoice?.items?.length === 1);
  check('Số lượng gộp đúng bằng 3', dup.data.invoice?.items?.[0]?.quantity === 3);
}

/* ---------- Tồn kho KHÔNG bị trừ (theo yêu cầu tách riêng) ---------- */
{
  const before = (await call(`/products/${p35.id}`)).data.product.stock;
  await call('/retail/invoices', {
    method: 'POST', token: admin, body: { items: [{ product_id: p35.id, quantity: 3 }] },
  });
  const after = (await call(`/products/${p35.id}`)).data.product.stock;
  check('Bán tại quầy KHÔNG trừ tồn kho của web', after === before, `${before} -> ${after}`);
}

/* ---------- Tra cứu khách theo số điện thoại ---------- */
{
  const r = await call(`/retail/customers?phone=${phone}`, { token: admin });
  check('Tra cứu khách theo SĐT trả về hồ sơ', r.status === 200 && r.data.customer?.phone === phone);
  check('Hồ sơ có điểm tích luỹ', r.data.customer?.points > 0, String(r.data.customer?.points));
  check('Tra cứu kèm lịch sử hoá đơn', r.data.invoices.length >= 3, String(r.data.invoices.length));
  check('Hoá đơn trong lịch sử có chi tiết sản phẩm', Array.isArray(r.data.invoices[0]?.items));

  const spaced = await call(`/retail/customers?phone=${encodeURIComponent('+84' + phone.slice(1))}`, { token: admin });
  check('Tra bằng SĐT dạng +84 vẫn ra đúng khách', spaced.data.customer?.phone === phone);
}

/* ---------- Sửa tên khách quen ---------- */
{
  const cust = (await call(`/retail/customers?phone=${phone}`, { token: admin })).data.customer;
  const r = await call(`/retail/customers/${cust.id}`, {
    method: 'PUT', token: admin, body: { full_name: 'Cô Lan (ngõ chợ)', note: 'Hay mua ST25' },
  });
  check('Sửa được tên và ghi chú khách quen',
    r.status === 200 && r.data.customer.full_name === 'Cô Lan (ngõ chợ)' && r.data.customer.note === 'Hay mua ST25');
  check('Sửa tên không làm mất điểm', r.data.customer.points === cust.points);
}

/* ---------- Tra cứu hoá đơn cũ ---------- */
{
  const byCode = await call(`/retail/invoices?q=${invoice10k.code}`, { token: admin });
  check('Tra hoá đơn theo mã HD', byCode.data.invoices.length === 1 && byCode.data.invoices[0].code === invoice10k.code);

  const byNumber = await call(`/retail/invoices?q=${invoice10k.id}`, { token: admin });
  check('Tra hoá đơn theo số (không cần gõ HD)',
    byNumber.data.invoices.some((i) => i.code === invoice10k.code));

  const byPhone = await call(`/retail/invoices?q=${phone}`, { token: admin });
  check('Tra hoá đơn theo số điện thoại', byPhone.data.invoices.length >= 3, String(byPhone.data.invoices.length));

  const byName = await call(`/retail/invoices?q=${encodeURIComponent('Cô Lan')}`, { token: admin });
  check('Tra hoá đơn theo tên khách', byName.data.invoices.length >= 1, String(byName.data.invoices.length));

  const detail = await call(`/retail/invoices/${invoice10k.code}`, { token: admin });
  check('Mở lại hoá đơn cũ bằng mã', detail.status === 200 && detail.data.invoice.id === invoice10k.id);
  check('Hoá đơn cũ giữ nguyên tên và giá lúc bán',
    detail.data.invoice.items.every((i) => i.product_name && i.price > 0));

  const today = new Date().toISOString().slice(0, 10);
  const byDate = await call(`/retail/invoices?from=${today}&to=${today}`, { token: admin });
  check('Lọc hoá đơn theo ngày', byDate.data.invoices.length >= 3, String(byDate.data.invoices.length));

  const oldDay = await call('/retail/invoices?from=2000-01-01&to=2000-01-02', { token: admin });
  check('Lọc ngày không có hoá đơn trả về rỗng', oldDay.data.invoices.length === 0);

  const badDate = await call('/retail/invoices?from=hom-qua', { token: admin });
  check('Ngày sai định dạng bị từ chối (400)', badDate.status === 400);

  const notFound = await call('/retail/invoices/999999', { token: admin });
  check('Hoá đơn không tồn tại trả 404', notFound.status === 404);

  const page = await call('/retail/invoices?limit=2', { token: admin });
  check('Phân trang hoạt động', page.data.invoices.length === 2 && page.data.total > 2,
    JSON.stringify({ n: page.data.invoices.length, total: page.data.total }));
}

/* ---------- Thống kê ---------- */
{
  const r = await call('/retail/stats', { token: admin });
  check('Thống kê bán lẻ hoạt động',
    r.status === 200 && r.data.stats.todayInvoices > 0 && r.data.stats.todayRevenue > 0,
    JSON.stringify(r.data.stats));
  check('Thống kê đếm được khách quen', r.data.stats.customers >= 1);
}

console.log(results.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
