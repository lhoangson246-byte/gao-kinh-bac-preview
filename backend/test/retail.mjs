// Kiểm thử hệ thống bán lẻ tại quầy: tích điểm, giảm giá theo khối lượng, tra cứu hoá đơn.
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

/* ---------- Phân quyền ---------- */
{
  check('Khách vãng lai không vào được API bán lẻ (401)',
    (await call('/retail/invoices')).status === 401);

  const cust = { full_name: 'Khách Thường', phone: `09${String(suffix).slice(-7)}7`, password: 'matkhau123!test' };
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
  check('Lấy được chính sách tại quầy', r.status === 200 && !!r.data.policy);
  check('Chính sách nêu mốc 50kg mới được giảm',
    r.data.policy.minKgForDiscount === 50, String(r.data.policy.minKgForDiscount));
  check('Chính sách nêu trần phần trăm giảm',
    r.data.policy.maxDiscountPercent === 50, String(r.data.policy.maxDiscountPercent));
  check('Không còn giảm giá tự động theo mốc tiền', r.data.policy.tiers === undefined);
}

/* ---------- Chuẩn bị sản phẩm để bán ---------- */
const products = (await call('/products')).data.products.filter((p) => p.price > 0);
const p145 = products.find((p) => p.image_url === '/products/lvs-gao-sach-st25-5kg.jpg');
const p150 = products.find((p) => p.price === 150000);
const p35 = products.find((p) => p.price === 35000);     // Gạo nếp / gạo lứt
check('Gạo ST25 LVS túi 5kg đã giảm còn 145.000₫', p145?.price === 145000, String(p145?.price));
check('Có sản phẩm để bán tại quầy', !!p145 && !!p150 && !!p35);

/* ---------- Khách mới ---------- */
{
  const r = await call(`/retail/customers?phone=${phone}`, { token: admin });
  check('Tra số điện thoại chưa mua bao giờ → báo khách mới',
    r.status === 200 && r.data.customer === null && r.data.isNew === true);

  const bad = await call('/retail/customers?phone=123', { token: admin });
  check('SĐT sai định dạng bị từ chối (400)', bad.status === 400);
}

/* ---------- Hoá đơn nhỏ: không giảm ---------- */
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

/* ---------- Hoá đơn to tiền nhưng chưa đủ 50kg: vẫn không giảm ---------- */
let invoice10k;
{
  // 2 túi 5kg + 2 túi 1kg = 360.000₫ nhưng mới 12kg.
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, items: [{ product_id: p145.id, quantity: 2 }, { product_id: p35.id, quantity: 2 }] },
  });
  invoice10k = r.data.invoice;
  check('Hoá đơn 360.000₫ nhưng mới 12kg thì không được giảm',
    invoice10k?.subtotal === 360000 && invoice10k?.discount === 0 && invoice10k?.total === 360000,
    JSON.stringify({ s: invoice10k?.subtotal, d: invoice10k?.discount, t: invoice10k?.total }));
  check('Hoá đơn ghi lại tổng khối lượng', invoice10k?.total_kg === 12, String(invoice10k?.total_kg));
  check('Điểm tính trên số tiền thực trả (360)', invoice10k?.points_earned === 360, String(invoice10k?.points_earned));
  check('Điểm cộng dồn vào khách cũ (70 + 360 = 430)', r.data.customer?.points === 430, String(r.data.customer?.points));
  check('Số lần mua tăng lên 2', r.data.customer?.visit_count === 2, String(r.data.customer?.visit_count));
}

/* ---------- Chưa đủ 50kg mà nhập % giảm thì bị từ chối ---------- */
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p145.id, quantity: 4 }], discount_percent: 10 },   // 20kg
  });
  check('Chưa đủ 50kg mà nhập % giảm bị từ chối (400)', r.status === 400, `status=${r.status}`);
  check('Báo lỗi nói rõ mốc 50kg', /50kg/.test(r.data.message || ''), r.data.message);
}

