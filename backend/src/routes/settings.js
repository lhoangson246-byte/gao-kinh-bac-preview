import { Router } from 'express';
import db from '../db.js';

/**
 * Cài đặt cửa hàng khách được xem. Hiện chỉ có ảnh banner trang chủ; cửa hàng đổi
 * ảnh trong trang quản trị (PUT /api/admin/settings/storefront).
 */
const router = Router();

/** Các khoá được công khai. Khoá không nằm ở đây thì không bao giờ trả ra ngoài. */
export const STOREFRONT_KEYS = ['banner_image_url'];

export function readStorefront() {
  const placeholders = STOREFRONT_KEYS.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`).all(...STOREFRONT_KEYS);
  const settings = Object.fromEntries(STOREFRONT_KEYS.map((key) => [key, '']));
  for (const row of rows) settings[row.key] = row.value || '';
  return settings;
}

/** GET /api/settings/storefront — ảnh banner và các cài đặt công khai khác */
router.get('/storefront', (req, res) => {
  // Giống danh mục: giống nhau với mọi khách nên cho CDN giữ ngắn hạn.
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
  res.json({ settings: readStorefront() });
});

export default router;
