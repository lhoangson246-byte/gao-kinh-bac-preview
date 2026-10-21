import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import db from '../db.js';
import { LIMITS, CATALOG_GROUPS } from '../constants.js';
import { HttpError, cleanText, toInteger } from '../validate.js';
import { listGroups } from '../product-groups.js';

const router = Router();
router.use(validateRoutes('products'));
// Không có cost_price: giá nhập là thông tin nội bộ của cửa hàng.
const PUBLIC_COLUMNS = 'id, name, description, origin, price, original_price, unit, stock, '
  + 'image_url, is_active, category, points_per_unit, weight_kg, created_at';

/** Bỏ ý nghĩa đặc biệt của % và _ để khách gõ ký tự nào cũng chỉ là tìm kiếm chữ. */
const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * GET /api/products — Danh sách sản phẩm đang bán.
 * ?q= tìm theo tên, ?in_stock=1 chỉ hàng còn, ?group= giam-gia (tự tính) hoặc mã nhóm gạo
 * cửa hàng tự tạo (nha-hang, co-may, …). Mã nhóm không có hoặc đang ẩn thì không ra sản phẩm nào.
 */
router.get('/', (req, res) => {
  const keyword = cleanText(req.query.q, LIMITS.name) || '';
  const pattern = `%${escapeLike(keyword)}%`;
  const inStockOnly = req.query.in_stock === '1';
  // Điều kiện lấy từ danh sách cố định trong constants.js, không ghép chữ khách gửi.
  // Object.hasOwn để "constructor" hay "__proto__" không lọt qua như một nhóm.
  const group = String(req.query.group || '');
  const builtIn = Object.hasOwn(CATALOG_GROUPS, group);
  const groupClause = builtIn ? `AND ${CATALOG_GROUPS[group]}`
    : group ? `AND id IN (SELECT gi.product_id FROM product_group_items gi
                          JOIN product_groups g ON g.id = gi.group_id
                          WHERE g.slug = ? AND g.is_active = 1)`
    : '';
  const groupParams = group && !builtIn ? [group] : [];

  const rows = db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM products
       WHERE is_active = 1
         ${inStockOnly ? 'AND stock > 0' : ''}
         ${groupClause}
         AND (name LIKE ? ESCAPE '\\'
              OR IFNULL(origin, '') LIKE ? ESCAPE '\\'
              OR IFNULL(description, '') LIKE ? ESCAPE '\\')
       -- Còn hàng lên trước, rồi trong đó hàng đang giảm giá lên đầu tiên.
       ORDER BY stock > 0 DESC, (original_price > price AND price > 0) DESC, id`
    )
    .all(...groupParams, pattern, pattern, pattern);

  // Chỉ danh mục công khai: đơn hàng vẫn tự đọc lại giá và tồn kho trong transaction.
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
  res.json({ products: rows });
});

/** GET /api/products/groups — các nhóm gạo đang hiện trên bộ lọc, theo thứ tự cửa hàng xếp. */
router.get('/groups', (req, res) => {
  const groups = listGroups({ publicOnly: true })
    .map(({ slug, name, product_count: count }) => ({ slug, name, count }));
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
  res.json({ groups });
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
