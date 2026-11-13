/**
 * Khách tra cứu tiến độ đơn không cần tài khoản (24/10/2026).
 *  - Số điện thoại + mã đơn: đúng cả hai thì xem đơn đó.
 *  - Chỉ số điện thoại (13/11/2026, cửa hàng yêu cầu cho khách dễ tra): các đơn 60 ngày gần đây, tối đa 5
 *    đơn. Không bao giờ trả địa chỉ, số điện thoại hay mã nội bộ; tên người nhận bị che bớt, vì ai biết số
 *    điện thoại cũng tra được. Giới hạn số lần tra theo IP ở server.js.
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

const TRACK_COLUMNS = `id, code, status, receiver_name, phone, delivery_slot, payment_method, shipping_fee, total, transfer_reported_at,
  transfer_confirmed_at, created_at, confirmed_at, shipping_at, completed_at, cancelled_at`;
export const TRACK_DAYS = 60;
export const TRACK_LIMIT = 5;

const HONORIFICS = new Set(['anh', 'chị', 'chi', 'cô', 'co', 'chú', 'chu', 'bác', 'bac', 'em', 'ông', 'ong', 'bà', 'ba', 'cậu', 'dì', 'mợ', 'thím']);
/** "Chị Nguyễn Thị Hoa" → "Chị H***", "Nguyễn Văn An" → "A***": đủ để khách nhận ra đơn của mình. */
export function maskName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const last = words[words.length - 1];
  const prefix = words.length > 1 && HONORIFICS.has(words[0].toLowerCase()) ? `${words[0]} ` : '';
  return `${prefix}${[...last][0].toUpperCase()}***`;
}

function withItems(order) {
  const items = db.prepare(`
    SELECT product_name, quantity, unit, is_reward, promo FROM order_items WHERE order_id = ? ORDER BY id
  `).all(order.id);
  const { id, phone: _phone, ...publicOrder } = order;
  return { ...publicOrder, items };
}

/** Các đơn gần đây của một số điện thoại, mới nhất trước. Tên người nhận đã che bớt. */
export function trackOrdersByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return [];
  return db.prepare(`
    SELECT ${TRACK_COLUMNS} FROM orders
    WHERE phone = ? AND created_at >= datetime('now', ?)
    ORDER BY id DESC LIMIT ?
  `).all(normalizedPhone, `-${TRACK_DAYS} days`, TRACK_LIMIT)
    .map((order) => ({ ...withItems(order), receiver_name: maskName(order.receiver_name) }));
}

export function trackOrder(phone, code) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedCode = normalizeOrderCode(code);
  if (!normalizedPhone || !normalizedCode) return null;
  const order = db.prepare(`SELECT ${TRACK_COLUMNS} FROM orders WHERE code = ?`).get(normalizedCode);
  if (!order || normalizePhone(order.phone) !== normalizedPhone) return null;
  // Không trả địa chỉ, số điện thoại hay mã nội bộ: khách chỉ cần biết đơn đang ở bước nào.
  return withItems(order);
}
