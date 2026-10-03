import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

const app = await fixture();
try {
  const register = async (phone) => app.call('/auth/register', {
    method: 'POST',
    body: { full_name: 'Khách kiểm tra địa chỉ', phone, password: 'Temporary-test-password-2026' },
  });
  const first = await register('0912345678');
  assert.equal(first.status, 201);
  const token = first.data.token;
  const body = { receiver_name: 'Khách kiểm tra', phone: '0912345678', address: 'Số 1 đường Trần Phú, Bắc Ninh' };

  for (let i = 0; i < 9; i++) {
    assert.equal((await app.call('/addresses', { method: 'POST', token, body })).status, 201);
  }
  const pair = await Promise.all([
    app.call('/addresses', { method: 'POST', token, body }),
    app.call('/addresses', { method: 'POST', token, body }),
  ]);
  assert.deepEqual(pair.map((result) => result.status).sort(), [201, 400]);
  assert.equal((await app.call('/addresses', { token })).data.addresses.length, 10);

  const second = await register('0912345679');
  assert.equal(second.status, 201);
  assert.equal((await app.call('/addresses', { method: 'POST', token: second.data.token, body })).status, 201);
  console.log('Address limit: excess request rejected, valid second account preserved.');
} finally {
  await app.close();
}
