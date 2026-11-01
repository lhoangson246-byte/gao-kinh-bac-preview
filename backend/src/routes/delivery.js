import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import { localDate } from '../constants.js';
import { changeOrderStatus } from '../order-status.js';

/**
 * /api/delivery — nhân viên giao hàng (quyền "delivery"). Chỉ thấy và chỉ cập nhật đơn được phân
 * công cho chính mình: Bắt đầu giao → Đã giao xong (cộng điểm cho khách như khi cửa hàng bấm).
 */
const router = Router();
router.use(requireAuth, requirePermission('delivery'));
router.use(validateRoutes('delivery'));

const ORDER_COLUMNS = `id, code, status, receiver_name, phone, address, note, delivery_slot, delivery_lat, delivery_lng,
  payment_method, total, fulfillment, created_at, confirmed_at, shipping_at, completed_at, cancelled_at`;

/** GET /orders — đơn cần giao của tôi + đơn đã xong / bị huỷ hôm nay. */
router.get('/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT ${ORDER_COLUMNS} FROM orders
    WHERE shipper_id = ? AND (
      status IN ('confirmed', 'shipping')
      OR (status = 'completed' AND ${localDate('completed_at')} = ${localDate("'now'")})
      OR (status = 'cancelled' AND ${localDate('cancelled_at')} = ${localDate("'now'")})
    )
    ORDER BY CASE status WHEN 'shipping' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, id
  `).all(req.user.id);
  const items = orders.length ? db.prepare(`
    SELECT order_id, product_name, quantity, unit, is_reward, promo FROM order_items
    WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY order_id, id
  `).all(...orders.map((o) => o.id)) : [];
  for (const order of orders) order.items = items.filter((i) => i.order_id === order.id);
  res.json({ orders });
});

/** PATCH /orders/:id/status — body: { status: 'shipping' | 'completed' } */
router.patch('/orders/:id/status', (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    if (!orderId) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    const { status } = req.body;
    const { before, order } = changeOrderStatus(orderId, status, {
      guard: (current) => {
        // Đơn của người khác: báo như không có, để không dò được đơn ngoài phần mình.
        if (current.shipper_id !== req.user.id) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
      },
    });
    writeAdminAudit(req, {
      action: 'delivery_status', entityType: 'order', entityId: orderId,
      before: { status: before.status }, after: { status: order.status },
    });
    res.json({ order: { id: order.id, status: order.status, shipping_at: order.shipping_at, completed_at: order.completed_at } });
  } catch (err) {
    next(err);
  }
});

export default router;
