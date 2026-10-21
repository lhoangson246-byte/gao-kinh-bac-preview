import db from './db.js';

/**
 * Nhóm gạo do cửa hàng tự tạo (bộ lọc trên trang chủ). Một sản phẩm có thể thuộc nhiều nhóm.
 * Bảng product_groups giữ tên, mã (slug) và thứ tự; product_group_items là bảng nối.
 * "Đang giảm giá" không phải nhóm lưu sẵn mà tự tính từ giá gốc (xem CATALOG_GROUPS).
 */

export const MAX_GROUPS = 30;
/** Mã dành riêng cho bộ lọc tự tính, nhóm tự tạo không được trùng. */
export const RESERVED_SLUGS = ['giam-gia'];

/** "Gạo thơm Thái" → "gao-thom-thai". */
export function slugify(name) {
  const slug = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'nhom';
}

/** Mã chưa dùng, thêm -2, -3… nếu trùng. Gọi trong transaction. */
export function uniqueSlug(name, exceptId = null) {
  const base = slugify(name);
  const taken = db.prepare('SELECT 1 FROM product_groups WHERE slug = ? AND (? IS NULL OR id <> ?)');
  let slug = base;
  for (let n = 2; RESERVED_SLUGS.includes(slug) || taken.get(slug, exceptId, exceptId); n++) slug = `${base}-${n}`;
  return slug;
}

/** Danh sách nhóm kèm số sản phẩm; publicOnly: chỉ nhóm đang hiện và chỉ đếm hàng đang bán. */
export function listGroups({ publicOnly = false } = {}) {
  return db.prepare(`
    SELECT g.id, g.slug, g.name, g.sort_order, g.is_active,
           COUNT(p.id) AS product_count
    FROM product_groups g
    LEFT JOIN product_group_items gi ON gi.group_id = g.id
    LEFT JOIN products p ON p.id = gi.product_id ${publicOnly ? 'AND p.is_active = 1' : ''}
    ${publicOnly ? 'WHERE g.is_active = 1' : ''}
    GROUP BY g.id
    ORDER BY g.sort_order, g.id
  `).all();
}

/** Map id sản phẩm → mảng id nhóm. */
export function groupIdsByProduct() {
  const map = new Map();
  for (const row of db.prepare('SELECT product_id, group_id FROM product_group_items ORDER BY group_id').all()) {
    if (!map.has(row.product_id)) map.set(row.product_id, []);
    map.get(row.product_id).push(row.group_id);
  }
  return map;
}

export function groupIdsOf(productId) {
  return db.prepare('SELECT group_id FROM product_group_items WHERE product_id = ? ORDER BY group_id')
    .all(productId).map((r) => r.group_id);
}

/**
 * Đặt lại toàn bộ nhóm của một sản phẩm. Id nhóm không tồn tại bị bỏ qua.
 * Gọi BÊN TRONG transaction (câu lệnh chuẩn bị tại chỗ, đúng yêu cầu của Turso).
 */
export function setProductGroups(productId, groupIds) {
  const ids = [...new Set(groupIds.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  db.prepare('DELETE FROM product_group_items WHERE product_id = ?').run(productId);
  if (!ids.length) return;
  const valid = db.prepare(`SELECT id FROM product_groups WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids).map((r) => r.id);
  const insert = db.prepare('INSERT OR IGNORE INTO product_group_items (group_id, product_id) VALUES (?, ?)');
  for (const groupId of valid) insert.run(groupId, productId);
}
