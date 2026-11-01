/**
 * Đổi trạng thái đơn online — dùng chung cho trang quản trị và nhân viên giao hàng.
 * Một transaction: đổi trạng thái có điều kiện, ghi giờ từng bước, hoàn kho khi huỷ, cộng điểm khi
 * giao xong (mỗi đơn đúng một lần nhờ câu UPDATE "WHERE status = ?").
 */
import db from './db.js';
import { ALLOWED_TRANSITIONS, ORDER_STATUSES, pointsForSale } from './constants.js';
import { HttpError } from './validate.js';
import { STATUS_STAMP } from './order-tracking.js';
import { restoreStockForOrder } from './routes/orders.js';
import { creditPoints, loyaltyPhoneForOrder } from './loyalty.js';

/**
 * `guard(current)` (tuỳ chọn) chạy trong transaction trước khi đổi, để kiểm tra thêm điều kiện, ví
 * dụ nhân viên giao hàng chỉ được đổi đơn của chính mình. Trả { before, order }.
 */
export function changeOrderStatus(orderId, status, { guard, within } = {}) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new HttpError(400, `Trạng thái phải thuộc: ${ORDER_STATUSES.join(', ')}.`);
  }
  const before = db.transaction(() => {
    const current = db.prepare('SELECT id, status, shipper_id FROM orders WHERE id = ?').get(orderId);
    if (!current) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    guard?.(current);
    if (!ALLOWED_TRANSITIONS[current.status]?.includes(status)) {
      throw new HttpError(400, `Không thể chuyển đơn từ “${current.status}” sang “${status}”.`);
    }

    // Chỉ đổi khi trạng thái vẫn đúng như lúc đọc — hai request cùng huỷ
    // một đơn thì chỉ một request hoàn kho.
    // Ghi lại giờ của từng bước để khách tra cứu tiến độ giao (tên cột lấy từ danh sách cố định).
    const stampColumn = STATUS_STAMP[status];
    const changed = db
      .prepare(`UPDATE orders SET status = ?${stampColumn ? `, ${stampColumn} = datetime('now')` : ''} WHERE id = ? AND status = ?`)
      .run(status, current.id, current.status).changes;
    if (!changed) {
      throw new HttpError(409, 'Đơn hàng vừa được cập nhật ở nơi khác. Vui lòng tải lại trang.');
    }
    if (status === 'cancelled') restoreStockForOrder(current.id);

    // CHỈ đơn giao xong mới được cộng điểm. Đơn huỷ (ở bất kỳ bước nào trước đó)
    // không bao giờ tới nhánh này, và ALLOWED_TRANSITIONS không cho huỷ đơn đã hoàn thành.
    // Đơn giao xong thì cộng điểm vào hồ sơ theo SỐ ĐIỆN THOẠI CỦA TÀI KHOẢN
    // đặt hàng — cùng hồ sơ với mua tại quầy.
    if (status === 'completed') {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(current.id);
      const phone = loyaltyPhoneForOrder(order);
      if (phone) {
        // Điểm tính theo từng loại gạo, dùng quy tắc điểm đã lưu vào dòng hàng lúc đặt.
        const items = db.prepare(
          'SELECT price, quantity, points_per_unit, is_reward FROM order_items WHERE order_id = ?'
        ).all(order.id);
        const earned = creditPoints(phone, {
          amountPaid: order.total,
          points: pointsForSale(items, order.total),
          fullName: order.receiver_name,
        });
        db.prepare('UPDATE orders SET points_earned = ? WHERE id = ?').run(earned, order.id);
      }
    }
    // Việc kèm theo phải thành công cùng lần đổi trạng thái (ví dụ ảnh giao hàng, đơn công nợ).
    within?.(current);
    return current;
  })();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  delete order.guest_token_hash;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
  return { before, order };
}
