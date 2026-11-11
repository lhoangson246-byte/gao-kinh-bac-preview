import db from './db.js';
import { localDate } from './constants.js';
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

export function listAdminOrders({ status, from = null, to = null, limit = 30, offset = 0 } = {}) {
  // Trang và dòng hàng phải cùng snapshot khi có đơn mới tới đồng thời.
  return db.transaction(() => {
  const range = from && to ? [`${localDate('created_at')} BETWEEN ? AND ?`] : [];
  const rangeArgs = from && to ? [from, to] : [];
  const where = [...(status ? ['status = ?'] : []), ...range];
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const args = [...(status ? [status] : []), ...rangeArgs, limit, offset];
  const page = `SELECT id FROM orders ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(`SELECT o.*, u.email AS user_email, u.full_name AS user_name, s.full_name AS shipper_name,
           w.code AS wholesale_code, w.company AS wholesale_company
    FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN users s ON s.id = o.shipper_id
    LEFT JOIN wholesale_customers w ON w.id = o.wholesale_customer_id
    WHERE o.id IN (${page}) ORDER BY o.id DESC`).all(...args);
  // Mã băm bí mật của đơn mua nhanh không cần lộ ra, kể cả với quản trị.
  for (const row of rows) {
    delete row.guest_token_hash;
    // Ảnh chứng từ chỉ xem được khi đăng nhập (GET /api/proofs/:id).
    if (row.delivery_photo) row.delivery_photo = `/api/proofs/${row.delivery_photo}`;
  }
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${page})
    ORDER BY order_id, id`).all(...args);
  const counts = Object.fromEntries(ORDER_STATUSES.map(s => [s, 0]));
  const countClause = range.length ? `WHERE ${range[0]}` : '';
  for (const row of db.prepare(`SELECT status, COUNT(*) AS n FROM orders ${countClause} GROUP BY status`).all(...rangeArgs)) counts[row.status] = row.n;
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
  return { orders: attachItems(rows, items, 'order_id'), total: status ? counts[status] : counts.all, counts, limit, offset };
  })();
}
