import assert from 'node:assert/strict';
import { fixture, run } from './fixture.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
let passed = 0;
const check = (name, ok) => { assert.ok(ok, name); passed++; console.log('PASS ' + name); };
const directory = await mkdtemp(path.join(tmpdir(), 'gao-performance-'));
let app;
try {
  app = await fixture({ LIBSQL_URL: 'file:' + path.join(directory, 'app.db').replaceAll('\\', '/') });
  const probe = await run('test/boot-probe.mjs', app.env);
  assert.equal(probe.code, 0, probe.output);
  const counts = JSON.parse(probe.output.split('\n').find(line => line.startsWith('{"executed"')));
  console.log(JSON.stringify(counts));
  check('Mỗi boot libSQL chỉ thực thi tối đa hai lời gọi SQL', counts.executed <= 2);
  check('Boot không băm mật khẩu', counts.hashes === 0);
  const code = `
    import assert from 'node:assert/strict';
    import bcrypt from 'bcryptjs';
    let hashes = 0, compares = 0;
    for (const method of ['hash','hashSync','compare','compareSync']) {
      const original = bcrypt[method];
      bcrypt[method] = (...args) => { if (method.startsWith('hash')) hashes++; else compares++; return original(...args); };
    }
    await import('./src/routes/auth.js');
    assert.equal(hashes, 0); assert.equal(compares, 0);
    const { default: serverApp } = await import('./src/server.js');
    const server = serverApp.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening',resolve));
    compares = 0;
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/login', {
      method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({identifier:'0000000998',password:'Not-a-real-password!'})
    });
    assert.equal(response.status,401); assert.equal(compares,1);
    const { default: db } = await import('./src/db.js');
    const { listAdminOrders } = await import('./src/order-lists.js');
    const adminId = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get().id;
    db.transaction(() => {
      const insertOrder = db.prepare("INSERT INTO orders(user_id,receiver_name,phone,address,total,status) VALUES (?, 'QA', '0000000998', 'QA Bắc Ninh', 100, 'pending')");
      const insertItem = db.prepare("INSERT INTO order_items(order_id,product_name,unit,price,quantity) VALUES (?, 'QA', 'kg', 100, 1)");
      for (let n = 0; n < 105; n++) insertItem.run(insertOrder.run(adminId).lastInsertRowid);
    })();
    let executions = 0;
    const original = db.prepare.bind(db);
    db.prepare = (...args) => {
      const statement = original(...args);
      for (const method of ['all','get','run']) {
        const execute = statement[method].bind(statement);
        statement[method] = (...values) => { executions++; return execute(...values); };
      }
      return statement;
    };
    for (const limit of [1,30,100]) {
      executions=0; const page = listAdminOrders({limit}); assert.equal(executions,3);
      assert.equal(page.orders.length,limit); assert.equal(page.total,105);
      assert.ok(page.orders.every(order => order.items.length === 1));
    }
    server.close(); db.close(); console.log('verified');
  `;
  const result = await run('--input-type=module', app.env, ['--eval', code]);
  check('Import auth không gọi bcrypt; login lạ vẫn compare; số truy vấn danh sách cố định', result.code === 0 && result.output.includes('verified'));
  if (result.code) console.log(result.output);
  const stale = await run('--input-type=module', app.env, ['--eval', `
    import db from './src/db.js'; db.prepare("DELETE FROM app_migrations WHERE name LIKE 'schema:%'").run(); db.close();
  `]);
  assert.equal(stale.code, 0);
  const rejected = await run('test/boot-probe.mjs', app.env);
  check('Production từ chối schema cũ và yêu cầu migrate', rejected.code !== 0 && rejected.output.includes('Stale schema'));
  const migrated = await run('src/migrate-cli.js', app.env);
  check('Chạy migration lại khôi phục schema', migrated.code === 0);
} finally {
  await app?.close();
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('gao-performance-')) throw new Error('Unsafe cleanup');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
console.log(`${passed} performance checks passed.`);
