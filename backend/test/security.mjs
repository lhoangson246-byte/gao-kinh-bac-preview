import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { fixture, run } from './fixture.mjs';

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
  check('Cookie mutation without CSRF header rejected', (await call('/auth/me', { method: 'PUT', headers: { Cookie: browserSession }, body: { full_name: 'Changed' } })).status === 403);
  check('Untrusted origin rejected even with CSRF header', (await call('/auth/me', { method: 'PUT', headers: { ...browserHeaders, Cookie: browserSession, Origin: 'https://evil.example' }, body: { full_name: 'Changed' } })).status === 403);
  check('Allowed cookie mutation succeeds', (await call('/auth/me', { method: 'PUT', headers: { ...browserHeaders, Cookie: browserSession }, body: { full_name: 'Changed' } })).status === 200);
  const product = await call('/admin/products', { method: 'POST', token: admin, body: { name: 'Security product', price: 50000, cost_price: 31000, stock: 100 } });
  assert.equal(product.status, 201);
  const pid = product.data.product.id;
  const list = await call('/products');
  check('Public catalog and detail exclude cost_price', list.data.products.every((p) => !('cost_price' in p)) && !('cost_price' in (await call(`/products/${pid}`)).data.product));
  check('API has no-store, CSP and nosniff', list.headers.get('cache-control') === 'no-store' && list.headers.get('content-security-policy') && list.headers.get('x-content-type-options') === 'nosniff');
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
console.log(`${passed} security checks passed.`);
