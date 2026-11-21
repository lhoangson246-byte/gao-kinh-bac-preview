import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture, run } from './fixture.mjs';
import { trustedProxy } from '../src/security.js';

let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
const app = await fixture();
const { call } = app;
try {
  const login = await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } });
  assert.equal(login.status, 200);
  const admin = login.data.token;
  const credentials = { full_name: 'Audit customer', email: 'customer@example.com', password: 'Customer-passphrase-123!' };
  const customer = await call('/auth/register', { method: 'POST', body: credentials });
  assert.equal(customer.status, 201);
  let token = customer.data.token;
  const other = await call('/auth/register', { method: 'POST', body: { ...credentials, email: 'other@example.com' } });
  assert.equal(other.status, 201);
  const browserHeaders = { 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1', Origin: 'https://shop.example' };
  const browser = await call('/auth/login', { method: 'POST', body: { identifier: credentials.email, password: credentials.password }, headers: browserHeaders });
  const cookie = browser.headers.get('set-cookie');
  check('Browser receives only HttpOnly, Secure, host-scoped SameSite cookie', browser.status === 200 && !browser.data.token && cookie?.includes('__Host-gao_session=') && cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax') && !cookie.includes('Domain='));
  const browserSession = cookie.split(';')[0];
  check('Cookie restores authenticated session', (await call('/auth/me', { headers: { Cookie: browserSession } })).status === 200);
  check('Cookie mutation without CSRF header rejected', (await call('/auth/me', { method: 'PUT', headers: { Cookie: browserSession, 'X-CSRF-Protection': '' }, body: { full_name: 'Changed' } })).status === 403);
  check('Untrusted origin rejected even with CSRF header', (await call('/auth/me', { method: 'PUT', headers: { ...browserHeaders, Cookie: browserSession, Origin: 'https://evil.example' }, body: { full_name: 'Changed' } })).status === 403);
  check('Allowed cookie mutation succeeds', (await call('/auth/me', { method: 'PUT', headers: { ...browserHeaders, Cookie: browserSession }, body: { full_name: 'Changed' } })).status === 200);
  const product = await call('/admin/products', { method: 'POST', token: admin, body: { name: 'Security product', price: 50000, cost_price: 31000, stock: 100 } });
  assert.equal(product.status, 201);
  const pid = product.data.product.id;
  const list = await call('/products');
  check('Public catalog and detail exclude cost_price', list.data.products.every((p) => !('cost_price' in p)) && !('cost_price' in (await call(`/products/${pid}`)).data.product));
  check('Public catalog opts into edge cache without cookies', list.headers.get('cache-control') === 'public, s-maxage=30, stale-while-revalidate=300' && !list.headers.has('set-cookie'));
  check('Authenticated APIs retain no-store, CSP and nosniff', (await call('/auth/me', { token })).headers.get('cache-control') === 'no-store' && list.headers.get('content-security-policy') && list.headers.get('x-content-type-options') === 'nosniff');
  for (const route of ['/admin/products', '/admin/customers', '/admin/activity', '/retail/customers?phone=0912345678']) {
    check(`Anonymous/customer authorization: ${route}`, (await call(route)).status === 401 && (await call(route, { token })).status === 403);
  }
  check('Mass-assignment role rejected', (await call('/auth/me', { method: 'PUT', token, body: { role: 'admin' } })).status === 400);
  check('Case-insensitive routes cannot bypass schemas', (await call('/auth/REGISTER', { method: 'POST', body: { ...credentials, email: 'case@example.com', password: 'short' } })).status === 400);
  for (const value of [true, [], {}, 1.5, '1.5', '0x1', '1e0']) {
    check(`Invalid numeric input rejected: ${JSON.stringify(value)}`, (await call(`/admin/products/${pid}`, { method: 'PUT', token: admin, body: { stock: value } })).status === 400);
  }
  check('String boolean rejected', (await call(`/admin/customers/${customer.data.user.id}/lock`, { method: 'PATCH', token: admin, body: { is_locked: 'false' } })).status === 400);
  check('Empty lock body rejected', (await call(`/admin/customers/${customer.data.user.id}/lock`, { method: 'PATCH', token: admin, body: {} })).status === 400);
  check('Object text and oversize input rejected', (await call('/auth/me', { method: 'PUT', token, body: { full_name: {} } })).status === 400 && (await call('/auth/me', { method: 'PUT', token, body: { full_name: 'x'.repeat(121) } })).status === 400);
  check('Duplicate query parameters rejected', (await call('/products?q=a&q=b')).status === 400);
  check('Fractional route ID cannot select another product', (await call(`/products/${pid}.1`)).status === 404);
  for (const url of ['javascript:alert(1)', '//evil.example/x', '/\\evil.example/x', 'https://user:pass@evil.example/x']) {
    check(`Unsafe image URL rejected: ${url}`, (await call(`/admin/products/${pid}`, { method: 'PUT', token: admin, body: { image_url: url } })).status === 400);
  }
  const injection = await call('/products?q=' + encodeURIComponent("' OR 1=1 --"));
  check('SQL metacharacters treated as literal data', injection.status === 200 && injection.data.products.length === 0);
  const badLogin = await call('/auth/login', { method: 'POST', body: { identifier: "' OR 1=1 --@example.com", password: credentials.password } });
  check('SQL login injection rejected', badLogin.status === 401);
  check('Object/NoSQL-shaped login identifier rejected', (await call('/auth/login', { method: 'POST', body: { identifier: { $ne: null }, password: credentials.password } })).status === 400);
  const address = await call('/addresses', { method: 'POST', token, body: { receiver_name: 'Receiver', phone: '0912345678', address: 'So 12 Bac Ninh' } });
  assert.equal(address.status, 201);
  check('Address IDOR blocked', (await call(`/addresses/${address.data.address.id}/default`, { method: 'PATCH', token: other.data.token })).status === 404);
  const orderBody = { receiver_name: 'Receiver', phone: '+84912345678', address: 'So 12 Bac Ninh', delivery_area: 'bac-ninh', items: [{ product_id: pid, quantity: 1 }] };
  const order = await call('/orders', { method: 'POST', token, body: orderBody });
  assert.equal(order.status, 201);
  check('Delivery phone never becomes a login identifier', (await call('/auth/me', { token })).data.user.phone === null);
  check('Order IDOR blocked for reading and cancellation', (await call(`/orders/${order.data.order.id}`, { token: other.data.token })).status === 404 && (await call(`/orders/${order.data.order.id}/cancel`, { method: 'PATCH', token: other.data.token })).status === 404);
  check('Client total manipulation rejected', (await call('/orders', { method: 'POST', token, body: { ...orderBody, total: 1 } })).status === 400);
  const cancelled = await Promise.all([1, 2].map(() => call(`/orders/${order.data.order.id}/cancel`, { method: 'PATCH', token })));
  check('Concurrent cancellation restores inventory only once', cancelled.filter((r) => r.status === 200).length === 1 && (await call(`/products/${pid}`)).data.product.stock === 100);
  const newPassword = 'Replacement-passphrase-456!';
  check('Password reset succeeds', (await call(`/admin/customers/${customer.data.user.id}/reset-password`, { method: 'POST', token: admin, body: { password: newPassword } })).status === 200);
  check('Password reset revokes bearer AND browser sessions', (await call('/auth/me', { token })).status === 401 && (await call('/auth/me', { headers: { Cookie: browserSession } })).status === 401);
  token = (await call('/auth/login', { method: 'POST', body: { identifier: credentials.email, password: newPassword } })).data.token;
  for (const is_locked of [true, false]) await call(`/admin/customers/${customer.data.user.id}/lock`, { method: 'PATCH', token: admin, body: { is_locked } });
  check('Unlock cannot reactivate an old token', (await call('/auth/me', { token })).status === 401);
  token = (await call('/auth/login', { method: 'POST', body: { identifier: credentials.email, password: newPassword } })).data.token;
  check('Logout succeeds and revokes old token', (await call('/auth/logout', { method: 'POST', token })).status === 200 && (await call('/auth/me', { token })).status === 401);
  token = (await call('/auth/login', { method: 'POST', body: { identifier: credentials.email, password: newPassword } })).data.token;
  const change = await call('/auth/password', { method: 'PUT', token, body: { current_password: newPassword, password: 'Third-passphrase-789!' } });
  check('Self-service password change rotates sessions', change.status === 200 && (await call('/auth/me', { token })).status === 401 && (await call('/auth/me', { token: change.data.token })).status === 200);
  // 24/10/2026: khách tối thiểu 8 ký tự (12 ký tự khó nhớ); mật khẩu ai cũng đoán được bị chặn.
  const eight = await call(`/admin/customers/${customer.data.user.id}/reset-password`, { method: 'POST', token: admin, body: { password: 'gao2024!' } });
  check('Customer password of 8 characters accepted', eight.status === 200);
  check('Customer can log in with the 8-character password',
    (await call('/auth/login', { method: 'POST', body: { identifier: credentials.email, password: 'gao2024!' } })).status === 200);
  const seven = await call('/auth/register', { method: 'POST', body: { full_name: 'Bảy ký tự', phone: '0911000007', password: 'gao2024' } });
  check('7-character password rejected with a clear message', seven.status === 400 && /8 ký tự/.test(seven.data.errors?.password || ''));
  const common = await call('/auth/register', { method: 'POST', body: { full_name: 'Dễ đoán', phone: '0911000008', password: '12345678' } });
  check('Very common 8-character password rejected', common.status === 400 && /dễ đoán/.test(common.data.errors?.password || ''));
  const adminShort = await call('/auth/password', { method: 'PUT', token: admin, body: { current_password: app.env.ADMIN_PASSWORD, password: 'gao2024!' } });
  check('Admin password still needs 12 characters', adminShort.status === 400 && /12 ký tự/.test(adminShort.data.errors?.password || ''));
  check('Admin session untouched after rejected change', (await call('/auth/me', { token: admin })).status === 200);
  for (const password of ['short', 'a'.repeat(73), '密'.repeat(25)]) {
    check(`Weak/over-72-byte password rejected (${Buffer.byteLength(password)} bytes)`, (await call(`/admin/customers/${customer.data.user.id}/reset-password`, { method: 'POST', token: admin, body: { password } })).status === 400);
  }
  const forged = jwt.sign({ id: login.data.user.id }, 'gao_nha_minh_dev_secret_khong_dung_that');
  check('Known development-key forgery rejected', (await call('/auth/me', { token: forged })).status === 401);
  const legacy = jwt.sign({ id: login.data.user.id, role: 'admin' }, app.env.JWT_SECRET, { expiresIn: '7d' });
  check('Legacy tokens without session version revoked on upgrade', (await call('/auth/me', { token: legacy })).status === 401);
  const wrongAudience = jwt.sign({ id: login.data.user.id, version: 0 }, app.env.JWT_SECRET, { issuer: 'gao-shop', audience: 'evil', expiresIn: '1h' });
  check('Wrong JWT audience rejected', (await call('/auth/me', { token: wrongAudience })).status === 401);
  const malformed = await call('/auth/register', { method: 'POST', raw: '{"password":secret' });
  check('Malformed JSON gives generic error without body/stack', malformed.status === 400 && !JSON.stringify(malformed.data).match(/secret|stack|SyntaxError/));
  check('Oversize body rejected', (await call('/auth/me', { method: 'PUT', token: admin, raw: JSON.stringify({ full_name: 'a'.repeat(110000) }) })).status === 413);
  const hash = await bcrypt.hash('a'.repeat(72), 4);
  check('Regression demonstrates bcrypt truncation being defended against', await bcrypt.compare('a'.repeat(72) + 'different-suffix', hash));
  // No hashing required for unknown-credential startup checks.
  const weakSecret = await run('src/server.js', { ...app.env, JWT_SECRET: 'short' });
  check('Weak JWT secret fails startup', weakSecret.code !== 0 && weakSecret.output.includes('JWT_SECRET'));
  const noAdmin = await run('src/seed.js', { ...app.env, DATA_DIR: `${app.directory}/no-admin`, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' });
  check('Fresh seed without explicit admin credentials fails', noAdmin.code !== 0 && noAdmin.output.includes('ADMIN_PASSWORD'));
  const setDefault = await run('--input-type=module', app.env, ['--eval', `
    import db from './src/db.js'; import bcrypt from 'bcryptjs';
    db.prepare("UPDATE users SET password_hash = ? WHERE role = 'admin'").run(bcrypt.hashSync('admin123', 4)); db.close();
  `]);
  assert.equal(setDefault.code, 0);
  const rejected = await run('src/server.js', app.env);
  check('Production refuses an existing administrator with default password', rejected.code !== 0 && rejected.output.includes('rotate:admin'));
  const rotate = await run('src/rotate-admin.js', app.env);
  check('Administrator rotation command succeeds without leaking credentials', rotate.code === 0 && !rotate.output.includes(app.env.ADMIN_PASSWORD));
  check('Administrator rotation revokes prior sessions', (await call('/auth/me', { token: admin })).status === 401);
} finally { await app.close(); }

// Fresh budgets for rate-limit tests. X-Forwarded-For must not bypass TRUST_PROXY=0.
const rateApp = await fixture();
try {
  let last;
  for (let i = 0; i < 21; i++) {
    last = await rateApp.call('/auth/login', { method: 'POST', body: { identifier: `invalid-${i}@example.com`, password: '' }, headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } });
  }
  check('IP auth limit enforced despite spoofed forwarding headers', last.status === 429 && last.headers.get('retry-after'));
} finally { await rateApp.close(); }

const accountApp = await fixture({ TRUST_PROXY: '1' });
try {
  let last;
  for (let i = 0; i < 16; i++) {
    last = await accountApp.call('/auth/login', { method: 'POST', body: { identifier: i % 2 ? '+84912345678' : '0912 345 678', password: '' }, headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } });
  }
  check('Account limiter covers normalized phone variants across different IPs', last.status === 429);
} finally { await accountApp.close(); }
// Vercel kết thúc TLS ở proxy rồi gọi hàm serverless qua HTTP. Nếu ứng dụng
// không tin proxy đó thì req.protocol là "http" trong khi trình duyệt gửi
// Origin "https://…", và mọi yêu cầu ghi bị chặn 403 dù cùng một tên miền.
// Trên Vercel ứng dụng chạy bằng driver libSQL (Turso) chứ không phải better-sqlite3,
// nên khối này cũng là phép kiểm tra cho chính driver đó.
const vercelDir = await mkdtemp(path.join(tmpdir(), 'gao-vercel-'));
const vercelApp = await fixture({
  VERCEL: '1', TRUST_PROXY: '', CLIENT_ORIGIN: '',
  LIBSQL_URL: path.join(vercelDir, 'app.db'),
});
try {
  const host = new URL(vercelApp.base).host;
  const browser = {
    'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1',
    Origin: `https://${host}`, 'X-Forwarded-Proto': 'https',
  };
  const login = await vercelApp.call('/auth/login', {
    method: 'POST', headers: browser,
    body: { identifier: vercelApp.env.ADMIN_EMAIL, password: vercelApp.env.ADMIN_PASSWORD },
  });
  check('Vercel: browser write from the site itself is accepted', login.status === 200);

  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  const write = await vercelApp.call('/admin/products', {
    method: 'POST', headers: { ...browser, Cookie: cookie },
    body: { name: 'Vercel product', price: 50000, stock: 5 },
  });
  check('Vercel: admin can create through the browser session', write.status === 201);

  const edit = await vercelApp.call(`/admin/products/${write.data.product.id}`, {
    method: 'PUT', headers: { ...browser, Cookie: cookie }, body: { price: 61000 },
  });
  check('Vercel: admin edit is saved', edit.status === 200 && edit.data.product.price === 61000);

  const foreign = await vercelApp.call('/admin/products', {
    method: 'POST', headers: { ...browser, Cookie: cookie, Origin: 'https://evil.example' },
    body: { name: 'Evil product', price: 1000 },
  });
  check('Vercel: cross-site write is still rejected', foreign.status === 403);

  // Chống flood (21/11/2026): trên Vercel, yêu cầu ghi kiểu script (không Origin) bị chặn ngay.
  const scriptBody = { full_name: 'Bot Python', phone: '0961234570', password: 'Bot-passphrase-123!' };
  const noOrigin = await vercelApp.call('/auth/register', { method: 'POST', body: scriptBody, headers: { 'X-Forwarded-Proto': 'https' } });
  check('Vercel: register without Origin (script) rejected 403', noOrigin.status === 403);
  const noOriginGuest = await vercelApp.call('/orders/guest', { method: 'POST', headers: { 'X-Forwarded-Proto': 'https' },
    body: { receiver_name: 'Bot', phone: '0961234571', address: 'Số 1 Lý Thái Tổ, Suối Hoa', delivery_area: 'bac-ninh', items: [{ product_id: 1, quantity: 1 }] } });
  check('Vercel: guest order without Origin (script) rejected 403', noOriginGuest.status === 403);
  const noCsrf = await vercelApp.call('/auth/register', { method: 'POST', body: scriptBody, headers: { ...browser, 'X-CSRF-Protection': '' } });
  check('Vercel: register with Origin but without X-CSRF-Protection rejected 403', noCsrf.status === 403);
  const real = await vercelApp.call('/auth/register', { method: 'POST', body: scriptBody, headers: browser });
  check('Vercel: real browser registration (Origin + CSRF header) still works', real.status === 201);

  check('Vercel: client IP comes from the proxy header, not the proxy itself',
    trustedProxy('', { VERCEL: '1' }) === 1 && trustedProxy('', {}) === false
    && trustedProxy('0', { VERCEL: '1' }) === false);
} finally {
  await vercelApp.close();
  await rm(vercelDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/* ---------------------------------------------------------------------------------------------------
 * Chống flood / bot (21/11/2026): ngưỡng chặt như trang thật để chứng minh script bắn dồn dập bị chặn.
 * ------------------------------------------------------------------------------------------------- */
const strict = await fixture({ REGISTER_LIMIT_PER_HOUR: '4', REGISTRATION_BREAKER_PER_5M: '1000' });
try {
  const reg = (body, headers) => strict.call('/auth/register', { method: 'POST', body, headers });
  const pw = 'Flood-passphrase-123!';
  // Kiểu script Python: không có X-CSRF-Protection.
  check('Script register without X-CSRF-Protection rejected 403',
    (await reg({ full_name: 'Bot', phone: '0961234501', password: pw }, { 'X-CSRF-Protection': '' })).status === 403);
  const products = (await strict.call('/products')).data.products;
  const item = products.find((p) => p.stock > 2 && p.price > 0);
  const guestBody = (phone, extra = {}) => ({ receiver_name: 'Khách Thử', phone, address: 'Số 7 Lý Thái Tổ, Suối Hoa', delivery_area: 'bac-ninh', items: [{ product_id: item.id, quantity: 1 }], ...extra });
  check('Script guest order without X-CSRF-Protection rejected 403',
    (await strict.call('/orders/guest', { method: 'POST', body: guestBody('0961234502'), headers: { 'X-CSRF-Protection': '' } })).status === 403);
  check('Script order tracking without X-CSRF-Protection rejected 403',
    (await strict.call('/orders/track', { method: 'POST', body: { phone: '0961234502' }, headers: { 'X-CSRF-Protection': '' } })).status === 403);
  // Đầu số giả / số lặp vô nghĩa.
  for (const phone of ['0001234567', '0112345678', '0999999999', '0741234567']) {
    const r = await strict.call('/orders/guest', { method: 'POST', body: guestBody(phone) });
    check(`Fake phone ${phone} rejected 400 (guest order)`, r.status === 400 && !!r.data.errors?.phone);
  }
  check('Fake phone rejected 400 (register)', (await reg({ full_name: 'Số Giả', phone: '0112345678', password: pw })).status === 400);
  // Bẫy bot: ô ẩn "website" có giá trị.
  check('Honeypot filled → 400', (await reg({ full_name: 'Bot Điền Form', phone: '0961234503', password: pw, website: 'http://spam.example' })).status === 400);
  // Đăng ký dồn dập từ một IP: tối đa 4 / giờ trong bài này (trang thật 5).
  const ok = await reg({ full_name: 'Khách Thật', phone: '0961234504', password: pw, website: '' });
  check('Real registration with empty honeypot succeeds', ok.status === 201);
  const burst = [];
  for (let i = 0; i < 4; i++) burst.push((await reg({ full_name: `Bot ${i}`, phone: `096123451${i}`, password: pw })).status);
  check('Registration spam beyond the per-IP limit gets 429', burst.includes(429) && burst[burst.length - 1] === 429);
} finally { await strict.close(); }

const breaker = await fixture({
  REGISTER_LIMIT_PER_HOUR: '1000', REGISTRATION_BREAKER_PER_5M: '3',
  GUEST_PENDING_BREAKER_PER_10M: '3', GUEST_SAME_CONTACT_PENDING: '2',
  TRACK_LIMIT_PER_15M: '3', TRANSFER_PROOF_LIMIT_PER_15M: '2', BCRYPT_CONCURRENCY: '1', BCRYPT_QUEUE: '2',
});
try {
  const pw = 'Flood-passphrase-123!';
  // Cầu dao đăng ký toàn hệ thống (bot xoay IP vẫn bị chặn vì đếm trong cơ sở dữ liệu).
  const regs = [];
  for (let i = 0; i < 4; i++) regs.push(await breaker.call('/auth/register', { method: 'POST', body: { full_name: `Khách ${i}`, phone: `096200000${i + 1}`, password: pw } }));
  check('Global registration breaker: 4th account within 5 minutes gets 429 "Hệ thống đang bận"',
    regs.slice(0, 3).every((r) => r.status === 201) && regs[3].status === 429 && /Hệ thống đang bận/.test(regs[3].data.message || ''));
  // Cầu dao đơn mua nhanh: cùng SĐT tối đa 2 đơn chờ xác nhận; toàn hệ thống tối đa 3 đơn / 10 phút.
  const item = (await breaker.call('/products')).data.products.find((p) => p.stock > 5 && p.price > 0);
  const guest = (phone, address = 'Số 7 Lý Thái Tổ, Suối Hoa') => breaker.call('/orders/guest', { method: 'POST',
    body: { receiver_name: 'Khách Thử', phone, address, delivery_area: 'bac-ninh', items: [{ product_id: item.id, quantity: 1 }] } });
  const stockBefore = (await breaker.call(`/products/${item.id}`)).data.product.stock;
  const g1 = await guest('0963000001');
  const g2 = await guest('0963000001', 'Số 8 Ngô Gia Tự, Tiền An');
  const g3 = await guest('0963000001', 'Số 9 Nguyễn Văn Cừ, Ninh Xá');
  check('Same phone with 2 pending guest orders: 3rd gets 429', g1.status === 201 && g2.status === 201 && g3.status === 429);
  const g4 = await guest('0963000002', 'Số 10 Kinh Dương Vương, Vũ Ninh');
  const g5 = await guest('0963000003', 'Số 11 Trần Hưng Đạo, Đại Phúc');
  check('Global guest-order breaker: 4th pending guest order within 10 minutes gets 429', g4.status === 201 && g5.status === 429);
  const stockAfter = (await breaker.call(`/products/${item.id}`)).data.product.stock;
  check('Blocked guest orders do not hold stock', stockBefore - stockAfter === 3);
  // Tra cứu đơn: tối đa 3 / 15 phút trong bài này (trang thật 15).
  const tracks = [];
  for (let i = 0; i < 4; i++) tracks.push((await breaker.call('/orders/track', { method: 'POST', body: { phone: `096300000${i}` } })).status);
  check('Order tracking beyond the limit gets 429', tracks[3] === 429);
  // Ảnh chuyển khoản: tối đa 2 / 15 phút trong bài này (trang thật 6).
  const proofs = [];
  for (let i = 0; i < 3; i++) {
    proofs.push((await breaker.call(`/orders/${g1.data.order.id}/transfer-proof`, { method: 'POST', raw: Buffer.from('not-an-image'), headers: { 'Content-Type': 'image/jpeg', 'X-Guest-Token': g1.data.guest_token } })).status);
  }
  check('Transfer-proof uploads beyond the limit get 429', proofs[2] === 429);
  // Hàng đợi bcrypt: 1 phép tính cùng lúc + hàng đợi 2 → bắn 8 đăng nhập cùng lúc thì phần dư bị 429 ngay.
  const logins = await Promise.all(Array.from({ length: 8 }, (_, i) => breaker.call('/auth/login', { method: 'POST', body: { identifier: `09640000${String(i).padStart(2, '0')}`, password: 'Wrong-passphrase-1!' } })));
  const busy = logins.filter((r) => r.status === 429 && /Máy chủ đang xử lý nhiều yêu cầu/.test(r.data.message || '')).length;
  check('bcrypt concurrency limiter sheds excess load with 429 (no bcrypt work)', busy >= 4 && logins.filter((r) => r.status === 401).length >= 1);
} finally { await breaker.close(); }

console.log(`${passed} security checks passed.`);
