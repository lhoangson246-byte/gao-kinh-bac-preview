import db from './db.js';
import { HttpError, cleanText, toInteger } from './validate.js';
import { LIMITS } from './constants.js';
import { isWarehouse, moveStock } from './inventory.js';
import { loyaltyPhoneForOrder } from './loyalty.js';

/**
 * Trả hàng / đổi hàng cho ĐƠN ONLINE đã giao xong (19/11/2026), cùng kiểu phiếu đổi trả ở quầy.
 *  - Trả hàng: hoàn tiền (tiền mặt hoặc chuyển khoản), trừ lại điểm theo tỉ lệ tiền hoàn.
 *  - Đổi hàng: không hoàn tiền.
 *  - "Nhập lại kho": hàng khách trả cộng lại vào kho chọn (mặc định kho đã xuất đơn), có ghi nhật ký kho.
 *    Hàng hỏng không bán lại được, hoặc đổi cùng loại thì bỏ chọn.
 * Tiền hoàn tính vào Đóng ngày của kho đã xuất đơn, theo ngày lập phiếu trả.
 */
export const orderReturnCode = (id) => `TD${String(id).padStart(6, '0')}`;
const MAX_LINES = 100;

export function createOrderReturn(orderId, body, actor) {
  const returnType = body?.return_type;
  if (!['return', 'exchange'].includes(returnType)) throw new HttpError(400, 'Chọn trả hàng (hoàn tiền) hoặc đổi hàng.');
  const reason = cleanText(body?.reason, LIMITS.note);
  if (!reason || reason.length < 3) throw new HttpError(400, 'Vui lòng nhập lý do trả / đổi hàng.', { reason: 'Nhập lý do.' });
  const note = cleanText(body?.note, LIMITS.note);
  const restock = body?.restock !== false;

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > MAX_LINES) throw new HttpError(400, 'Chọn ít nhất một món khách trả.', { items: 'Chọn món khách trả.' });
  const wanted = new Map();
  for (const row of rawItems) {
    const itemId = toInteger(row?.order_item_id, { min: 1 });
    const quantity = toInteger(row?.quantity, { min: 0, max: 100000 });
    if (!itemId || quantity == null) throw new HttpError(400, 'Món hoặc số lượng trả không hợp lệ.', { items: 'Số lượng trả không hợp lệ.' });
    if (quantity > 0) wanted.set(itemId, (wanted.get(itemId) || 0) + quantity);
  }
  if (!wanted.size) throw new HttpError(400, 'Nhập số lượng khách trả cho ít nhất một món.', { items: 'Nhập số lượng trả.' });

  const refundMethod = returnType === 'exchange' ? 'none' : body?.refund_method || 'cash';
  if (!['cash', 'transfer', 'none'].includes(refundMethod) || (returnType === 'return' && refundMethod === 'none')) {
    throw new HttpError(400, 'Hình thức hoàn tiền không hợp lệ.', { refund_method: 'Chọn tiền mặt hoặc chuyển khoản.' });
  }

  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    if (order.status !== 'completed') throw new HttpError(400, 'Chỉ trả / đổi hàng cho đơn đã giao xong. Đơn chưa giao thì huỷ đơn.');
    if (order.payment_status === 'debt') {
      throw new HttpError(400, 'Đơn công nợ chưa trả / đổi hàng ở đây được. Báo kế toán điều chỉnh công nợ.');
    }
    const warehouse = body?.warehouse || order.warehouse || 'KH_BS';
    if (restock && !isWarehouse(warehouse)) throw new HttpError(400, 'Chọn kho nhập lại hàng.', { warehouse: 'Kho không hợp lệ.' });

    const getItem = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?');
    const returnedOf = db.prepare(`
      SELECT COALESCE(SUM(ri.quantity), 0) AS q FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id
      WHERE r.order_id = ? AND ri.order_item_id = ?
    `);
    const selected = [];
    let value = 0;
    for (const [itemId, quantity] of wanted) {
      const item = getItem.get(itemId, orderId);
      if (!item) throw new HttpError(400, 'Có món không thuộc đơn này.', { items: 'Món không thuộc đơn.' });
      const left = item.quantity - returnedOf.get(orderId, itemId).q;
      if (quantity > left) throw new HttpError(400, `“${item.product_name}” chỉ còn ${left} ${item.unit} có thể trả / đổi.`, { items: 'Vượt số lượng đã mua.' });
      selected.push({ item, quantity });
      value += item.price * quantity;
    }

    const refunded = db.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS s FROM order_returns WHERE order_id = ? AND return_type = 'return'").get(orderId).s;
    const room = Math.max(0, order.total - refunded);
    let refundAmount = 0;
    if (returnType === 'return') {
      const raw = body?.refund_amount;
      refundAmount = raw === '' || raw == null ? Math.min(value, room) : toInteger(raw, { min: 0, max: order.total });
      if (refundAmount == null) throw new HttpError(400, 'Số tiền hoàn không hợp lệ.', { refund_amount: 'Số tiền hoàn không hợp lệ.' });
      if (refundAmount > room) {
        throw new HttpError(400, `Tổng tiền hoàn của đơn không được vượt ${order.total.toLocaleString('vi-VN')}đ (đã hoàn ${refunded.toLocaleString('vi-VN')}đ).`,
          { refund_amount: 'Vượt số tiền khách đã trả.' });
      }
    }

    // Trừ lại điểm đã cộng theo tỉ lệ tiền hoàn (cộng dồn qua các phiếu nên không trừ trùng). Khách đã tiêu
    // điểm thì chỉ trừ tới 0.
    let pointsRemoved = 0;
    const phone = order.wholesale_customer_id ? null : loyaltyPhoneForOrder(order);
    if (returnType === 'return' && refundAmount > 0 && phone && order.points_earned > 0 && order.total > 0) {
      const prior = db.prepare(`
        SELECT COALESCE(SUM(refund_amount), 0) AS refunded, COALESCE(SUM(points_removed), 0) AS removed
        FROM order_returns WHERE order_id = ? AND return_type = 'return'
      `).get(orderId);
      const total = prior.refunded + refundAmount;
      const should = total >= order.total ? order.points_earned : Math.round((order.points_earned * total) / order.total);
      const want = Math.max(0, Math.min(order.points_earned, should) - prior.removed);
      if (want > 0) {
        const have = db.prepare('SELECT points FROM retail_customers WHERE phone = ?').get(phone)?.points ?? 0;
        pointsRemoved = Math.min(want, Math.max(0, have));
        if (pointsRemoved > 0) {
          db.prepare("UPDATE retail_customers SET points = points - ?, updated_at = datetime('now') WHERE phone = ? AND points >= ?")
            .run(pointsRemoved, phone, pointsRemoved);
        }
      }
    }

    const returnId = db.prepare(`
      INSERT INTO order_returns (order_id, return_type, reason, refund_amount, refund_method, restock, warehouse, note,
                                 points_removed, created_by, actor_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, returnType, reason, refundAmount, refundMethod, restock ? 1 : 0, restock ? warehouse : null, note,
      pointsRemoved, actor?.id ?? null, actor?.full_name ?? null).lastInsertRowid;
    const code = orderReturnCode(returnId);
    db.prepare('UPDATE order_returns SET code = ? WHERE id = ?').run(code, returnId);
    const insItem = db.prepare(`
      INSERT INTO order_return_items (return_id, order_item_id, product_id, product_name, unit, price, quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const { item, quantity } of selected) {
      insItem.run(returnId, item.id, item.product_id, item.product_name, item.unit, item.price, quantity);
      if (restock && item.product_id) {
        moveStock({
          productId: item.product_id, warehouse, delta: quantity, kind: 'order_return',
          ref: { type: 'order_return', id: returnId, code }, note: `Khách trả từ đơn ${order.code}: ${reason}`, actor, strict: false,
        });
      }
    }
    return { id: returnId, code, order_code: order.code, return_type: returnType, refund_amount: refundAmount, refund_method: refundMethod,
      restock, warehouse: restock ? warehouse : null, points_removed: pointsRemoved, items: selected.map(({ item, quantity }) => ({
        order_item_id: item.id, product_name: item.product_name, unit: item.unit, price: item.price, quantity })) };
  })();
}
