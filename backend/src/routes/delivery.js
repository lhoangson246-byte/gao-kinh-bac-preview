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
import { searchCustomers } from '../customer-search.js';
import { WAREHOUSE, distanceFromWarehouse, ensureOrderPoints, orderPoint, planRoute } from '../route-plan.js';

/**
 * /api/delivery — nhân viên giao hàng (quyền "delivery"). Chỉ thấy và chỉ cập nhật đơn được phân
 * công cho chính mình: Bắt đầu giao → Đã giao xong (cộng điểm cho khách như khi cửa hàng bấm).
 */
const router = Router();
router.use(requireAuth, requirePermission('delivery'));
router.use(validateRoutes('delivery'));

const ORDER_COLUMNS = `id, code, status, receiver_name, phone, address, note, delivery_slot, delivery_lat, delivery_lng, map_url, warehouse,
  payment_method, payment_status, total, fulfillment, created_at, confirmed_at, shipping_at, completed_at, cancelled_at, delivery_photo,
  transfer_confirmed_at, geo_lat, geo_lng, geo_source, geo_checked_at`;
// Đơn vừa giao xong trong khoảng này thì lộ trình còn lại tính từ chỗ đơn đó (nhân viên đang ở ngoài đường).
const LAST_STOP_MINUTES = 120;

/** Ảnh chứng từ phải do chính nhân viên này vừa chụp và tải lên. */
function ownPhoto(id, user, field) {
  const ok = typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)
    && db.prepare('SELECT 1 FROM proof_photos WHERE id = ? AND uploaded_by = ?').get(id, user.id);
  if (!ok) throw new HttpError(400, 'Chưa có ảnh. Vui lòng chụp ảnh rồi thử lại.', { [field]: 'Chụp ảnh trước.' });
  return id;
}

/**
 * GET /search?q= — tìm khách theo tên, số điện thoại, địa chỉ hoặc mã khách buôn để gọi và chỉ đường,
 * kể cả khách không có đơn đang giao cho mình (13/11/2026). Tối đa 12 kết quả, gõ ít nhất 2 ký tự.
 */
router.get('/search', (req, res) => {
  res.json({ results: searchCustomers(String(req.query.q || '')) });
});

/**
 * GET /orders — đơn cần giao của tôi + đơn đã xong / bị huỷ hôm nay, kèm lộ trình (20/11/2026): thứ tự đi
 * qua các đơn còn lại rồi quay về Kho Bồ Sơn cho quãng đường ngắn nhất.
 */
router.get('/orders', async (req, res, next) => {
  try {
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
  const active = orders.filter((o) => ['confirmed', 'shipping'].includes(o.status) && o.fulfillment !== 'pickup');
  await ensureOrderPoints(active, { max: 6, budgetMs: 4000 });
  // Vừa giao xong một đơn (trong 2 tiếng) thì tính tiếp từ chỗ đó; không thì từ kho.
  const lastDone = orders.filter((o) => o.status === 'completed' && o.completed_at && orderPoint(o)
    && Date.parse(`${String(o.completed_at).replace(' ', 'T')}Z`) > Date.now() - LAST_STOP_MINUTES * 60_000)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0];
  const plan = planRoute(active, lastDone ? { start: orderPoint(lastDone) } : {});
  for (const order of orders) {
    order.distance_km = order.fulfillment === 'pickup' ? null : distanceFromWarehouse(order);
    delete order.geo_checked_at;
  }
  res.json({
    orders,
    route: {
      warehouse: { name: WAREHOUSE.name, address: WAREHOUSE.address, lat: WAREHOUSE.lat, lng: WAREHOUSE.lng, map_url: WAREHOUSE.map_url },
      ...plan,
      from_code: lastDone?.code || null,
      missing: active.filter((o) => !orderPoint(o)).map((o) => o.id),
    },
  });
  } catch (err) {
    next(err);
  }
});

