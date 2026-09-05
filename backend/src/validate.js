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
export const normalizePhone = (v) => {
  const raw = String(v ?? '').replace(/[\s.\-()]/g, '');
  if (!raw) return '';
  const normalized = raw.startsWith('+84') ? `0${raw.slice(3)}`
    : raw.startsWith('84') && raw.length >= 11 ? `0${raw.slice(2)}`
    : raw;
  return /^0\d{9}$/.test(normalized) ? normalized : '';
};

export const isEmail = (v) =>
  typeof v === 'string' && v.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const isPhone = (v) => normalizePhone(v) !== '';

/** Bỏ khoảng trắng thừa; trả về null nếu rỗng. */
export function cleanText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return maxLength ? text.slice(0, maxLength) : text;
}

/** Số nguyên không âm trong khoảng cho phép, hoặc null nếu không hợp lệ. */
export function toInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === '' || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

/**
 * Chấp nhận URL ảnh http/https, hoặc đường dẫn nội bộ của ứng dụng ("/products/....jpg").
 * Chặn các dạng nguy hiểm như "javascript:" hay "//tên-miền-khác".
 */
export function cleanImageUrl(value) {
  const text = cleanText(value, LIMITS.imageUrl);
  if (!text) return null;
  if (text.startsWith('/')) return text.startsWith('//') ? null : text;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? text : null;
  } catch {
    return null;
  }
}