/* ---------- Từ 50kg: giảm theo phần trăm cửa hàng nhập ---------- */
{
  // 10 túi 5kg = 50kg, 1.450.000₫; giảm 10% = 145.000₫.
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone, items: [{ product_id: p145.id, quantity: 10 }], discount_percent: 10 },
  });
  const inv = r.data.invoice;
  check('Hoá đơn đủ 50kg được giảm theo % (201)', r.status === 201, JSON.stringify(r.data).slice(0, 200));
  check('Giảm 10% của 1.450.000₫ = 145.000₫',
    inv?.subtotal === 1450000 && inv?.discount === 145000 && inv?.total === 1305000,
    JSON.stringify({ s: inv?.subtotal, d: inv?.discount, t: inv?.total }));
  check('Hoá đơn lưu lại mức phần trăm đã giảm', inv?.discount_percent === 10, String(inv?.discount_percent));
  check('Hoá đơn lưu lại 50kg', inv?.total_kg === 50, String(inv?.total_kg));
  check('Điểm tính trên số tiền sau giảm (1305)', inv?.points_earned === 1305, String(inv?.points_earned));
}

/* ---------- Đủ 50kg nhưng không nhập % thì không giảm ---------- */
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p145.id, quantity: 10 }] },
  });
  check('Đủ 50kg nhưng không nhập % thì không giảm',
    r.data.invoice?.discount === 0 && r.data.invoice?.discount_percent === 0,
    JSON.stringify({ d: r.data.invoice?.discount, p: r.data.invoice?.discount_percent }));
}

/* ---------- Phần trăm vượt trần bị từ chối ---------- */
{
  const r = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p145.id, quantity: 10 }], discount_percent: 80 },
  });
  check('Mức giảm vượt trần bị từ chối (400)', r.status === 400, `status=${r.status}`);

  const neg = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p145.id, quantity: 10 }], discount_percent: -5 },
  });
  check('Mức giảm âm bị từ chối (400)', neg.status === 400, `status=${neg.status}`);
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
  check('Từ chối giá/giảm giá/điểm do trình duyệt gửi (400)', r.status === 400);
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

/* ---------- Đổi / trả hàng ---------- */
{
  const item = invoice10k.items[0];
  const created = await call('/retail/returns', {
    method: 'POST', token: admin,
    body: {
      invoice_id: invoice10k.id,
      return_type: 'exchange',
      reason: 'Túi bị rách khi giao',
      note: 'Đổi túi mới cùng loại',
      items: [{ invoice_item_id: item.id, quantity: 1 }],
    },
  });
  check('Lưu phiếu đổi hàng (201)', created.status === 201, JSON.stringify(created.data));
  check('Phiếu đổi hàng có mã DT……', /^DT\d{6}$/.test(created.data.return?.code || ''));
  check('Phiếu giữ liên kết tới hoá đơn cũ', created.data.return?.invoice_code === invoice10k.code);

  const over = await call('/retail/returns', {
    method: 'POST', token: admin,
    body: {
      invoice_id: invoice10k.id,
      return_type: 'return', reason: 'Khách đổi ý', refund_amount: 1000,
      items: [{ invoice_item_id: item.id, quantity: item.quantity }],
    },
  });
  check('Không thể đổi/trả quá số lượng đã mua (400)', over.status === 400, `status=${over.status}`);

  const list = await call('/retail/returns', { token: admin });
  check('Xem được lịch sử đổi trả', list.status === 200 && list.data.returns.some((r) => r.invoice_code === invoice10k.code));
  check('Khách thường không xem được phiếu đổi trả (401)', (await call('/retail/returns')).status === 401);
}

/* ---------- Thống kê ---------- */
{
  const r = await call('/retail/stats', { token: admin });
  check('Thống kê bán lẻ hoạt động',
    r.status === 200 && r.data.stats.todayInvoices > 0 && r.data.stats.todayRevenue > 0,
    JSON.stringify(r.data.stats));
  check('Thống kê đếm được khách quen', r.data.stats.customers >= 1);
}

