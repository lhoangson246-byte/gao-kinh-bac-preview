import db from './db.js';
import { MAP_ONLY_ADDRESS } from './map-link.js';

/**
 * Hồ sơ khách tự lưu (18/11/2026): mỗi số điện thoại một hồ sơ gồm tên, địa chỉ giao, định vị (link Google
 * Maps nhân viên dán, hoặc vị trí khách tự ghim lúc đặt) và số lần đặt. Mỗi đơn mới (web, mua nhanh, nhân
 * viên tạo) tự cập nhật hồ sơ trong cùng transaction với đơn.
 *
 * Quy tắc cập nhật: tên luôn lấy theo đơn mới nhất; địa chỉ mới thay địa chỉ cũ (đơn lấy tại cửa hàng thì
 * giữ địa chỉ cũ); định vị mới thay định vị cũ; đổi sang địa chỉ khác mà không gửi định vị thì bỏ định vị
 * cũ (định vị cũ là của địa chỉ cũ).
 */
const PICKUP = 'Khách lấy tại cửa hàng';
const coordsUrl = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);

/** Gọi BÊN TRONG transaction tạo đơn. */
export function rememberCustomer({ phone, name, address, mapUrl = null, lat = null, lng = null, orderId }) {
  if (!phone) return;
  const realAddress = address && address !== PICKUP && address !== MAP_ONLY_ADDRESS ? address : null;
  const hasPin = !!mapUrl || (lat != null && lng != null);
  db.prepare(`
    INSERT INTO customer_profiles (phone, full_name, address, map_url, lat, lng, order_count, first_order_at, last_order_at, last_order_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), ?, datetime('now'))
    ON CONFLICT (phone) DO UPDATE SET
      full_name = COALESCE(excluded.full_name, customer_profiles.full_name),
      map_url = CASE WHEN ? THEN excluded.map_url
                     WHEN excluded.address IS NOT NULL AND excluded.address <> COALESCE(customer_profiles.address, '') THEN NULL
                     ELSE customer_profiles.map_url END,
      lat = CASE WHEN ? THEN excluded.lat
                 WHEN excluded.address IS NOT NULL AND excluded.address <> COALESCE(customer_profiles.address, '') THEN NULL
                 ELSE customer_profiles.lat END,
      lng = CASE WHEN ? THEN excluded.lng
                 WHEN excluded.address IS NOT NULL AND excluded.address <> COALESCE(customer_profiles.address, '') THEN NULL
                 ELSE customer_profiles.lng END,
      address = COALESCE(excluded.address, customer_profiles.address),
      order_count = customer_profiles.order_count + 1,
      last_order_at = excluded.last_order_at, last_order_id = excluded.last_order_id, updated_at = excluded.updated_at
  `).run(phone, name || null, realAddress, mapUrl, lat, lng, orderId, hasPin ? 1 : 0, hasPin ? 1 : 0, hasPin ? 1 : 0);
}

/** Hồ sơ đọc ra cho nhân viên: thêm `location` = link mở bản đồ (link dán hoặc toạ độ ghim). */
export const shapeProfile = (row) => (!row ? null : {
  phone: row.phone, full_name: row.full_name, address: row.address, map_url: row.map_url,
  lat: row.lat, lng: row.lng, location: row.map_url || coordsUrl(row.lat, row.lng),
  order_count: row.order_count, first_order_at: row.first_order_at, last_order_at: row.last_order_at,
  last_order_code: row.last_order_code || null,
});
