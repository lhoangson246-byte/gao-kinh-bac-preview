import db from './db.js';
import { retailPointsFor } from './constants.js';
import { HttpError, normalizePhone } from './validate.js';

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
  // Đơn mua nhanh không có tài khoản: tích vào số điện thoại khách ghi trên đơn.
  if (order.is_guest) return normalizePhone(order.phone) || null;
  const account = db.prepare('SELECT phone FROM users WHERE id = ?').get(order.user_id);
  return normalizePhone(account?.phone) || null;
}

/**
 * Cộng điểm cho một số điện thoại. Tạo hồ sơ nếu chưa có.
 * Luôn gọi bên trong transaction của phía gọi.
 * `points` là số điểm đã tính sẵn theo từng loại gạo (pointsForSale); bỏ trống
 * thì tính theo tiền như cũ. Trả về số điểm đã cộng.
 */
export function creditPoints(phone, { amountPaid, points: preset = null, fullName = null }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return 0;

  const points = preset ?? retailPointsFor(amountPaid);
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
    `SELECT u.id, u.full_name, u.email, u.phone, u.is_locked, u.created_at,
      COALESCE((
        SELECT a.address FROM delivery_addresses a
        WHERE a.user_id = u.id
        ORDER BY a.is_default DESC, a.id DESC LIMIT 1
      ), u.address) AS address
     FROM users u WHERE u.phone = ?`
  ).get(normalized) || null;
}

/**
 * Trừ điểm đổi quà / voucher. Luôn gọi bên trong transaction của phía gọi.
 * Câu UPDATE có điều kiện "points >= ?" nên hai lần đổi cùng lúc không thể trừ
 * quá số điểm đang có; thiếu điểm thì ném lỗi để cả transaction bị huỷ.
 */
export function spendPoints(phone, points) {
  const normalized = normalizePhone(phone);
  if (!normalized || points <= 0) return;
  const changed = db.prepare(`
    UPDATE retail_customers SET points = points - ?, updated_at = datetime('now')
    WHERE phone = ? AND points >= ?
  `).run(points, normalized, points).changes;
  if (!changed) {
    const have = db.prepare('SELECT points FROM retail_customers WHERE phone = ?').get(normalized)?.points ?? 0;
    throw new HttpError(400, `Bạn chỉ có ${have} điểm, cần ${points} điểm để đổi.`, { rewards: 'Không đủ điểm.' });
  }
}

/** Hoàn lại điểm đã trừ (ví dụ đơn đổi điểm bị huỷ). Gọi trong transaction đã khoá trạng thái đơn. */
export function refundPoints(phone, points) {
  const normalized = normalizePhone(phone);
  if (!normalized || points <= 0) return;
  db.prepare(`
    UPDATE retail_customers SET points = points + ?, updated_at = datetime('now') WHERE phone = ?
  `).run(points, normalized);
}
