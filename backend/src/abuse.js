import bcrypt from 'bcryptjs';
import db from './db.js';
import { HttpError } from './validate.js';

/**
 * Chống flood / bot (21/11/2026): các ngưỡng chặn, cầu dao toàn hệ thống (đọc thẳng từ cơ sở dữ liệu nên
 * đúng cả khi Vercel chạy nhiều bản máy chủ song song), hàng đợi giới hạn bcrypt, và bẫy bot (honeypot).
 *
 * Mặc định trên trang thật (NODE_ENV=production) là ngưỡng chặt. Máy dev (development) dùng ngưỡng rộng để
 * bấm thử thoải mái. Bộ kiểm thử (backend/test/fixture.mjs) đặt ngưỡng rộng qua biến môi trường; bài kiểm thử
 * chống flood trong security.mjs đặt lại ngưỡng chặt để chứng minh bị chặn.
 */
const production = process.env.NODE_ENV === 'production';

/** Số nguyên dương từ biến môi trường `name`, không có thì theo môi trường chạy. */
export function limitSetting(name, prodDefault, devDefault = prodDefault) {
  const raw = process.env[name];
  const value = Number(raw);
  if (raw !== undefined && raw !== '' && Number.isInteger(value) && value > 0) return value;
  return production ? prodDefault : devDefault;
}

export const ABUSE = {
  registerPerHour: limitSetting('REGISTER_LIMIT_PER_HOUR', 5, 200),          // đăng ký / giờ / IP
  trackPer15m: limitSetting('TRACK_LIMIT_PER_15M', 15, 300),                // tra cứu đơn / 15 phút / IP
  transferProofPer15m: limitSetting('TRANSFER_PROOF_LIMIT_PER_15M', 6, 200), // gửi ảnh chuyển khoản / 15 phút / IP
  registrationBreaker: limitSetting('REGISTRATION_BREAKER_PER_5M', 15, 1000), // tài khoản khách mới / 5 phút (toàn hệ thống)
  guestPendingBreaker: limitSetting('GUEST_PENDING_BREAKER_PER_10M', 15, 1000), // đơn mua nhanh chờ xác nhận / 10 phút (toàn hệ thống)
  guestSameContact: limitSetting('GUEST_SAME_CONTACT_PENDING', 3, 100),     // đơn chờ xác nhận cùng SĐT hoặc cùng địa chỉ (24 giờ)
  bcryptConcurrency: limitSetting('BCRYPT_CONCURRENCY', 3),                // phép tính bcrypt chạy cùng lúc / tiến trình
  bcryptQueue: limitSetting('BCRYPT_QUEUE', 8),                            // hàng đợi bcrypt tối đa
};

const BUSY = 'Hệ thống đang bận, vui lòng thử lại sau ít phút.';

/* ---------------------------------- Cầu dao toàn hệ thống ---------------------------------- */

/** Quá nhiều tài khoản khách mới trong 5 phút (bot xoay IP) thì tạm dừng đăng ký. */
export function assertRegistrationCapacity() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND created_at > datetime('now', '-5 minutes')").get().n;
  if (n >= ABUSE.registrationBreaker) {
    console.warn({ event: 'registration_breaker', recent: n });
    throw new HttpError(429, BUSY);
  }
}

/**
 * Bảo vệ tồn kho Kho Bồ Sơn và thông báo của cửa hàng khỏi đơn mua nhanh ảo:
 *  - toàn hệ thống quá nhiều đơn mua nhanh CHỜ XÁC NHẬN trong 10 phút → tạm dừng đặt nhanh;
 *  - cùng số điện thoại hoặc cùng địa chỉ đã có từ 3 đơn chờ xác nhận (24 giờ) → không cho đặt thêm.
 */
export function assertGuestOrderCapacity({ phone, address }) {
  const recent = db.prepare(`
    SELECT COUNT(*) AS n FROM orders
    WHERE status = 'pending' AND is_guest = 1 AND created_at > datetime('now', '-10 minutes')
  `).get().n;
  if (recent >= ABUSE.guestPendingBreaker) {
    console.warn({ event: 'guest_order_breaker', recent });
    throw new HttpError(429, BUSY);
  }
  const same = db.prepare(`
    SELECT COUNT(*) AS n FROM orders
    WHERE status = 'pending' AND created_at > datetime('now', '-1 day') AND (phone = ? OR address = ?)
  `).get(phone || '', address || '').n;
  if (same >= ABUSE.guestSameContact) {
    throw new HttpError(429, 'Số điện thoại / địa chỉ này đang có nhiều đơn chờ cửa hàng xác nhận. Cửa hàng sẽ gọi lại sớm; cần gấp vui lòng gọi trực tiếp cho cửa hàng.');
  }
}

/* ---------------------------------- Hàng đợi bcrypt ---------------------------------- */

/**
 * bcryptjs cost 12 tốn khoảng 300 ms CPU mỗi lần và chạy trên luồng chính. Giới hạn số phép tính chạy cùng
 * lúc và độ dài hàng đợi; hàng đợi đầy (đang bị bắn dồn dập) thì trả 429 ngay, không tính bcrypt.
 */
let running = 0;
const waiting = [];
function release() {
  running -= 1;
  const next = waiting.shift();
  if (next) { running += 1; next(); }
}
async function withBcryptSlot(task) {
  if (running >= ABUSE.bcryptConcurrency) {
    if (waiting.length >= ABUSE.bcryptQueue) {
      throw new HttpError(429, 'Máy chủ đang xử lý nhiều yêu cầu, vui lòng thử lại sau giây lát.');
    }
    await new Promise((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try { return await task(); } finally { release(); }
}
export const bcryptHash = (password, cost = 12) => withBcryptSlot(() => bcrypt.hash(password, cost));
export const bcryptCompare = (password, hash) => withBcryptSlot(() => bcrypt.compare(password, hash));
export const bcryptLoad = () => ({ running, waiting: waiting.length });

/* ---------------------------------- Bẫy bot (honeypot) ---------------------------------- */

/**
 * Ô "website" ẩn trên form đăng ký / đặt hàng: người thật không thấy nên luôn để trống, bot điền mọi ô thì
 * có giá trị → chặn. Ô này bị bỏ khỏi dữ liệu trước khi tới phần kiểm tra dữ liệu của từng API.
 */
export function honeypot(req, res, next) {
  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body) && 'website' in body) {
    const value = body.website;
    delete body.website;
    if (typeof value !== 'string' || value.trim()) {
      return res.status(400).json({ message: 'Không gửi được biểu mẫu. Vui lòng tải lại trang rồi thử lại.' });
    }
  }
  return next();
}
