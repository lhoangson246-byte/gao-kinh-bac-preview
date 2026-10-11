// Phiên đăng nhập tự gia hạn: token 1 giờ, gia hạn được tối đa 16 giờ kể từ lúc đăng nhập.
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

  const sign = (authTime) => jwt.sign(
    { id: claims.id, version: claims.version, auth_time: authTime },
    app.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'gao-shop', audience: 'gao-shop-api', expiresIn: '1h' },
  );
  const now = Math.floor(Date.now() / 1000);

  // Đăng nhập 15 giờ trước: vẫn gia hạn được.
  assert.equal((await app.call('/auth/refresh', { method: 'POST', token: sign(now - 15 * 3600) })).status, 200);
  // Đăng nhập quá 16 giờ: phải đăng nhập lại.
  const stale = await app.call('/auth/refresh', { method: 'POST', token: sign(now - 16 * 3600 - 60) });
  assert.equal(stale.status, 401);

  // Đăng xuất làm mọi token cũ mất hiệu lực, kể cả để gia hạn.
  assert.equal((await app.call('/auth/logout', { method: 'POST', token: refreshed.data.token })).status, 200);
  assert.equal((await app.call('/auth/refresh', { method: 'POST', token: refreshed.data.token })).status, 401);

  console.log('Session refresh: sliding renewal works, 16h cap and logout revocation enforced.');
} finally {
  await app.close();
}
