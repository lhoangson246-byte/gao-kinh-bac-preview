import db from './db.js';

/**
 * Tìm khách để giao hàng (13/11/2026): nhân viên giao hàng gõ tên, số điện thoại, địa chỉ hoặc mã khách
 * buôn, kể cả khách không có đơn đang giao cho mình, để gọi và chỉ đường. Nguồn: khách buôn, địa chỉ
 * khách đã từng nhận hàng (đơn chưa huỷ, giao tận nơi) và sổ địa chỉ của tài khoản khách.
 *
 * Tìm không phân biệt dấu ("ly thai to" ra "Lý Thái Tổ"), nên đọc danh sách lên rồi lọc ở đây; danh sách
 * được giữ 60 giây trong bộ nhớ để gõ từng chữ không phải đọc lại cơ sở dữ liệu.
 */
const CACHE_MS = 60_000;
const MAX_ROWS = 4000;
export const SEARCH_LIMIT = 12;
const PICKUP = 'Khách lấy tại cửa hàng';

export const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
const digits = (value) => String(value || '').replace(/\D/g, '');
const coordsUrl = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);

let cache = { at: 0, rows: [] };
/** Gọi sau khi dữ liệu khách đổi mà cần thấy ngay (kiểm thử). */
export const clearCustomerSearchCache = () => { cache = { at: 0, rows: [] }; };

function loadRows() {
  if (Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = [];
  const seen = new Map();          // số điện thoại + địa chỉ (bỏ dấu) → dòng, để gộp trùng
  const push = (row) => {
    const key = `${digits(row.phone)}|${fold(row.address).replace(/[\s,.]+/g, ' ').trim()}`;
    const found = seen.get(key);
    if (found) {
      // Cùng khách, cùng địa chỉ: giữ định vị nếu nguồn trước chưa có.
      found.map_url ||= row.map_url;
      found.order_count += row.order_count || 0;
      found.last_order_at ||= row.last_order_at;
      return;
    }
    row.haystack = fold(`${row.code || ''} ${row.company || ''} ${row.name} ${row.address} ${row.phone}`);
    row.phone_digits = digits(row.phone);
    seen.set(key, row);
    rows.push(row);
  };

  for (const w of db.prepare(`
    SELECT code, company, contact_name, phone, address, map_url FROM wholesale_customers WHERE is_active = 1
  `).all()) {
    push({ kind: 'wholesale', code: w.code, company: w.company, name: w.contact_name, phone: w.phone, address: w.address || '', map_url: w.map_url, order_count: 0 });
  }
  // Mỗi cặp (số điện thoại, địa chỉ) lấy đơn mới nhất: SQLite trả các cột của đúng dòng có MAX(id).
  for (const o of db.prepare(`
    SELECT receiver_name, phone, address, map_url, delivery_lat, delivery_lng, MAX(id) AS last_id, created_at, COUNT(*) AS n
    FROM orders
    WHERE status <> 'cancelled' AND fulfillment <> 'pickup' AND address <> ? AND address <> ''
    GROUP BY phone, address ORDER BY last_id DESC LIMIT ?
  `).all(PICKUP, MAX_ROWS)) {
    push({
      kind: 'order', name: o.receiver_name, phone: o.phone, address: o.address,
      map_url: o.map_url || coordsUrl(o.delivery_lat, o.delivery_lng), order_count: o.n, last_order_at: o.created_at,
    });
  }
  // Đơn mới nhất có thể không dán định vị: lấy định vị gần nhất từng có của cùng khách, cùng địa chỉ.
  for (const o of db.prepare(`
    SELECT receiver_name, phone, address, map_url, delivery_lat, delivery_lng, MAX(id) AS last_id
    FROM orders
    WHERE status <> 'cancelled' AND fulfillment <> 'pickup' AND address <> ? AND address <> ''
      AND (map_url IS NOT NULL OR delivery_lat IS NOT NULL)
    GROUP BY phone, address ORDER BY last_id DESC LIMIT ?
  `).all(PICKUP, MAX_ROWS)) {
    push({ kind: 'order', name: o.receiver_name, phone: o.phone, address: o.address, map_url: o.map_url || coordsUrl(o.delivery_lat, o.delivery_lng), order_count: 0 });
  }
  for (const a of db.prepare(`
    SELECT receiver_name, phone, address, latitude, longitude FROM delivery_addresses ORDER BY id DESC LIMIT ?
  `).all(MAX_ROWS)) {
    push({ kind: 'saved', name: a.receiver_name, phone: a.phone, address: a.address, map_url: coordsUrl(a.latitude, a.longitude), order_count: 0 });
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/**
 * Trả tối đa SEARCH_LIMIT khách khớp MỌI từ đã gõ. Số điện thoại khớp theo chữ số (gõ "0912 345" cũng ra).
 * Ưu tiên: khớp số điện thoại / mã khách, có định vị, khách buôn, nhiều đơn.
 */
export function searchCustomers(query) {
  const q = fold(query).trim();
  const words = q.split(/\s+/).filter(Boolean);
  const qDigits = digits(query);
  if (q.length < 2) return [];
  const scored = [];
  for (const row of loadRows()) {
    const byPhone = qDigits.length >= 3 && /^[\d\s.+-]+$/.test(query.trim()) && row.phone_digits.includes(qDigits);
    if (!byPhone && !words.every((w) => row.haystack.includes(w))) continue;
    let score = row.order_count;
    if (byPhone) score += 1000;
    if (row.code && fold(row.code) === q) score += 1000;
    if (fold(row.name).startsWith(words[0]) || fold(row.company).startsWith(words[0])) score += 50;
    if (row.map_url) score += 20;
    if (row.kind === 'wholesale') score += 10;
    scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, SEARCH_LIMIT).map(({ row }) => ({
    kind: row.kind, code: row.code || null, company: row.company || null, name: row.name, phone: row.phone,
    address: row.address, map_url: row.map_url || null, order_count: row.order_count, last_order_at: row.last_order_at || null,
  }));
}
