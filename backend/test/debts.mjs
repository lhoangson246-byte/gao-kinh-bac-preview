// Ảnh giao hàng, đơn công nợ duyệt nhiều cấp (giao hàng → kế toán → mẹ → thu tiền → tất toán), đóng ngày.
// Cách chạy: node test/debts.mjs — tự dựng máy chủ riêng; ghim "hôm nay" của trang công nợ sau 20 ngày
// để kiểm tra cảnh báo quá hạn.
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const vnToday = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const plusDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const later = plusDays(vnToday, 20);

const app = await fixture({ PROMO_TODAY: later });
const { call } = app;
const jpeg = (seed) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`anh-${seed}-${Math.random()}`.padEnd(40, 'x')), Buffer.from([0xff, 0xd9])]);
try {
  const owner = (await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } })).data.token;
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  let n = 0;
  const phone = (p) => `${p}${suffix}${n++ % 10}`;
  const presets = (await call('/admin/staff', { token: owner })).data.presets;
  check('Có mẫu quyền "Duyệt cuối (mẹ)"; mẫu Kế toán có quyền duyệt công nợ', presets['duyet-cuoi']?.permissions.includes('debt.final')
    && presets['ke-toan'].permissions.includes('debt.accounting'));
  const mk = async (perms, name) => {
    const ph = phone('08');
    await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: ph, password: 'nhanvien26', permissions: perms } });
    return (await call('/auth/login', { method: 'POST', body: { identifier: ph, password: 'nhanvien26' } })).data.token;
  };
  const accountant = await mk(presets['ke-toan'].permissions, 'Chị Kế Toán');
  const mom = await mk(presets['duyet-cuoi'].permissions, 'Mẹ');
  const shipper = await mk(['delivery'], 'Chú Giao Hàng');
  const shipper2 = await mk(['delivery'], 'Anh Giao Khác');
  const shippers = (await call('/admin/shippers', { token: owner })).data.shippers;
  const shipperId = shippers.find((s) => s.full_name === 'Chú Giao Hàng').id;
  const product = (await call('/admin/products', { method: 'POST', token: owner, body: { name: `Gạo công nợ ${suffix}`, price: 500000, cost_price: 400000, unit: 'bao 25kg', stock: 100 } })).data.product;
  const upload = async (token) => {
    const r = await fetch(`${app.base}/api/proofs`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` }, body: jpeg(n++) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const newOrder = async (receiver = 'Chị An', customer = phone('09'), qty = 2) => {
    const order = (await call('/admin/orders', { method: 'POST', token: owner, body: {
      receiver_name: receiver, phone: customer, address: 'KCN Quế Võ, phường Phương Liễu', items: [{ product_id: product.id, quantity: qty }], shipper_id: shipperId,
    } })).data.order;
    await call(`/delivery/orders/${order.id}/status`, { method: 'PATCH', token: shipper, body: { status: 'shipping' } });
    return order;
  };

  /* Giao xong phải chụp ảnh */
  const o1 = await newOrder('Cô Lẻ', phone('07'), 1);
  check('Giao xong mà chưa có ảnh: báo chụp ảnh (400)',
    (await call(`/delivery/orders/${o1.id}/status`, { method: 'PATCH', token: shipper, body: { status: 'completed' } })).status === 400);
  const otherPhoto = (await upload(shipper2)).data.id;
  check('Không dùng ảnh của người khác (400)',
    (await call(`/delivery/orders/${o1.id}/status`, { method: 'PATCH', token: shipper, body: { status: 'completed', photo: otherPhoto } })).status === 400);
  const fake = await fetch(`${app.base}/api/proofs`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${shipper}` }, body: Buffer.from('khong-phai-anh-that-xxxxxxxx') });
  check('Tệp không phải ảnh bị từ chối (400)', fake.status === 400);
  const photo1 = await upload(shipper);
  check('Nhân viên giao tải ảnh lên', photo1.status === 201 && /^\/api\/proofs\/[0-9a-f]{32}$/.test(photo1.data.url));
  const done = await call(`/delivery/orders/${o1.id}/status`, { method: 'PATCH', token: shipper, body: { status: 'completed', photo: photo1.data.id } });
  check('Có ảnh thì hoàn thành đơn', done.status === 200 && done.data.order.status === 'completed');
  const adminRow = (await call('/admin/orders?status=completed', { token: owner })).data.orders.find((o) => o.id === o1.id);
  check('Trang quản trị thấy ảnh giao hàng của đơn', adminRow?.delivery_photo === photo1.data.url);
  check('Kế toán xem được ảnh chứng từ', (await fetch(`${app.base}${photo1.data.url}`, { headers: { Authorization: `Bearer ${accountant}` } })).status === 200);
  check('Chưa đăng nhập không xem được ảnh chứng từ (401)', (await fetch(`${app.base}${photo1.data.url}`)).status === 401);
  const customer = (await call('/auth/register', { method: 'POST', body: { full_name: 'Khách', phone: phone('03'), password: 'gao2024!' } })).data.token;
  check('Khách thường không xem được ảnh chứng từ (403)', (await fetch(`${app.base}${photo1.data.url}`, { headers: { Authorization: `Bearer ${customer}` } })).status === 403);
  check('Khách thường không tải ảnh chứng từ lên được (403)', (await upload(customer)).status === 403);

  /* Khách nợ */
  const companyPhone = phone('09');
  const d1 = await newOrder('Chị A', companyPhone, 2);
  const gaoPhoto = (await upload(shipper)).data.id;
  const invoicePhoto = (await upload(shipper)).data.id;
  const debt = (body) => call(`/delivery/orders/${d1.id}/debt`, { method: 'POST', token: shipper, body });
  check('Ghi nợ thiếu ảnh hoá đơn: báo lỗi', !!(await debt({ delivered_photo: gaoPhoto, invoice_photo: '' })).data.errors?.invoice_photo || (await debt({ delivered_photo: gaoPhoto, invoice_photo: 'x' })).status === 400);
  check('Hai ảnh trùng nhau bị từ chối (400)', (await debt({ delivered_photo: gaoPhoto, invoice_photo: gaoPhoto })).status === 400);
  const confirmedOnly = (await call('/admin/orders', { method: 'POST', token: owner, body: {
    receiver_name: 'Chị A', phone: companyPhone, address: 'KCN Quế Võ, phường Phương Liễu', items: [{ product_id: product.id, quantity: 1 }], shipper_id: shipperId,
  } })).data.order;
  check('Chưa "Bắt đầu giao" thì chưa ghi nợ được (400)', (await call(`/delivery/orders/${confirmedOnly.id}/debt`, { method: 'POST', token: shipper,
    body: { delivered_photo: gaoPhoto, invoice_photo: invoicePhoto } })).status === 400);
  const created = await debt({ delivered_photo: gaoPhoto, invoice_photo: invoicePhoto, company: 'Công ty B', comment: 'Khách hẹn 15 ngày trả' });
  check('Nhân viên giao bấm "Khách nợ" + 2 ảnh: tạo đơn nợ (201)', created.status === 201 && created.data.order.payment_status === 'debt', JSON.stringify(created.data));
  const delivered = (await call('/delivery/orders', { token: shipper })).data.orders.find((o) => o.id === d1.id);
  check('Đơn nợ hiện "đã giao" và đánh dấu công nợ', delivered?.status === 'completed' && delivered.payment_status === 'debt');

  const list = async (token, scope = '') => (await call(`/debts${scope ? `?scope=${scope}` : ''}`, { token })).data;
  let data = await list(accountant);
  const account = data.accounts.find((a) => a.phone === companyPhone);
  const rec = account?.records[0];
  check('Trang công nợ gom theo khách: Chị A — Công ty B, hạn mặc định 15 ngày', account?.contact_name === 'Chị A' && account.company === 'Công ty B' && account.term_days === 15);
  check('Đơn nợ: số tiền, ảnh gạo + hoá đơn, chờ kế toán duyệt, có bình luận của nhân viên giao', rec?.amount === d1.total
    && /\/api\/proofs\//.test(rec.delivered_photo) && /\/api\/proofs\//.test(rec.invoice_photo) && rec.status === 'pending_accounting'
    && rec.events[0]?.comment === 'Khách hẹn 15 ngày trả' && rec.steps.created.by === 'Chú Giao Hàng', JSON.stringify(rec).slice(0, 300));
  check('Hạn trả = ngày giao + 15 ngày; quá 5 ngày thì cảnh báo', rec?.due_on === plusDays(vnToday, 15) && rec.overdue_days === 5 && data.summary.overdue_count >= 1,
    `${rec?.due_on} ${rec?.overdue_days}`);

  /* Duyệt từng cấp */
  const act = (token, path, body = {}) => call(`/debts/${rec.id}/${path}`, { method: 'POST', token, body });
  check('Mẹ chưa duyệt được trước kế toán (403)', (await act(mom, 'approve')).status === 403);
  check('Nhân viên giao không vào được trang công nợ (403)', (await call('/debts', { token: shipper })).status === 403);
  check('Kế toán duyệt', (await act(accountant, 'approve', { comment: 'Đã kiểm hoá đơn' })).data.accounts?.find((a) => a.phone === companyPhone).records[0].status === 'open');
  check('Kế toán duyệt xong là đang nợ: không còn bước mẹ duyệt ở giữa (409)', (await act(mom, 'approve')).status === 409);
  data = await list(accountant);
  let r = data.accounts.find((a) => a.phone === companyPhone).records[0];
  check('Khoản nợ "Đang nợ", ghi người duyệt; không có bước mẹ ở giữa', r.status === 'open' && r.steps.accounting.by === 'Chị Kế Toán' && !('final' in r.steps));
  check('Dòng lịch sử có tên từng bước', r.events.some((e) => e.action === 'Kế toán duyệt'), JSON.stringify(r.events));
  check('Bình luận trống bị từ chối (400)', (await act(mom, 'comments', { comment: '' })).status === 400);
  data = (await act(mom, 'comments', { comment: 'Nhắc khách trước ngày 25' })).data;
  r = data.accounts.find((a) => a.phone === companyPhone).records[0];
  check('Bình luận ở bất kỳ bước nào, ghi tên người viết', r.events.some((e) => e.comment === 'Nhắc khách trước ngày 25' && e.user_name === 'Mẹ'));

  // Đặt hạn công nợ riêng cho khách: 30 ngày → hết quá hạn.
  data = (await call(`/debts/accounts/${account.id}`, { method: 'PUT', token: accountant, body: { term_days: 30 } })).data;
  r = data.accounts.find((a) => a.phone === companyPhone).records[0];
  check('Kế toán đặt hạn 30 ngày cho khách: tính lại hạn, hết cảnh báo', r.due_on === plusDays(vnToday, 30) && r.overdue_days === 0);
  check('Mẹ không đặt hạn công nợ (403)', (await call(`/debts/accounts/${account.id}`, { method: 'PUT', token: mom, body: { term_days: 5 } })).status === 403);
  check('Hạn công nợ ngoài 1–365 ngày bị từ chối (400)', (await call(`/debts/accounts/${account.id}`, { method: 'PUT', token: accountant, body: { term_days: 0 } })).status === 400);

  /* Thu tiền và tất toán */
  check('Mẹ không ký đã thu tiền thay kế toán (403)', (await act(mom, 'paid', { method: 'cash' })).status === 403);
  await act(accountant, 'paid', { method: 'cash', comment: 'Đã thu đủ' });
  data = (await act(mom, 'reject', { comment: 'Chưa thấy tiền về quỹ' })).data;
  r = data.accounts.find((a) => a.phone === companyPhone).records[0];
  check('Mẹ chưa duyệt tất toán: quay lại "Đang nợ", bỏ chữ ký thu tiền', r.status === 'open' && r.steps.paid === null);
  await act(accountant, 'paid', { method: 'transfer', comment: 'Khách chuyển khoản' });
  check('Kế toán không duyệt tất toán thay mẹ (403)', (await act(accountant, 'approve')).status === 403);
  data = (await act(mom, 'approve')).data;
  check('Mẹ duyệt tất toán: khoản nợ rời trang đang nợ', !data.accounts.some((a) => a.records.some((x) => x.id === rec.id)));
  const settled = await list(owner, 'settled');
  check('Mục "Đã tất toán" có khoản vừa xong, đủ người ký', settled.accounts.some((a) => a.records.some((x) => x.id === rec.id && x.steps.settled.by === 'Mẹ' && x.steps.paid.method === 'transfer')));

  /* Trả lại và gửi duyệt lại */
  const d2 = await newOrder('Chị A', companyPhone, 1);
  const p1 = (await upload(shipper)).data.id;
  const p2 = (await upload(shipper)).data.id;
  const r2 = (await call(`/delivery/orders/${d2.id}/debt`, { method: 'POST', token: shipper, body: { delivered_photo: p1, invoice_photo: p2 } })).data.debt_id;
  check('Trả lại phải ghi lý do (400)', (await call(`/debts/${r2}/reject`, { method: 'POST', token: accountant, body: {} })).status === 400);
  await call(`/debts/${r2}/reject`, { method: 'POST', token: accountant, body: { comment: 'Ảnh hoá đơn mờ' } });
  data = await list(accountant);
  check('Khoản bị trả lại hiện rõ, không cộng vào tổng nợ', data.accounts.find((a) => a.phone === companyPhone).records.find((x) => x.id === r2)?.status === 'rejected'
    && data.accounts.find((a) => a.phone === companyPhone).total === 0);
  await call(`/debts/${r2}/resubmit`, { method: 'POST', token: accountant, body: { comment: 'Đã chụp lại, gửi bổ sung qua Zalo' } });
  data = await list(accountant);
  check('Gửi duyệt lại: về bước chờ kế toán, tổng nợ cộng lại', data.accounts.find((a) => a.phone === companyPhone).records.find((x) => x.id === r2)?.status === 'pending_accounting'
    && data.accounts.find((a) => a.phone === companyPhone).total === d2.total);
  check('Khách thường không vào trang công nợ (403)', (await call('/debts', { token: customer })).status === 403);

  /* Đóng ngày */
  const closing = (await call('/admin/closing', { token: accountant })).data;
  const L = closing.figures?.lines;
  check('Đóng ngày: tiền mặt gồm đơn giao xong trả tiền mặt', L?.online_cash.s >= o1.total, JSON.stringify(L?.online_cash));
  check('Đóng ngày: công nợ phát sinh tách riêng, không tính vào tiền mặt', L?.online_debt.s === d1.total + d2.total, JSON.stringify(L?.online_debt));
  check('Đóng ngày: tiền thu nợ chuyển khoản tính vào chuyển khoản', L?.debt_collected_transfer.s === d1.total
    && closing.figures.totals.transfer >= d1.total, JSON.stringify(L?.debt_collected_transfer));
  check('Có danh sách mệnh giá để kê tiền', JSON.stringify(closing.denominations) === '[500000,200000,100000,50000,20000,10000,5000,2000,1000]');
  check('Còn đơn nợ chờ duyệt: báo trong phiếu đóng ngày', closing.pending_debts?.some((p) => p.code === d2.code) && closing.can_close === true);
  const blocked = await call('/admin/closing', { method: 'POST', token: accountant, body: { day: vnToday, counts: {}, note: 'Thử đóng khi còn nợ chưa duyệt' } });
  check('Chưa duyệt hết công nợ thì chưa đóng ngày được (400)', blocked.status === 400 && blocked.data.message.includes(d2.code), blocked.data.message);
  await call(`/debts/${r2}/approve`, { method: 'POST', token: accountant, body: {} });
  // Kê tiền đúng bằng sổ sách (chia theo mệnh giá lớn trước).
  const cashBook = (await call('/admin/closing', { token: accountant })).data.figures.totals.cash;
  let rest = cashBook;
  const exact = {};
  for (const v of closing.denominations) { exact[v] = Math.floor(rest / v); rest -= exact[v] * v; }
  const off = await call('/admin/closing', { method: 'POST', token: accountant, body: { day: vnToday, counts: { ...exact, 1000: exact[1000] + 2 }, note: 'thừa' } });
  check('Tiền đếm lệch sổ sách mà không giải trình: chưa đóng được (400)', off.status === 400 && !!off.data.errors?.note, off.data.message);
  const momSave = await call('/admin/closing', { method: 'POST', token: mom, body: { day: vnToday, counts: exact } });
  check('Mẹ chỉ xem, không đóng ngày được (403)', momSave.status === 403 && (await call('/admin/closing', { token: mom })).data.can_close === false);
  const saved = (await call('/admin/closing', { method: 'POST', token: accountant, body: { day: vnToday, counts: exact, note: 'Đủ tiền' } })).data.saved;
  check('Duyệt hết công nợ + tiền khớp: đóng ngày được', saved?.counted_cash === cashBook && saved.difference === 0 && saved.closer_name === 'Chị Kế Toán',
    JSON.stringify(saved && { c: saved.counted_cash, d: saved.difference }));
  const explained = await call('/admin/closing', { method: 'POST', token: accountant, body: { day: vnToday, counts: { ...exact, 1000: exact[1000] + 2 }, note: 'Thừa 2.000đ do khách gửi lại tiền lẻ' } });
  check('Lệch nhưng có giải trình thì lưu được', explained.status === 200 && explained.data.saved.difference === 2000);
  check('Mở lại ngày đã đóng thấy phiếu đã lưu', /khách gửi lại/.test((await call(`/admin/closing?day=${vnToday}`, { token: owner })).data.saved?.note || ''));
  const file = await fetch(`${app.base}/api/admin/closing/export?day=${vnToday}`, { headers: { Authorization: `Bearer ${mom}` } });
  check('Tải bản Excel của phiếu đóng ngày (mẹ xem được)', file.status === 200 && /spreadsheetml/.test(file.headers.get('content-type') || '') && (await file.arrayBuffer()).byteLength > 1000);
  check('Ngày chưa đóng thì chưa có tệp (404)', (await call(`/admin/closing/export?day=2020-01-01`, { token: accountant })).status === 404);
  check('Lịch sử các ngày đã đóng', (await call('/admin/closing/history', { token: accountant })).data.closings?.[0]?.day === vnToday);
  check('Không đóng ngày trong tương lai (400)', (await call('/admin/closing', { method: 'POST', token: accountant, body: { day: plusDays(vnToday, 2), counts: {} } })).status === 400);
  check('Số tờ âm bị từ chối (400)', (await call('/admin/closing', { method: 'POST', token: accountant, body: { day: vnToday, counts: { 500000: -1 } } })).status === 400);
  check('Nhân viên giao không xem được đóng ngày (403)', (await call('/admin/closing', { token: shipper })).status === 403);
} finally {
  await app.close();
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
assert.equal(failed, 0);
