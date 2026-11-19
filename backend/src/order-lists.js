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

// Đơn chuyển khoản khách đã gửi ảnh, cửa hàng chưa xác nhận nhận tiền.
const TRANSFER_PENDING = "payment_method = 'bank' AND transfer_reported_at IS NOT NULL AND transfer_confirmed_at IS NULL AND status <> 'cancelled'";

/**
 * Ngày của một đơn khi lọc theo ngày (18/11/2026): đơn Hoàn thành tính theo ngày giao xong, đơn Đã huỷ theo
 * ngày huỷ, đơn đang xử lý theo ngày đặt. Nhờ vậy chọn "Hôm nay" ở mục Hoàn thành thấy đúng các đơn giao xong
 * hôm nay, kể cả đơn đặt từ hôm trước. Đơn cũ chưa ghi giờ hoàn thành / huỷ thì dùng ngày đặt.
 */
export const orderDaySql = (prefix = '') => `CASE ${prefix}status WHEN 'completed' THEN COALESCE(${prefix}completed_at, ${prefix}created_at)
  WHEN 'cancelled' THEN COALESCE(${prefix}cancelled_at, ${prefix}created_at) ELSE ${prefix}created_at END`;

export function listAdminOrders({ status, from = null, to = null, limit = 30, offset = 0, transferPending = false } = {}) {
  // Trang và dòng hàng phải cùng snapshot khi có đơn mới tới đồng thời.
  return db.transaction(() => {
  const range = from && to ? [`${localDate(`(${orderDaySql()})`)} BETWEEN ? AND ?`] : [];
  const rangeArgs = from && to ? [from, to] : [];
  const where = [...(status ? ['status = ?'] : []), ...range, ...(transferPending ? [TRANSFER_PENDING] : [])];
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const args = [...(status ? [status] : []), ...rangeArgs, limit, offset];
  const page = `SELECT id FROM orders ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(`SELECT o.*, u.email AS user_email, u.full_name AS user_name, s.full_name AS shipper_name,
           w.code AS wholesale_code, w.company AS wholesale_company, tc.full_name AS transfer_confirmed_name
    FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN users s ON s.id = o.shipper_id
    LEFT JOIN users tc ON tc.id = o.transfer_confirmed_by
    LEFT JOIN wholesale_customers w ON w.id = o.wholesale_customer_id
    WHERE o.id IN (${page}) ORDER BY o.id DESC`).all(...args);
  // Mã băm bí mật của đơn mua nhanh không cần lộ ra, kể cả với quản trị.
  for (const row of rows) {
    delete row.guest_token_hash;
    // Ảnh chứng từ chỉ xem được khi đăng nhập (GET /api/proofs/:id).
    if (row.delivery_photo) row.delivery_photo = `/api/proofs/${row.delivery_photo}`;
    if (row.transfer_proof) row.transfer_proof = `/api/proofs/${row.transfer_proof}`;
  }
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${page})
    ORDER BY order_id, id`).all(...args);
  // Trả / đổi hàng (19/11/2026): số đã trả của từng dòng và danh sách phiếu của từng đơn.
  const returned = new Map(db.prepare(`
    SELECT ri.order_item_id AS id, SUM(ri.quantity) AS q FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id
    WHERE r.order_id IN (${page}) GROUP BY ri.order_item_id
  `).all(...args).map((r) => [r.id, r.q]));
  for (const item of items) item.returned = returned.get(item.id) || 0;
  const returns = db.prepare(`
    SELECT order_id, code, return_type, refund_amount, refund_method, restock, warehouse, reason, actor_name, created_at
    FROM order_returns WHERE order_id IN (${page}) ORDER BY id
  `).all(...args);
  for (const row of rows) row.returns = returns.filter((r) => r.order_id === row.id);
  const counts = Object.fromEntries(ORDER_STATUSES.map(s => [s, 0]));
  const countClause = range.length ? `WHERE ${range[0]}` : '';
  for (const row of db.prepare(`SELECT status, COUNT(*) AS n FROM orders ${countClause} GROUP BY status`).all(...rangeArgs)) counts[row.status] = row.n;
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
  const transferCount = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${TRANSFER_PENDING}`).get().n;
  const total = transferPending
    ? db.prepare(`SELECT COUNT(*) AS n FROM orders ${clause}`).get(...args.slice(0, -2)).n
    : status ? counts[status] : counts.all;
  return { orders: attachItems(rows, items, 'order_id'), total, counts, transfer_pending: transferCount, limit, offset };
  })();
}
