// Duy trì đăng nhập cho tới khi đăng xuất: phiên 30 ngày, gia hạn mỗi lần mở ứng dụng.
// Cách chạy: node test/session-refresh.mjs (tự dựng máy chủ và cơ sở dữ liệu riêng).
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { fixture } from './fixture.mjs';

const app = await fixture();
try {
  const login = await app.call('/auth/login', {
    method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD },
  });
  assert.equal(login.status, 200);
  const token = login.data.token;
  const claims = jwt.decode(token);
  assert.ok(Number.isSafeInteger(claims.auth_time), 'token có ghi lúc đăng nhập');

  // Gia hạn: token mới dùng được, giữ nguyên lúc đăng nhập.
  const refreshed = await app.call('/auth/refresh', { method: 'POST', token });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.data.token, 'trả token mới');
  assert.equal(jwt.decode(refreshed.data.token).auth_time, claims.auth_time, 'gia hạn không đặt lại lúc đăng nhập');
  assert.equal((await app.call('/admin/orders/latest', { token: refreshed.data.token })).status, 200);

  // Chưa đăng nhập thì không gia hạn được.
  assert.equal((await app.call('/auth/refresh', { method: 'POST' })).status, 401);

  // Ký token như máy chủ, với lúc cấp (iat) và lúc đăng nhập (auth_time) tuỳ ý.
  const now = Math.floor(Date.now() / 1000);
  const sign = ({ iat, authTime }) => jwt.sign(
    { id: claims.id, version: claims.version, auth_time: authTime, iat },
    app.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'gao-shop', audience: 'gao-shop-api', expiresIn: '30d' },
  );
  const day = 24 * 3600;

  // Duy trì đăng nhập: token cấp 20 ngày trước (đăng nhập từ 60 ngày trước) vẫn dùng và gia hạn được.
  const old = sign({ iat: now - 20 * day, authTime: now - 60 * day });
  assert.equal((await app.call('/auth/me', { token: old })).status, 200, 'phiên 20 ngày vẫn còn');
  const renewed = await app.call('/auth/refresh', { method: 'POST', token: old });
  assert.equal(renewed.status, 200, 'không còn giới hạn tổng thời gian đăng nhập');
  assert.ok(jwt.decode(renewed.data.token).exp - now > 29 * day, 'gia hạn thêm ~30 ngày');
  // 30 ngày liền không mở ứng dụng thì phiên hết hạn.
  const expired = sign({ iat: now - 31 * day, authTime: now - 31 * day });
  assert.equal((await app.call('/auth/refresh', { method: 'POST', token: expired })).status, 401, 'quá 30 ngày thì hết hạn');

  // Cookie phiên trên trình duyệt cũng sống 30 ngày.
  const browser = await app.call('/auth/login', {
    method: 'POST',
    headers: { 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1', Origin: 'https://shop.example' },
    body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD },
  });
  const maxAge = Number((browser.headers.get('set-cookie') || '').match(/Max-Age=(\d+)/)?.[1]);
  assert.ok(maxAge >= 29 * day && maxAge <= 30 * day, `cookie sống 30 ngày (Max-Age=${maxAge})`);

  // Đăng xuất làm mọi token cũ mất hiệu lực, kể cả để gia hạn.
  assert.equal((await app.call('/auth/logout', { method: 'POST', token: refreshed.data.token })).status, 200);
  assert.equal((await app.call('/auth/refresh', { method: 'POST', token: refreshed.data.token })).status, 401);

  console.log('Session: stays logged in (30-day sliding, no total cap), expires after 30 idle days, logout revokes.');
} finally {
  await app.close();
}
