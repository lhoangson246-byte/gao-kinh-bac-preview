import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import db from '../db.js';
import { LIMITS } from '../constants.js';
import { HttpError, cleanText, toInteger } from '../validate.js';

const router = Router();
router.use(validateRoutes('products'));
const PUBLIC_COLUMNS = 'id, name, description, origin, price, unit, stock, image_url, is_active, created_at';

/** Bỏ ý nghĩa đặc biệt của % và _ để khách gõ ký tự nào cũng chỉ là tìm kiếm chữ. */
const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** GET /api/products — Danh sách loại gạo đang bán (tìm kiếm ?q=, lọc ?in_stock=1) */
router.get('/', (req, res) => {
  const keyword = cleanText(req.query.q, LIMITS.name) || '';
  const pattern = `%${escapeLike(keyword)}%`;
  const inStockOnly = req.query.in_stock === '1';

  const rows = db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM products
       WHERE is_active = 1
         ${inStockOnly ? 'AND stock > 0' : ''}
         AND (name LIKE ? ESCAPE '\\'
              OR IFNULL(origin, '') LIKE ? ESCAPE '\\'
              OR IFNULL(description, '') LIKE ? ESCAPE '\\')
       ORDER BY stock > 0 DESC, id`
    )
    .all(pattern, pattern, pattern);

  res.json({ products: rows });
});

/** GET /api/products/:id — Chi tiết */
router.get('/:id', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    const product = productId
      ? db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM products WHERE id = ? AND is_active = 1`).get(productId)
      : null;
    if (!product) throw new HttpError(404, 'Không tìm thấy loại gạo này.');
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

export default router;
