// Chuyển khoản: QR trong cài đặt cửa hàng, khách gửi ảnh đã chuyển khoản, cửa hàng xác nhận sau.
// Cách chạy: node test/transfer.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

// Ảnh PNG 1×1 hợp lệ
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const app = await fixture();
const { call } = app;
const upload = async (orderId, { token, guestToken, body = PNG, type = 'image/png' } = {}) => {
  const headers = { 'Content-Type': type, 'X-CSRF-Protection': '1' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (guestToken) headers['X-Guest-Token'] = guestToken;
  const res = await fetch(`${app.base}/api/orders/${orderId}/transfer-proof`, { method: 'POST', headers, body });
  return { status: res.status, data: await res.json().catch(() => null) };
};
try {
  const owner = (await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } })).data.token;
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  const product = (await call('/admin/products', { method: 'POST', token: owner, body: { name: `Gạo chuyển khoản ${suffix}`, price: 120000, unit: 'túi 5kg', stock: 100 } })).data.product;

  /* QR trong cài đặt */
  const store = (await call('/settings/storefront')).data.settings;
  check('Trang khách có sẵn mã QR chuyển khoản', store.bank_qr_url === '/bank-qr.png', store.bank_qr_url);
  const saved = await call('/admin/settings/storefront', { method: 'PUT', token: owner, body: { bank_qr_url: '/api/images/abc.png' } });
  check('Chủ cửa hàng đổi được ảnh QR', saved.status === 200 && saved.data.settings.bank_qr_url === '/api/images/abc.png', JSON.stringify(saved.data).slice(0, 200));
  check('Đường dẫn QR lạ bị từ chối', (await call('/admin/settings/storefront', { method: 'PUT', token: owner, body: { bank_qr_url: 'javascript:alert(1)' } })).status === 400);

  /* Đơn mua nhanh chuyển khoản: gửi ảnh bằng mã bí mật của đơn */
  const guestBody = (phone, payment = 'bank') => ({ receiver_name: 'Chị Chuyển Khoản', phone, address: 'Số 3 đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh', payment_method: payment, items: [{ product_id: product.id, quantity: 1 }] });
  const g = (await call('/orders/guest', { method: 'POST', body: guestBody(`07${suffix}1`) })).data;
  check('Đặt nhanh chuyển khoản có mã bí mật để gửi ảnh', !!g.guest_token && g.order?.payment_method === 'bank');
  check('Không có mã: không gửi ảnh được (401)', (await upload(g.order.id)).status === 401);
  check('Sai mã: không gửi ảnh được (404)', (await upload(g.order.id, { guestToken: 'sai-ma' })).status === 404);
  check('Tệp không phải ảnh bị từ chối', (await upload(g.order.id, { guestToken: g.guest_token, body: Buffer.from('xin chao, khong phai anh'), type: 'image/png' })).status === 400);
  const ok = await upload(g.order.id, { guestToken: g.guest_token });
  check('Khách mua nhanh gửi ảnh chuyển khoản', ok.status === 201 && !!ok.data.order?.transfer_reported_at, JSON.stringify(ok.data));
  const again = await upload(g.order.id, { guestToken: g.guest_token });
  check('Gửi lại ảnh khác được (thay ảnh cũ)', again.status === 201);

  /* Đơn tiền mặt và đơn của người khác */
  const cod = (await call('/orders/guest', { method: 'POST', body: guestBody(`07${suffix}2`, 'cod') })).data;
  check('Đơn tiền mặt không nhận ảnh chuyển khoản (400)', (await upload(cod.order.id, { guestToken: cod.guest_token })).status === 400);
  check('Mã của đơn này không dùng cho đơn khác (404)', (await upload(cod.order.id, { guestToken: g.guest_token })).status === 404);

  /* Đơn có tài khoản */
  const phoneA = `09${suffix}3`;
  const userA = (await call('/auth/register', { method: 'POST', body: { full_name: 'Anh Có TK', phone: phoneA, password: 'gao2024!' } })).data.token;
  const userB = (await call('/auth/register', { method: 'POST', body: { full_name: 'Chị Khác', phone: `09${suffix}4`, password: 'gao2024!' } })).data.token;
  const mine = (await call('/orders', { method: 'POST', token: userA, body: { receiver_name: 'Anh Có TK', phone: phoneA, address: 'Số 5 đường Lý Thái Tổ, phường Suối Hoa', delivery_area: 'bac-ninh', payment_method: 'bank', items: [{ product_id: product.id, quantity: 1 }] } })).data.order;
  check('Người khác không gửi ảnh vào đơn của mình được (404)', (await upload(mine.id, { token: userB })).status === 404);
  check('Chủ đơn gửi ảnh chuyển khoản', (await upload(mine.id, { token: userA })).status === 201);
  const myList = (await call('/orders', { token: userA })).data.orders.find((o) => o.id === mine.id);
  check('Khách thấy đã gửi ảnh, không lộ mã ảnh riêng tư', !!myList?.transfer_reported_at && !('transfer_proof' in myList) && !('guest_token_hash' in myList), JSON.stringify(myList).slice(0, 200));

  /* Quản trị: thấy và xác nhận */
  const pending = (await call('/admin/orders?transfer=pending&limit=50', { token: owner })).data;
  const row = pending.orders?.find((o) => o.id === g.order.id);
  check('Quản trị: lọc được đơn khách báo đã chuyển khoản, có đếm số', pending.transfer_pending >= 2 && !!row && pending.orders.every((o) => o.payment_method === 'bank' && o.transfer_reported_at && !o.transfer_confirmed_at), JSON.stringify({ n: pending.transfer_pending, len: pending.orders?.length }));
  check('Quản trị xem được ảnh chuyển khoản', /^\/api\/proofs\//.test(row?.transfer_proof || '') && (await fetch(`${app.base}${row.transfer_proof}`, { headers: { Authorization: `Bearer ${owner}` } })).status === 200);
  check('Khách không xem được ảnh riêng tư qua đường dẫn (401/403)', [401, 403].includes((await fetch(`${app.base}${row.transfer_proof}`)).status));
  const confirm = await call(`/admin/orders/${g.order.id}/transfer`, { method: 'PATCH', token: owner, body: { confirmed: true } });
  check('Chủ cửa hàng xác nhận đã nhận tiền', confirm.status === 200 && !!confirm.data.order?.transfer_confirmed_at && !!confirm.data.order.transfer_confirmed_name, JSON.stringify(confirm.data));
  check('Đã xác nhận thì không còn trong danh sách chờ', !(await call('/admin/orders?transfer=pending&limit=50', { token: owner })).data.orders.some((o) => o.id === g.order.id));
  check('Đã xác nhận thì khách không gửi ảnh đè được (409)', (await upload(g.order.id, { guestToken: g.guest_token })).status === 409);
  check('Không xác nhận chuyển khoản cho đơn tiền mặt (400)', (await call(`/admin/orders/${cod.order.id}/transfer`, { method: 'PATCH', token: owner, body: { confirmed: true } })).status === 400);
  const track = (await call('/orders/track', { method: 'POST', body: { phone: `07${suffix}1`, code: g.order.code } })).data;
  const tracked = track.orders?.[0] ?? track.order;
  check('Tra cứu đơn thấy cửa hàng đã nhận tiền', !!tracked?.transfer_confirmed_at, JSON.stringify(track).slice(0, 200));

  /* Quyền */
  const shipPhone = `03${suffix}5`;
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Shipper', phone: shipPhone, password: 'giaohang26', permissions: ['delivery'] } });
  const shipper = (await call('/auth/login', { method: 'POST', body: { identifier: shipPhone, password: 'giaohang26' } })).data.token;
  check('Nhân viên giao hàng không xác nhận chuyển khoản được (403)', (await call(`/admin/orders/${mine.id}/transfer`, { method: 'PATCH', token: shipper, body: { confirmed: true } })).status === 403);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
