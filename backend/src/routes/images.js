import { Router } from 'express';
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../validate.js';

const router = Router();

/** Ảnh tối đa 3MB. Trình duyệt đã thu nhỏ trước khi gửi nên thường chỉ ~150KB. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Nhận dạng ảnh bằng chính mấy byte đầu tệp, KHÔNG tin Content-Type trình duyệt
 * gửi lên. Nhờ vậy không ai gắn được tệp lạ rồi để máy chủ phát lại cho khách.
 */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * POST /api/admin/images — cửa hàng tải ảnh sản phẩm lên.
 * Thân yêu cầu là chính nội dung tệp ảnh (không phải JSON).
 */
router.post(
  '/admin/images',
  requireAuth,
  requireAdmin,
  express.raw({ type: ACCEPTED, limit: MAX_IMAGE_BYTES }),
  (req, res, next) => {
    try {
      const buf = req.body;
      // express.raw chỉ đọc những định dạng trong ACCEPTED; kiểu khác sẽ không có body.
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        throw new HttpError(400, 'Chưa chọn được ảnh. Cửa hàng chỉ nhận ảnh JPG, PNG hoặc WEBP.');
      }
      const mime = sniffImage(buf);
      if (!mime) {
        throw new HttpError(400, 'Tệp này không phải ảnh JPG, PNG hay WEBP.');
      }
      if (buf.length > MAX_IMAGE_BYTES) {
        throw new HttpError(413, 'Ảnh quá nặng. Vui lòng chọn ảnh nhỏ hơn 3MB.');
      }

      // Tải lên đúng tấm ảnh đã có thì dùng lại bản cũ thay vì lưu thêm một bản.
      // Chọn theo MIN(id) đúng như thư viện ảnh bên dưới, để hai nơi luôn trỏ về
      // cùng một ảnh đại diện cho mỗi nội dung.
      const sha256 = createHash('sha256').update(buf).digest('hex');
      const existing = db
        .prepare('SELECT id, mime FROM product_images WHERE sha256 = ? ORDER BY id LIMIT 1')
        .get(sha256);
      if (existing) {
        return res.status(200).json({
          url: `/api/images/${existing.id}.${EXTENSION[existing.mime]}`,
          size: buf.length,
          reused: true,
        });
      }

      const id = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO product_images (id, mime, bytes, size, sha256) VALUES (?, ?, ?, ?, ?)')
        .run(id, mime, buf, buf.length, sha256);

      return res.status(201).json({ url: `/api/images/${id}.${EXTENSION[mime]}`, size: buf.length });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/images — thư viện ảnh để cửa hàng chọn lại.
 * Gồm ảnh đã tải lên và ảnh các loại gạo khác đang dùng, nhờ vậy nhân viên
 * không phải nhớ tên tệp mới gán được ảnh cho một loại gạo.
 */
router.get('/admin/images', requireAuth, requireAdmin, (req, res) => {
  // Gộp những ảnh trùng nội dung lại làm một để thư viện không lặp.
  const uploaded = db
    .prepare(`
      SELECT id, mime, size, created_at FROM product_images
      WHERE id IN (
        SELECT MIN(id) FROM product_images GROUP BY COALESCE(sha256, id)
      )
      ORDER BY created_at DESC
      LIMIT 200
    `)
    .all()
    .map((row) => ({
      url: `/api/images/${row.id}.${EXTENSION[row.mime] || 'jpg'}`,
      size: row.size,
      created_at: row.created_at,
    }));

  // Ảnh kèm sẵn trong ứng dụng chỉ được biết đến qua sản phẩm đang dùng chúng.
  const inUse = db
    .prepare(`
      SELECT image_url AS url, MIN(name) AS product_name, COUNT(*) AS uses
      FROM products
      WHERE image_url IS NOT NULL AND TRIM(image_url) <> ''
      GROUP BY image_url
      ORDER BY MIN(name)
    `)
    .all()
    .filter((row) => !row.url.startsWith('/api/images/'));

  res.json({ uploaded, inUse });
});

/** GET /api/images/:file — phát ảnh cho khách xem. Ai cũng xem được, như ảnh trong thư mục public. */
router.get('/images/:file', (req, res) => {
  // Bỏ phần đuôi tệp: đuôi chỉ để đường dẫn đẹp, danh tính nằm ở phần id.
  const id = String(req.params.file).replace(/\.[a-z0-9]+$/i, '');
  if (!/^[0-9a-f]{32}$/.test(id)) {
    return res.status(404).json({ message: 'Không tìm thấy ảnh.' });
  }
  const row = db.prepare('SELECT mime, bytes FROM product_images WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ message: 'Không tìm thấy ảnh.' });

  // Ảnh không bao giờ đổi nội dung (mỗi lần tải lên sinh id mới) nên cho phép
  // trình duyệt giữ lại lâu. Ghi đè Cache-Control "no-store" đặt chung cho /api.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type(row.mime);
  return res.send(row.bytes);
});

export default router;