/* ---------- Báo cáo doanh thu lọc theo ngày / tháng ---------- */
{
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const month = today.slice(0, 7);

  const day = await call(`/admin/revenue?period=day&date=${today}`, { token: admin });
  check('Doanh thu lọc theo ngày hoạt động', day.status === 200 && day.data.period.type === 'day',
    JSON.stringify(day.data.period));
  check('Doanh thu hôm nay gồm hoá đơn vừa tạo', day.data.retail.revenue > 0,
    String(day.data.retail?.revenue));
  check('Tổng = online + tại quầy',
    day.data.total.revenue === day.data.online.revenue + day.data.retail.revenue);

  const mon = await call(`/admin/revenue?period=month&month=${month}`, { token: admin });
  check('Doanh thu lọc theo tháng hoạt động', mon.status === 200 && mon.data.period.type === 'month');
  check('Doanh thu tháng >= doanh thu ngày', mon.data.total.revenue >= day.data.total.revenue,
    `${mon.data.total.revenue} vs ${day.data.total.revenue}`);
  check('Kỳ tháng bắt đầu từ ngày 01', mon.data.period.from === `${month}-01`, mon.data.period.from);

  const range = await call(`/admin/revenue?period=range&from=${month}-01&to=${today}`, { token: admin });
  check('Doanh thu lọc theo khoảng ngày hoạt động', range.status === 200 && range.data.period.type === 'range');
  check('Có chi tiết từng ngày', Array.isArray(range.data.daily) && range.data.daily.length > 0);
  check('Cộng các ngày đúng bằng tổng kỳ',
    range.data.daily.reduce((s, d) => s + d.total, 0) === range.data.total.revenue,
    JSON.stringify({ cong: range.data.daily.reduce((s, d) => s + d.total, 0), tong: range.data.total.revenue }));

  const feb = await call('/admin/revenue?period=month&month=2024-02', { token: admin });
  check('Tháng 2 năm nhuận có 29 ngày', feb.data.period.to === '2024-02-29', feb.data.period.to);

  const empty = await call('/admin/revenue?period=day&date=2000-01-01', { token: admin });
  check('Ngày không có giao dịch trả về 0', empty.data.total.revenue === 0 && empty.data.daily.length === 0);

  check('Kiểu lọc lạ bị từ chối (400)',
    (await call('/admin/revenue?period=nam', { token: admin })).status === 400);
  check('Tháng 13 bị từ chối (400)',
    (await call('/admin/revenue?period=month&month=2026-13', { token: admin })).status === 400);
  check('Ngày sai định dạng bị từ chối (400)',
    (await call('/admin/revenue?period=day&date=hom-qua', { token: admin })).status === 400);
  check('from sau to bị từ chối (400)',
    (await call('/admin/revenue?period=range&from=2026-09-10&to=2026-09-01', { token: admin })).status === 400);
  check('Khách vãng lai không xem được doanh thu (401)',
    (await call('/admin/revenue?period=month&month=' + month)).status === 401);
}

