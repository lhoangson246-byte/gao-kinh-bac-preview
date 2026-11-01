import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import { localDate } from '../constants.js';
import { changeOrderStatus } from '../order-status.js';
import { debtAccountFor, logDebtEvent, todayVN } from '../debts.js';
import { notifyDebtStage } from '../push.js';

/**
 * /api/delivery — nhân viên giao hàng (quyền "delivery"). Chỉ thấy và chỉ cập nhật đơn được phân
 * công cho chính mình: Bắt đầu giao → Đã giao xong (cộng điểm cho khách như khi cửa hàng bấm).
 */
const router = Router();
router.use(requireAuth, requirePermission('delivery'));
router.use(validateRoutes('delivery'));

const ORDER_COLUMNS = `id, code, status, receiver_name, phone, address, note, delivery_slot, delivery_lat, delivery_lng,
  payment_method, payment_status, total, fulfillment, created_at, confirmed_at, shipping_at, completed_at, cancelled_at, delivery_photo`;

/** Ảnh chứng từ phải do chính nhân viên này vừa chụp và tải lên. */
function ownPhoto(id, user, field) {
  const ok = typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)
    && db.prepare('SELECT 1 FROM proof_photos WHERE id = ? AND uploaded_by = ?').get(id, user.id);
  if (!ok) throw new HttpError(400, 'Chưa có ảnh. Vui lòng chụp ảnh rồi thử lại.', { [field]: 'Chụp ảnh trước.' });
  return id;
}

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
    // Giao xong phải có ảnh gạo đã tới nơi (12/11/2026).
    const photo = status === 'completed' ? ownPhoto(req.body.photo, req.user, 'photo') : null;
    const { before, order } = changeOrderStatus(orderId, status, {
      guard: (current) => {
        // Đơn của người khác: báo như không có, để không dò được đơn ngoài phần mình.
        if (current.shipper_id !== req.user.id) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
      },
      within: () => {
        if (photo) db.prepare('UPDATE orders SET delivery_photo = ? WHERE id = ?').run(photo, orderId);
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

/**
 * POST /orders/:id/debt — khách lấy hàng nhưng NỢ (công ty, công nợ 14 – 30 ngày). Bắt buộc ảnh gạo
 * đã giao tới nơi và ảnh hoá đơn nợ. Đơn chuyển "Đã giao xong" (đánh dấu công nợ, không tính tiền mặt)
 * và tạo đơn nợ chờ kế toán duyệt — cùng một transaction.
 *  body: { delivered_photo, invoice_photo, company?, comment? }
 */
router.post('/orders/:id/debt', async (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    if (!orderId) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    const deliveredPhoto = ownPhoto(req.body.delivered_photo, req.user, 'delivered_photo');
    const invoicePhoto = ownPhoto(req.body.invoice_photo, req.user, 'invoice_photo');
    if (deliveredPhoto === invoicePhoto) {
      throw new HttpError(400, 'Cần hai ảnh khác nhau: gạo đã giao và hoá đơn nợ.', { invoice_photo: 'Chụp ảnh hoá đơn nợ.' });
    }
    const company = cleanText(req.body.company, 160);
    const note = cleanText(req.body.comment, 1000);
    let debtId = null;
    const { before, order } = changeOrderStatus(orderId, 'completed', {
      guard: (current) => {
        if (current.shipper_id !== req.user.id) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
        if (current.status !== 'shipping') throw new HttpError(400, 'Bấm "Bắt đầu giao" trước khi ghi nợ.');
      },
      within: () => {
        const o = db.prepare('SELECT id, phone, receiver_name, total FROM orders WHERE id = ?').get(orderId);
        db.prepare("UPDATE orders SET payment_status = 'debt', delivery_photo = ? WHERE id = ?").run(deliveredPhoto, orderId);
        const accountId = debtAccountFor({ phone: o.phone, contactName: o.receiver_name, company });
        debtId = db.prepare(`
          INSERT INTO debt_records (order_id, account_id, amount, delivered_photo, invoice_photo, delivered_on, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(orderId, accountId, o.total, deliveredPhoto, invoicePhoto, todayVN(), req.user.id).lastInsertRowid;
        logDebtEvent(debtId, req.user, 'Nhân viên giao gửi đơn nợ', note);
      },
    });
    writeAdminAudit(req, {
      action: 'delivery_debt', entityType: 'order', entityId: orderId,
      before: { status: before.status }, after: { status: order.status, debt_id: debtId },
    });
    await notifyDebtStage(debtId, 'pending_accounting');
    res.status(201).json({ order: { id: order.id, status: order.status, payment_status: 'debt' }, debt_id: debtId });
  } catch (err) {
    next(err);
  }
});

export default router;
