import { LIMITS } from './constants.js';

/** Lỗi có mã HTTP kèm theo, dùng để dừng transaction và trả về đúng thông báo. */
export class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Đưa số điện thoại về một dạng duy nhất "0xxxxxxxxx".
 * Nhờ vậy "0912 345 678", "+84912345678" và "0912345678" đều lưu và tra cứu như nhau.
 * Trả về chuỗi rỗng nếu không phải số điện thoại Việt Nam hợp lệ.
 */
export const phoneKey = (v) => {
  if (typeof v !== 'string') return '';
  const raw = String(v ?? '').replace(/[\s.\-()]/g, '');
  if (!raw) return '';
  const normalized = raw.startsWith('+84') ? `0${raw.slice(3)}`
    : raw.startsWith('84') && raw.length >= 11 ? `0${raw.slice(2)}`
    : raw;
  return /^0\d{9}$/.test(normalized) ? normalized : '';
};

/**
 * Đầu số di động Việt Nam đang dùng (10 số): Viettel 032–039, 086, 096–098; Vinaphone 081–085, 088, 091, 094;
 * MobiFone 070, 076–079, 089, 090, 093; Vietnamobile 052, 056, 058, 092; Gmobile 059, 099; Reddi 055;
 * iTel 087. Chặn thêm số lặp vô nghĩa (8 chữ số cuối giống hệt nhau, ví dụ 0999999999) (21/11/2026).
 */
export const VN_MOBILE_RE = /^0(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-46-9])\d{7}$/;
const REPEATED_TAIL_RE = /^0\d(\d)\1{7}$/;

/**
 * Số điện thoại NHẬP MỚI (đăng ký, đặt hàng, sổ địa chỉ, nhân viên, khách buôn…): đưa về dạng "0xxxxxxxxx"
 * và chỉ nhận đầu số di động Việt Nam hợp lệ. Tra cứu dữ liệu đã lưu (đăng nhập, tra đơn, tích điểm) dùng
 * phoneKey để số cũ vẫn tìm được. Trả về chuỗi rỗng nếu không hợp lệ.
 */
export const normalizePhone = (v) => {
  const key = phoneKey(v);
  return key && VN_MOBILE_RE.test(key) && !REPEATED_TAIL_RE.test(key) ? key : '';
};

export const isEmail = (v) =>
  typeof v === 'string' && v.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const isPhone = (v) => normalizePhone(v) !== '';

/** Bỏ khoảng trắng thừa; trả về null nếu rỗng. */
export function cleanText(value, maxLength) {
  if (value == null) return null;
  if (typeof value !== 'string' || (maxLength && value.length > maxLength)) {
    throw new HttpError(400, 'Trường văn bản sai kiểu hoặc quá dài.');
  }
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text;
}

/** Số nguyên không âm trong khoảng cho phép, hoặc null nếu không hợp lệ. */
export function toInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) return null;
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) return null;
  return num;
}

/**
 * Chấp nhận URL ảnh http/https, hoặc đường dẫn nội bộ của ứng dụng ("/products/....jpg").
 * Chặn các dạng nguy hiểm như "javascript:" hay "//tên-miền-khác".
 */
export function cleanImageUrl(value) {
  const text = cleanText(value, LIMITS.imageUrl);
  if (!text) return null;
  if (/[\\\u0000-\u0020\u007f]/.test(text)) return null;
  if (text.startsWith('/')) return text.startsWith('//') ? null : text;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? text : null;
  } catch {
    return null;
  }
}