/* ---------- Đổi điểm lấy quà: 1.000 điểm = 1 túi 1kg ---------- */
{
  const pol = (await call('/retail/policy', { token: admin })).data.policy;
  check('Chính sách nêu 1.000 điểm đổi 1 quà', pol.pointsPerReward === 1000, String(pol.pointsPerReward));
  check('Có danh sách quà (nếp, lứt, kê)', pol.rewards.length >= 3, String(pol.rewards.length));
  check('Quà đều là loại 1kg', pol.rewards.every((g) => /1kg/.test(g.unit)),
    JSON.stringify(pol.rewards.map((g) => g.unit)));

  const gift = pol.rewards[0];
  const notGift = products.find((p) => !pol.rewards.some((g) => g.id === p.id));
  const giftPhone = `09${String(suffix).slice(-7)}9`;

  /* Khách mới chưa có điểm thì chưa đổi được */
  const tooSoon = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, items: [{ product_id: p35.id, quantity: 1 }],
            rewards: [{ product_id: gift.id, quantity: 1 }] },
  });
  check('Khách chưa có điểm thì không đổi quà được (400)', tooSoon.status === 400,
    `status=${tooSoon.status}`);

  /* Mua đủ để có hơn 1.000 điểm */
  const buy = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, full_name: 'Khách Đổi Quà', items: [{ product_id: p150.id, quantity: 10 }] },
  });
  check('Tạo hoá đơn lớn để tích điểm', buy.status === 201, JSON.stringify(buy.data));
  const pointsAfterBuy = buy.data.customer.points;
  check('Tích được hơn 1.000 điểm', pointsAfterBuy >= 1000, String(pointsAfterBuy));

  const look = await call(`/retail/customers?phone=${giftPhone}`, { token: admin });
  check('Tra cứu cho biết đổi được mấy phần quà',
    look.data.rewardsAffordable === Math.floor(pointsAfterBuy / 1000),
    `${look.data.rewardsAffordable} vs ${Math.floor(pointsAfterBuy / 1000)}`);

  /* Đổi 1 phần quà kèm mua hàng */
  const redeem = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, items: [{ product_id: p35.id, quantity: 1 }],
            rewards: [{ product_id: gift.id, quantity: 1 }] },
  });
  check('Đổi quà thành công (201)', redeem.status === 201, JSON.stringify(redeem.data));
  const inv = redeem.data.invoice;
  check('Hoá đơn ghi đã dùng 1.000 điểm', inv?.points_used === 1000, String(inv?.points_used));

  const giftLine = inv?.items.find((i) => i.is_reward === 1);
  check('Dòng quà được đánh dấu is_reward', !!giftLine);
  check('Quà tính giá 0đ', giftLine?.price === 0, String(giftLine?.price));
  check('Quà KHÔNG cộng vào tiền hàng', inv?.subtotal === 35000, String(inv?.subtotal));
  check('Khách chỉ trả tiền phần mua thật', inv?.total === 35000, String(inv?.total));

  const expected = pointsAfterBuy - 1000 + Math.floor(35000 / 1000);
  check('Điểm bị trừ đúng 1.000 và vẫn cộng điểm mua hàng',
    redeem.data.customer.points === expected,
    `${redeem.data.customer.points} vs ${expected}`);

  /* Không đổi được sản phẩm không nằm trong danh sách quà */
  const wrongGift = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, items: [{ product_id: p35.id, quantity: 1 }],
            rewards: [{ product_id: notGift.id, quantity: 1 }] },
  });
  check('Không đổi được loại không phải quà (400)', wrongGift.status === 400,
    `status=${wrongGift.status}`);

  /* Không đủ điểm cho 2 phần quà */
  const now = (await call(`/retail/customers?phone=${giftPhone}`, { token: admin })).data.customer.points;
  const tooMany = Math.floor(now / 1000) + 1;
  const over = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, items: [{ product_id: p35.id, quantity: 1 }],
            rewards: [{ product_id: gift.id, quantity: tooMany }] },
  });
  check('Đổi quá số điểm đang có bị từ chối (400)', over.status === 400, `status=${over.status}`);
  check('Từ chối xong điểm giữ nguyên',
    (await call(`/retail/customers?phone=${giftPhone}`, { token: admin })).data.customer.points === now);

  /* Khách vãng lai không có số điện thoại thì không đổi quà */
  const noPhone = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { items: [{ product_id: p35.id, quantity: 1 }], rewards: [{ product_id: gift.id, quantity: 1 }] },
  });
  check('Không có SĐT thì không đổi quà được (400)', noPhone.status === 400, `status=${noPhone.status}`);

  /* Nạp lại điểm cho các phép thử còn lại (lần đổi trên đã tiêu 1.000 điểm) */
  await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, items: [{ product_id: p150.id, quantity: 20 }] },
  });
  const refilled = (await call(`/retail/customers?phone=${giftPhone}`, { token: admin })).data.customer.points;
  // Cần ít nhất 2.000 điểm cho hai phép thử đổi quà còn lại.
  check('Mua thêm để có đủ điểm đổi tiếp', refilled >= 2000, String(refilled));

  /* Chỉ lấy quà, không mua gì thêm */
  const onlyGift = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, items: [], rewards: [{ product_id: gift.id, quantity: 1 }] },
  });
  check('Chỉ đến lấy quà, không mua gì vẫn được (201)', onlyGift.status === 201,
    JSON.stringify(onlyGift.data));
  check('Hoá đơn chỉ có quà thì khách trả 0đ', onlyGift.data.invoice?.total === 0,
    String(onlyGift.data.invoice?.total));

  /* Quà không làm khách đạt mốc giảm giá */
  const noTier = await call('/retail/invoices', {
    method: 'POST', token: admin,
    body: { phone: giftPhone, items: [{ product_id: p35.id, quantity: 1 }],
            rewards: [{ product_id: gift.id, quantity: 1 }] },
  });
  check('Quà không giúp đạt mốc giảm giá', noTier.data.invoice?.discount === 0,
    String(noTier.data.invoice?.discount));

  /* Hoá đơn cũ đọc lại vẫn thấy phần quà */
  const reread = await call(`/retail/invoices/${inv.code}`, { token: admin });
  check('Hoá đơn cũ vẫn ghi rõ phần quà',
    reread.data.invoice.items.some((i) => i.is_reward === 1)
    && reread.data.invoice.points_used === 1000);
}

console.log(results.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
