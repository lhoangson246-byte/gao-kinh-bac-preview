import { Router } from 'express';
import db from '../db.js';
import { cleanImageUrl, normalizePhone } from '../validate.js';

/**
 * Cài đặt cửa hàng khách được xem: các ảnh banner trang chủ (chạy vòng) và số
 * điện thoại tư vấn. Cửa hàng đổi trong trang quản trị (PUT /api/admin/settings/storefront).
 */
const router = Router();

/** Số ảnh banner tối đa trong vòng chạy. */
export const MAX_BANNERS = 6;
/** Số cơ sở cửa hàng tối đa hiện ở chân trang. */
export const MAX_BRANCHES = 5;

/** Các khoá đọc từ app_settings. Khoá không nằm ở đây thì không bao giờ trả ra ngoài. */
const STORED_KEYS = ['banner_images', 'banner_image_url', 'contact_phone', 'store_branches'];

/** Danh sách ảnh lưu dạng JSON; bỏ mọi phần tử không còn là đường dẫn ảnh an toàn. */
function parseBanners(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list.map((url) => (typeof url === 'string' ? cleanImageUrl(url) : null))
      .filter(Boolean).slice(0, MAX_BANNERS);
  } catch {
    return [];
  }
}

/** Danh sách cơ sở lưu dạng JSON [{ name, address, phone }]; bỏ dòng hỏng. */
function parseBranches(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter((b) => b && typeof b.address === 'string' && b.address.trim())
      .slice(0, MAX_BRANCHES)
      .map((b) => ({
        name: typeof b.name === 'string' ? b.name.slice(0, 80) : '',
        address: b.address.slice(0, 300),
        phone: normalizePhone(typeof b.phone === 'string' ? b.phone : ''),
      }));
  } catch {
    return [];
  }
}

export function readStorefront() {
  const placeholders = STORED_KEYS.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`).all(...STORED_KEYS);
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value || '']));

  // Trước đây chỉ có một ảnh (banner_image_url). Chưa lưu danh sách thì dùng ảnh cũ đó.
  const banners = stored.banner_images !== undefined
    ? parseBanners(stored.banner_images)
    : [cleanImageUrl(stored.banner_image_url || '')].filter(Boolean);

  return {
    banner_images: banners,
    // Giữ cho bản ứng dụng cũ còn trong bộ nhớ đệm của khách.
    banner_image_url: banners[0] || '',
    contact_phone: normalizePhone(stored.contact_phone || ''),
    branches: parseBranches(stored.store_branches),
  };
}

/** GET /api/settings/storefront — ảnh banner, số điện thoại tư vấn */
router.get('/storefront', (req, res) => {
  // Giống danh mục: giống nhau với mọi khách nên cho CDN giữ ngắn hạn.
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
  res.json({ settings: readStorefront() });
});

export default router;
