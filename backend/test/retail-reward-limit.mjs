import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

const app = await fixture();
try {
  const login = await app.call('/auth/login', {
    method: 'POST',
    body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD },
  });
  assert.equal(login.status, 200);
  const token = login.data.token;
  const phone = '0912345678';

  const product = await app.call('/admin/products', {
    method: 'POST', token,
    body: { name: 'Gạo thử giới hạn điểm', price: 25_000_000, stock: 0, unit: 'kg' },
  });
  assert.equal(product.status, 201);

  const earn = await app.call('/retail/invoices', {
    method: 'POST', token,
    body: { phone, items: [{ product_id: product.data.product.id, quantity: 1 }] },
  });
  assert.equal(earn.status, 201);
  const before = await app.call(`/retail/customers?phone=${phone}`, { token });
  assert.equal(before.data.customer.points, 25_000);

  const policy = await app.call('/retail/policy', { token });
  const rewardId = policy.data.policy.rewards[0]?.id;
  assert.ok(rewardId);

  const tooMany = await app.call('/retail/invoices', {
    method: 'POST', token,
    body: { phone, rewards: [{ product_id: rewardId, quantity: 21 }] },
  });
  assert.equal(tooMany.status, 400, 'More than 20 rewards must be rejected');
  const duplicated = await app.call('/retail/invoices', {
    method: 'POST', token,
    body: { phone, rewards: [
      { product_id: rewardId, quantity: 11 }, { product_id: rewardId, quantity: 10 },
    ] },
  });
  assert.equal(duplicated.status, 400, 'Duplicate reward lines cannot bypass the total');
  const mixed = await app.call('/retail/invoices', {
    method: 'POST', token,
    body: { phone, items: [{ product_id: product.data.product.id, quantity: 1 }],
      rewards: [{ product_id: rewardId, quantity: 20 }], voucher_count: 1 },
  });
  assert.equal(mixed.status, 400, 'Rewards and vouchers share the limit');
  const unchanged = await app.call(`/retail/customers?phone=${phone}`, { token });
  assert.equal(unchanged.data.customer.points, 25_000);

  const allowed = await app.call('/retail/invoices', {
    method: 'POST', token,
    body: { phone, rewards: [{ product_id: rewardId, quantity: 20 }] },
  });
  assert.equal(allowed.status, 201, '20 rewards remain valid');
  assert.equal(allowed.data.invoice.points_used, 20_000);
  const after = await app.call(`/retail/customers?phone=${phone}`, { token });
  assert.equal(after.data.customer.points, 5_000);
  console.log('Retail reward limit: attack rejected, valid sale preserved.');
} finally {
  await app.close();
}
