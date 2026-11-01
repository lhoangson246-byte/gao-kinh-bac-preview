/**
 * Mã giảm giá khách tự nhập khi đặt hàng (01/11/2026), ví dụ GAOKINHBAC11 giảm 10.000đ trong tháng 11.
 *
 * Mỗi đơn chỉ hưởng MỘT khuyến mãi: ưu đãi đơn đầu tiên (20.000đ) hoặc mã giảm giá — máy chủ chọn
 * cái có lợi hơn cho khách (xem placeOrder). Voucher đổi điểm là quà khách đổi bằng điểm của mình,
 * không tính là khuyến mãi nên vẫn dùng kèm được.
 */
import db from './db.js';
import { HttpError } from './validate.js';
import { promoToday } from './promotions.js';

export const CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;
export const normalizeCode = (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
const formatDay = (day) => day.split('-').reverse().join('/');
const money = (n) => Number(n).toLocaleString('vi-VN');

/** Số đơn (chưa huỷ) đã dùng mã, toàn bộ hoặc của một số điện thoại. */
export function codeUses(code, phone = null) {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM orders WHERE discount_code = ? AND status <> 'cancelled' ${phone ? 'AND phone = ?' : ''}
  `).get(...(phone ? [code, phone] : [code])).c;
}

/**
 * Mã khách nhập còn dùng được không. Trả dòng mã, hoặc ném lỗi 400 với lời báo dễ hiểu (gắn vào
 * ô discount_code). `subtotal`/`phone` không truyền thì bỏ qua các điều kiện tương ứng (xem trước).
 */
export function findUsableCode(rawCode, { subtotal = null, phone = null } = {}) {
  const code = normalizeCode(rawCode);
  const fail = (message) => { throw new HttpError(400, message, { discount_code: message }); };
  const row = CODE_PATTERN.test(code) ? db.prepare('SELECT * FROM discount_codes WHERE code = ?').get(code) : null;
  if (!row || !row.is_active) fail('Mã giảm giá không đúng hoặc đã ngừng áp dụng.');
  const today = promoToday();
  if (row.starts_on && today < row.starts_on) fail(`Mã ${row.code} áp dụng từ ngày ${formatDay(row.starts_on)}.`);
  if (row.ends_on && today > row.ends_on) fail(`Mã ${row.code} đã hết hạn (đến hết ngày ${formatDay(row.ends_on)}).`);
  if (subtotal != null && row.min_subtotal > 0 && subtotal < row.min_subtotal) {
    fail(`Mã ${row.code} áp dụng cho đơn từ ${money(row.min_subtotal)}đ.`);
  }
  if (row.max_uses > 0 && codeUses(row.code) >= row.max_uses) fail(`Mã ${row.code} đã hết lượt dùng.`);
  if (phone && row.per_phone_limit > 0 && codeUses(row.code, phone) >= row.per_phone_limit) {
    fail(`Số điện thoại này đã dùng hết lượt của mã ${row.code}.`);
  }
  return row;
}

/** Thông tin mã cho khách xem trước (không lộ số lượt đã dùng). */
export const publicCode = (row) => ({
  code: row.code, amount: row.amount, min_subtotal: row.min_subtotal, ends_on: row.ends_on,
});