/**
 * Vị trí thật từ điện thoại (21/11/2026). Trang Giao hàng gửi vị trí GPS (navigator.geolocation.watchPosition)
 * khi nhân viên BẬT "Chia sẻ vị trí" và đang có đơn giao; bản đồ điều phối của kế toán / quản lý hiện đúng chỗ
 * nhân viên đang đứng. Chỉ lưu vị trí mới nhất (ghi đè), không lưu lịch sử đường đi.
 *  POST   /location { latitude, longitude, accuracy? } — cập nhật vị trí;
 *  DELETE /location — nhân viên tắt chia sẻ: xoá vị trí, bản đồ quay về mô phỏng.
 */
router.post('/location', (req, res) => {
  const { latitude, longitude } = req.body;
  const accuracy = Number.isFinite(req.body.accuracy) ? Math.round(req.body.accuracy) : null;
  // Toạ độ lấy 6 chữ số thập phân (≈ 10 cm) là đủ.
  const lat = Math.round(latitude * 1e6) / 1e6;
  const lng = Math.round(longitude * 1e6) / 1e6;
  db.prepare(`
    INSERT INTO shipper_locations (user_id, lat, lng, accuracy, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, updated_at = excluded.updated_at
  `).run(req.user.id, lat, lng, accuracy);
  res.json({ ok: true, lat, lng });
});
router.delete('/location', (req, res) => {
  db.prepare('DELETE FROM shipper_locations WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

/**
 * PATCH /orders/:id/status — body: { status: 'shipping' | 'completed', photo?, paid_by?: 'cash' | 'transfer' }
 *
 * Giao xong (19/11/2026): nhân viên chọn khách trả bằng gì.
 *  - Tiền mặt   → chụp ảnh gạo đã giao (ảnh giao hàng); đơn tính là tiền mặt.
 *  - Chuyển khoản → chụp ảnh màn hình chuyển khoản của khách (ảnh chuyển khoản, chờ cửa hàng xác nhận
 *    tiền về); đơn tính là chuyển khoản.
 * Đơn mà cửa hàng đã xác nhận nhận tiền chuyển khoản thì luôn là chuyển khoản, ảnh chụp là ảnh giao hàng.
 * Không gửi paid_by (ứng dụng cũ) thì theo cách khách chọn lúc đặt.
 */
router.patch('/orders/:id/status', (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    if (!orderId) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    const { status } = req.body;
    // Giao xong phải có ảnh (12/11/2026).
    const photo = status === 'completed' ? ownPhoto(req.body.photo, req.user, 'photo') : null;
    let paidBy = null;
    let chosenAtOrder = null;
    const { before, order } = changeOrderStatus(orderId, status, {
      guard: (current) => {
        // Đơn của người khác: báo như không có, để không dò được đơn ngoài phần mình.
        if (current.shipper_id !== req.user.id) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
      },
      within: () => {
        if (!photo) return;
        const o = db.prepare('SELECT payment_method, transfer_proof, transfer_confirmed_at FROM orders WHERE id = ?').get(orderId);
        chosenAtOrder = o.payment_method;
        paidBy = o.transfer_confirmed_at ? 'transfer' : req.body.paid_by || (o.payment_method === 'bank' ? 'transfer' : 'cash');
        if (paidBy === 'cash') {
          db.prepare("UPDATE orders SET delivery_photo = ?, payment_method = 'cod' WHERE id = ?").run(photo, orderId);
        } else if (o.transfer_confirmed_at || o.transfer_proof) {
          // Đã có ảnh chuyển khoản của khách (hoặc cửa hàng đã nhận tiền): giữ ảnh đó, ảnh mới là ảnh giao hàng.
          db.prepare("UPDATE orders SET delivery_photo = ?, payment_method = 'bank' WHERE id = ?").run(photo, orderId);
        } else {
          db.prepare(`UPDATE orders SET transfer_proof = ?, transfer_reported_at = datetime('now'), payment_method = 'bank'
                      WHERE id = ?`).run(photo, orderId);
        }
      },
    });
    writeAdminAudit(req, {
      action: 'delivery_status', entityType: 'order', entityId: orderId,
      before: { status: before.status, ...(chosenAtOrder ? { payment_method: chosenAtOrder } : {}) },
      after: { status: order.status, ...(paidBy ? { paid_by: paidBy, payment_method: order.payment_method } : {}) },
    });
    res.json({ order: { id: order.id, status: order.status, shipping_at: order.shipping_at, completed_at: order.completed_at, payment_method: order.payment_method } });
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
