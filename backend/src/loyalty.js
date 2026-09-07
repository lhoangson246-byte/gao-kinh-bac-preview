import db from './db.js';
import { retailPointsFor } from './constants.js';
import { normalizePhone } from './validate.js';

/**
 * Hồ sơ tích điểm dùng chung cho cả hai kênh bán:
 * mua tại quầy và đặt hàng online đều cộng vào cùng một hồ sơ,
 * nhận diện bằng SỐ ĐIỆN THOẠI đã chuẩn hoá (0xxxxxxxxx).
 *
 * Với đơn online, số điện thoại lấy từ TÀI KHOẢN ĐĂNG NHẬP chứ không phải
 * số người nhận — khách đặt hộ người khác thì điểm vẫn về đúng chủ tài khoản.
 */

/** Số điện thoại dùng để tích điểm cho một đơn online. */
export function loyaltyPhoneForOrder(order) {
  const account = db.prepare('SELECT phone FROM users WHERE id = ?').get(order.user_id);
  return normalizePhone(account?.phone) || null;
}

/**
 * Cộng điểm cho một số điện thoại. Tạo hồ sơ nếu chưa có.
 * Luôn gọi bên trong transaction của phía gọi.
 * Trả về số điểm đã cộng.
 */
export function creditPoints(phone, { amountPaid, fullName = null }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return 0;

  const points = retailPointsFor(amountPaid);
  if (points <= 0) return 0;

  const existing = db.prepare('SELECT id FROM retail_customers WHERE phone = ?').get(normalized);
  if (existing) {
    db.prepare(`
      UPDATE retail_customers
      SET points = points + ?, total_spent = total_spent + ?, visit_count = visit_count + 1,
          full_name = COALESCE(full_name, ?), updated_at = datetime('now')
      WHERE id = ?
    `).run(points, amountPaid, fullName, existing.id);
  } else {
    db.prepare(`
      INSERT INTO retail_customers (phone, full_name, points, total_spent, visit_count)
      VALUES (?, ?, ?, ?, 1)
    `).run(normalized, fullName, points, amountPaid);
  }
  return points;
}

/** Hồ sơ tích điểm của một số điện thoại, hoặc null. */
export function loyaltyProfile(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return db.prepare('SELECT * FROM retail_customers WHERE phone = ?').get(normalized) || null;
}

/** Tài khoản đăng nhập online gắn với số điện thoại, hoặc null. */
export function onlineAccount(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return db.prepare(
    'SELECT id, full_name, email, phone, is_locked, created_at FROM users WHERE phone = ?'
  ).get(normalized) || null;
}
