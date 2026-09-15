// Remote libSQL regressions, enforced locally by the strict fixture guard.
import assert from 'node:assert/strict';
import { fixture, run } from './fixture.mjs';
const app = await fixture();
let passed = 0;
const check = (name, ok) => { assert.ok(ok, name); passed++; console.log('PASS ' + name); };
try {
  const login = await app.call('/auth/login', { method: 'POST', body: {
    identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD,
  } });
  assert.equal(login.status, 200);
  const token = login.data.token;
  const created = await app.call('/admin/products', { method: 'POST', token, body: {
    name: 'Gạo kiểm tra tham số', description: 'Mô tả gốc', origin: 'Bắc Ninh',
    price: 12500, cost_price: 9000, unit: 'kg', weight_kg: 1, stock: 10,
  } });
  check('Product insert binds every value', created.status === 201 && created.data.product.description === 'Mô tả gốc' && created.data.product.cost_price === 9000);
  const id = created.data.product.id;
  const description = "Mô tả mới có dấu, 'nháy', @tên và %";
  const changed = await app.call('/admin/products/' + id, { method: 'PUT', token, body: { description } });
  check('Partial save returns the updated description', changed.status === 200 && changed.data.product.description === description);
  const products = await app.call('/admin/products', { token });
  const fresh = products.data.products.find(p => p.id === id);
  check('Fresh GET verifies persistence and untouched fields', fresh.description === description && fresh.name === created.data.product.name && fresh.price === 12500 && fresh.stock === 10);
  const unknown = await app.call('/admin/products/999999999', { method: 'PUT', token, body: { description } });
  check('Unknown product never reports successful save', unknown.status === 404);
  const guard = await run('--input-type=module', app.env, ['--eval', `
    import assert from 'node:assert/strict';
    import db from './src/db.js';
    assert.throws(() => db.prepare('SELECT @value AS value').get({value: 5}), /positional SQL bindings/);
    assert.equal(db.prepare('SELECT ? AS value').get(5).value, 5);
    const outside = db.prepare('SELECT 1');
    assert.throws(() => db.transaction(() => outside.get())(), /transaction/);
    db.prepare("UPDATE products SET weight_kg = 0 WHERE id = ?").run(${id});
    db.close();
  `]);
  check('Strict guard rejects named bindings and cross-transaction statements', guard.code === 0);
  if (guard.code) console.log(guard.output);
  const migrated = await run('src/migrate-cli.js', app.env);
  check('Existing product weight backfill uses its transaction session', migrated.code === 0);
  if (migrated.code) console.log(migrated.output);
} finally { await app.close(); }
console.log(passed + ' binding checks passed.');
