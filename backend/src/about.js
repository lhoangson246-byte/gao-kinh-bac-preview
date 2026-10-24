/**
 * Trang "Về chúng tôi" (24/10/2026): lời giới thiệu, giấy tờ (an toàn thực phẩm, công bố sản phẩm…)
 * và đánh giá dịch vụ giao hàng. Mọi nội dung do quản trị viên nhập — không có dữ liệu mẫu.
 */
import db from './db.js';
import { HttpError } from './validate.js';

export const REVIEW_MAX_SCORE = 6;
export const DOCUMENT_CATEGORIES = { attp: 'An toàn thực phẩm', 'cong-bo': 'Công bố sản phẩm', khac: 'Giấy tờ khác' };
export const DOCUMENT_CATEGORY_CODES = Object.keys(DOCUMENT_CATEGORIES);
export const ABOUT_LIMITS = { intro: 3000, title: 120, note: 300, reviewName: 80, reviewContent: 2000 };

/** Văn bản nhiều dòng: giữ xuống dòng (bỏ dòng trống thừa), bỏ ký tự điều khiển. */
export function cleanLongText(value, max) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, 'Nội dung sai kiểu hoặc quá dài.');
  const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  return text || null;
}

export const readIntro = () => db.prepare("SELECT value FROM app_settings WHERE key = 'about_intro'").get()?.value || '';

export function listDocuments({ all = false } = {}) {
  return db.prepare(`
    SELECT id, title, category, image_url, note, sort_order, is_visible, updated_at FROM about_documents
    ${all ? '' : 'WHERE is_visible = 1'} ORDER BY sort_order, id
  `).all();
}

export function listReviews({ all = false } = {}) {
  return db.prepare(`
    SELECT id, customer_name, content, score, review_date, is_visible, created_at FROM service_reviews
    ${all ? '' : 'WHERE is_visible = 1'} ORDER BY COALESCE(review_date, substr(created_at, 1, 10)) DESC, id DESC LIMIT 500
  `).all();
}

/** Điểm trung bình của các đánh giá đang hiện và có chấm điểm. */
export function reviewSummary(reviews) {
  const scored = reviews.filter((r) => Number.isInteger(r.score));
  const average = scored.length ? Math.round((scored.reduce((s, r) => s + r.score, 0) / scored.length) * 10) / 10 : null;
  return { count: reviews.length, scored: scored.length, average, max_score: REVIEW_MAX_SCORE };
}
