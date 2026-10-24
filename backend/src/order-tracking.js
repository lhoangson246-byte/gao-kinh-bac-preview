/**
 * Khách tra cứu tiến độ đơn bằng số điện thoại + mã đơn (24/10/2026), không cần tài khoản.
 * Phải đúng CẢ HAI mới xem được, để người biết số điện thoại không dò được đơn của người khác.
 */
import db from './db.js';
import { normalizePhone } from './validate.js';

/** Cột ghi giờ của từng bước (tên cột cố định, dùng trong câu UPDATE). */
export const STATUS_STAMP = {
  confirmed: 'confirmed_at', shipping: 'shipping_at', completed: 'completed_at', cancelled: 'cancelled_at',
};

/** "dh 000236", "DH000236", "236" → "DH000236"; không hợp lệ → ''. */
export function normalizeOrderCode(value) {
  const raw = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  const match = /^(?:DH)?0*(\d{1,9})$/.exec(raw);
  return match ? `DH${match[1].padStart(6, '0')}` : '';
}

export function trackOrder(phone, code) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedCode = normalizeOrderCode(code);
  if (!normalizedPhone || !normalizedCode) return null;
  const order = db.prepare(`
    SELECT id, code, status, receiver_name, phone, delivery_slot, payment_method, total, created_at,
           confirmed_at, shipping_at, completed_at, cancelled_at
    FROM orders WHERE code = ?
  `).get(normalizedCode);
  if (!order || normalizePhone(order.phone) !== normalizedPhone) return null;
  const items = db.prepare(`
    SELECT product_name, quantity, unit, is_reward, promo FROM order_items WHERE order_id = ? ORDER BY id
  `).all(order.id);
  // Không trả địa chỉ, số điện thoại hay mã nội bộ: khách chỉ cần biết đơn đang ở bước nào.
  const { id, phone: _phone, ...publicOrder } = order;
  return { ...publicOrder, items };
}
