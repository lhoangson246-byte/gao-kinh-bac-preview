import db from './db.js';

/**
 * Khách buôn (11/11/2026): công ty, nhà hàng, bếp ăn mua số lượng lớn. Mỗi khách có mã cố định
 * (KB0001…) và bảng giá cố định theo từng loại gạo do cửa hàng đặt. Giá riêng CHỈ áp dụng cho đơn do
 * nhân viên tạo; khách buôn tự đặt trên web vẫn trả đúng giá web. Khách buôn không dùng mã giảm giá,
 * không nhận ưu đãi đơn đầu và không tích điểm.
 */
export const WHOLESALE_CODE_RE = /^kb\d{4,}$/i;
export const wholesaleCode = (id) => `KB${String(id).padStart(4, '0')}`;

const COLUMNS = `w.id, w.code, w.company, w.contact_name, w.phone, w.address, w.note, w.is_active, w.user_id,
  w.created_at, w.updated_at, u.full_name AS login_name`;

export const shapeWholesale = (row) => row && ({
  id: row.id, code: row.code, company: row.company, contact_name: row.contact_name, phone: row.phone,
  address: row.address || null, note: row.note || null, is_active: row.is_active ? 1 : 0,
  has_login: !!row.user_id, price_count: row.price_count ?? undefined,
  created_at: row.created_at, updated_at: row.updated_at || null,
});

export function getWholesale(id) {
  return db.prepare(`SELECT ${COLUMNS} FROM wholesale_customers w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?`).get(id);
}

/** Khách buôn đang hoạt động gắn với một tài khoản đăng nhập (null nếu không phải khách buôn). */
export function wholesaleOfUser(userId) {
  if (!userId) return null;
  return db.prepare('SELECT id, code, company FROM wholesale_customers WHERE user_id = ? AND is_active = 1').get(userId) || null;
}

/** Bảng giá cố định: Map id sản phẩm → giá. */
export function wholesalePrices(customerId) {
  return new Map(db.prepare('SELECT product_id, price FROM wholesale_prices WHERE customer_id = ?')
    .all(customerId).map((r) => [r.product_id, r.price]));
}
