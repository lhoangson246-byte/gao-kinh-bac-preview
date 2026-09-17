import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { migrate } from '../src/migrate.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gao-test-order-cleanup-'));
const db = await openDatabase({ NODE_ENV: 'test', DATA_DIR: dataDir, DB_STRICT_TRANSACTIONS: '1' });

try {
  migrate(db);

  const addUser = db.prepare(`
    INSERT INTO users (full_name, email, password_hash, phone)
    VALUES (?, ?, 'not-used-in-this-test', ?)
  `);
  const nguyenUser = Number(addUser.run('Nguyễn Văn Test', 'nguyen-test@example.com', '0900000001').lastInsertRowid);
  const coTamUser = Number(addUser.run('Cô Tám', 'cotam-test@example.com', '0900000002').lastInsertRowid);
  const realUser = Number(addUser.run('Khách thật', 'real@example.com', '0900000003').lastInsertRowid);
  const renamedTestUser = Number(addUser.run('Khách Mới Toanh', 'renamed-test@example.com', '0900000004').lastInsertRowid);

  const productId = Number(db.prepare(`
    INSERT INTO products (name, price, unit, stock) VALUES ('Gạo ST25', 100000, 'túi 5kg', 1)
  `).run().lastInsertRowid);

  db.prepare(`
    INSERT INTO retail_customers (phone, full_name, points, total_spent, visit_count)
    VALUES (?, ?, ?, ?, ?)
  `).run('0900000001', 'Nguyễn Văn Test', 10, 100000, 2);
  db.prepare(`
    INSERT INTO retail_customers (phone, full_name, points, total_spent, visit_count)
    VALUES (?, ?, ?, ?, ?)
  `).run('0900000002', 'Cô Tám', 50, 500000, 4);

  const addOrder = db.prepare(`
    INSERT INTO orders
      (user_id, receiver_name, phone, address, total, subtotal, status, points_earned, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const addItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, unit, price, quantity)
    VALUES (?, ?, ?, 'túi 5kg', 100000, ?)
  `);
  function order(userId, receiver, phone, address, status, total, points, itemName, quantity) {
    const id = Number(addOrder.run(
      userId, receiver, phone, address, total, total, status, points, '2026-09-07 10:00:00'
    ).lastInsertRowid);
    addItem.run(id, productId, itemName, quantity);
    return id;
  }

  const smokeCompleted = order(
    nguyenUser, 'Nguyễn Văn Test', '0912345678',
    'Số 1, đường Ngô Gia Tự, phường Tiền An, Bắc Ninh',
    'completed', 100000, 10, 'Gạo kiểm thử 5kg', 2
  );
  const smokeCancelled = order(
    nguyenUser, 'Nguyễn Văn Test', '0912345678',
    'Số 1, đường Ngô Gia Tự, phường Tiền An, Bắc Ninh',
    'cancelled', 100000, 0, 'Gạo tồn ít 5kg', 3
  );
  const manageCompleted = order(
    coTamUser, 'Cô Tám', '0900000002',
    'Số 9, đường Ngô Gia Tự, phường Tiền An, Bắc Ninh',
    'completed', 200000, 20, 'Gạo ST25', 1
  );
  const managePending = order(
    coTamUser, 'Cô Tám', '0900000002',
    'Số 9, đường Ngô Gia Tự, phường Tiền An, Bắc Ninh',
    'pending', 200000, 0, 'Gạo ST25', 2
  );
  const realOrder = order(
    realUser, 'hahahahamyson le', '0900000003',
    'Địa chỉ khách thật, Bắc Ninh',
    'cancelled', 100000, 0, 'Gạo ST25', 1
  );
  const wrongAddress = order(
    coTamUser, 'Cô Tám', '0900000002',
    'Một địa chỉ khác, Bắc Ninh',
    'pending', 100000, 0, 'Gạo ST25', 1
  );
  db.prepare(`
    INSERT INTO orders
      (id, user_id, receiver_name, phone, address, total, subtotal, status, points_earned, created_at)
    VALUES (181, ?, 'Cô Tám', '0900000004', ?, 100000, 100000, 'pending', 0, '2026-09-08 15:35:06')
  `).run(renamedTestUser, 'Số 9, đường Ngô Gia Tự, phường Tiền An, Bắc Ninh');
  addItem.run(181, productId, 'Gạo ST25', 1);

  db.prepare("DELETE FROM app_migrations WHERE name = 'cleanup:test-orders:2026-09-17-v1'").run();
  db.prepare("DELETE FROM app_migrations WHERE name = 'cleanup:test-orders:2026-09-17-v2'").run();
  migrate(db);

  const remaining = db.prepare('SELECT id FROM orders ORDER BY id').all().map((row) => row.id);
  assert.deepEqual(remaining, [realOrder, wrongAddress]);
  for (const id of [smokeCompleted, smokeCancelled, manageCompleted, managePending]) {
    assert.equal(db.prepare('SELECT COUNT(*) count FROM order_items WHERE order_id = ?').get(id).count, 0);
  }
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders WHERE id = 181').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM order_items WHERE order_id = 181').get().count, 0);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock, 7);
  assert.deepEqual(
    db.prepare('SELECT points, total_spent, visit_count FROM retail_customers WHERE phone = ?').get('0900000001'),
    { points: 0, total_spent: 0, visit_count: 1 }
  );
  assert.deepEqual(
    db.prepare('SELECT points, total_spent, visit_count FROM retail_customers WHERE phone = ?').get('0900000002'),
    { points: 30, total_spent: 300000, visit_count: 3 }
  );

  migrate(db);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock, 7);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM app_migrations WHERE name = 'cleanup:test-orders:2026-09-17-v1'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM app_migrations WHERE name = 'cleanup:test-orders:2026-09-17-v2'").get().count, 1);
  console.log('✓ Cleanup removes only fingerprinted test orders and is idempotent');
} finally {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
