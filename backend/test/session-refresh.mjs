// Duy trì đăng nhập cho tới khi đăng xuất: phiên 90 ngày, gia hạn mỗi lần mở ứng dụng.
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
    { algorithm: 'HS256', issuer: 'gao-shop', audience: 'gao-shop-api', expiresIn: '90d' },
  );
  const day = 24 * 3600;

  // Duy trì đăng nhập: token cấp 80 ngày trước (đăng nhập từ 200 ngày trước) vẫn dùng và gia hạn được.
  const old = sign({ iat: now - 80 * day, authTime: now - 200 * day });
  assert.equal((await app.call('/auth/me', { token: old })).status, 200, 'phiên 80 ngày vẫn còn');
  const renewed = await app.call('/auth/refresh', { method: 'POST', token: old });
  assert.equal(renewed.status, 200, 'không còn giới hạn tổng thời gian đăng nhập');
  assert.ok(jwt.decode(renewed.data.token).exp - now > 89 * day, 'gia hạn thêm ~90 ngày');
  // 90 ngày liền không mở ứng dụng thì phiên hết hạn.
  const expired = sign({ iat: now - 91 * day, authTime: now - 91 * day });
  assert.equal((await app.call('/auth/refresh', { method: 'POST', token: expired })).status, 401, 'quá 90 ngày thì hết hạn');

  // Cookie phiên trên trình duyệt cũng sống 90 ngày, HttpOnly, SameSite=Lax.
  const browser = await app.call('/auth/login', {
    method: 'POST',
    headers: { 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1', Origin: 'https://shop.example' },
    body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD },
  });
  const maxAge = Number((browser.headers.get('set-cookie') || '').match(/Max-Age=(\d+)/)?.[1]);
  const setCookie = browser.headers.get('set-cookie') || '';
  assert.ok(maxAge >= 89 * day && maxAge <= 90 * day, `cookie sống 90 ngày (Max-Age=${maxAge})`);
  assert.match(setCookie, /HttpOnly/i, 'cookie HttpOnly');
  assert.match(setCookie, /SameSite=Lax/i, 'cookie SameSite=Lax');
  assert.match(setCookie, /Secure/i, 'cookie Secure khi chạy production');
  // Gia hạn qua cookie cũng đặt lại cookie 90 ngày (sliding).
  const cookieValue = setCookie.split(';')[0];
  const slide = await app.call('/auth/refresh', {
    method: 'POST',
    headers: { Cookie: cookieValue, 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1', Origin: 'https://shop.example' },
  });
  assert.equal(slide.status, 200);
  const slideAge = Number((slide.headers.get('set-cookie') || '').match(/Max-Age=(\d+)/)?.[1]);
  assert.ok(slideAge >= 89 * day, `gia hạn đặt lại cookie 90 ngày (Max-Age=${slideAge})`);

  // Đăng xuất làm mọi token cũ mất hiệu lực, kể cả để gia hạn.
  assert.equal((await app.call('/auth/logout', { method: 'POST', token: refreshed.data.token })).status, 200);
  assert.equal((await app.call('/auth/refresh', { method: 'POST', token: refreshed.data.token })).status, 401);

  console.log('Session: stays logged in (90-day sliding, no total cap), expires after 90 idle days, logout revokes.');
} finally {
  await app.close();
}
