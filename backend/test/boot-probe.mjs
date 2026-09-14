// Đếm lời gọi thực thi, không tính prepare là một lần thực thi SQL.
import Database from 'libsql';
import bcrypt from 'bcryptjs';
import { performance } from 'node:perf_hooks';

const counts = { executed: 0, prepares: 0, hashes: 0, compares: 0 };
const statements = [];
const exec = Database.prototype.exec;
Database.prototype.exec = function (sql, ...args) {
  counts.executed++; statements.push(sql.trim().split('\n')[0]);
  return exec.call(this, sql, ...args);
};
const prepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql, ...args) {
  counts.prepares++;
  const statement = prepare.call(this, sql, ...args);
  for (const method of ['run', 'get', 'all']) {
    const original = statement[method];
    statement[method] = function (...values) {
      counts.executed++; statements.push(sql.trim().split('\n')[0]);
      return original.apply(this, values);
    };
  }
  return statement;
};
let comparing = 0;
for (const method of ['hash', 'hashSync', 'compare', 'compareSync']) {
  const original = bcrypt[method];
  bcrypt[method] = function (...args) {
    const comparison = method.startsWith('compare');
    if (comparison) { counts.compares++; comparing++; }
    else if (!comparing) counts.hashes++;
    try { return original.apply(this, args); }
    finally { if (comparison) comparing--; }
  };
}
const started = performance.now();
await import('../src/server.js');
const elapsedMs = performance.now() - started;
console.log(JSON.stringify({ ...counts, elapsedMs: Math.round(elapsedMs), statements }));
const { default: db } = await import('../src/db.js');
console.log(JSON.stringify({ indexes: db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index'").all(), plans: [
  'SELECT * FROM orders WHERE user_id = 1 ORDER BY id DESC LIMIT 30',
  "SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC LIMIT 30",
  'SELECT * FROM order_items WHERE order_id = 1',
  'SELECT * FROM retail_invoice_items WHERE invoice_id = 1',
  "SELECT * FROM retail_invoices WHERE created_at BETWEEN '2026-09-01' AND '2026-10-01'",
].map(sql => ({ sql, plan: db.prepare('EXPLAIN QUERY PLAN ' + sql).all() })) }));
db.close();
