import db from './db.js';
import { ORDER_STATUSES } from './constants.js';

export function attachItems(rows, items, foreignKey) {
  const groups = new Map();
  for (const item of items) {
    const key = item[foreignKey];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return rows.map(row => ({ ...row, items: groups.get(row.id) || [] }));
}

export function listAdminOrders({ status, limit = 30, offset = 0 } = {}) {
  // Trang và dòng hàng phải cùng snapshot khi có đơn mới tới đồng thời.
  return db.transaction(() => {
  const clause = status ? 'WHERE status = ?' : '';
  const args = status ? [status, limit, offset] : [limit, offset];
  const page = `SELECT id FROM orders ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(`SELECT o.*, u.email AS user_email, u.full_name AS user_name
    FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.id IN (${page}) ORDER BY o.id DESC`).all(...args);
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${page})
    ORDER BY order_id, id`).all(...args);
  const counts = Object.fromEntries(ORDER_STATUSES.map(s => [s, 0]));
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()) counts[row.status] = row.n;
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
  return { orders: attachItems(rows, items, 'order_id'), total: status ? counts[status] : counts.all, counts, limit, offset };
  })();
}
