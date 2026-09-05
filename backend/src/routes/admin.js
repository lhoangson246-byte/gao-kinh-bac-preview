import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { restoreStockForOrder } from './orders.js';
import { ALLOWED_TRANSITIONS, ORDER_STATUSES, LIMITS } from '../constants.js';
import { HttpError, cleanImageUrl, cleanText, toInteger } from '../validate.js';

const router = Router();

// Mọi API trong tệp này đều bắt buộc đăng nhập và có vai trò admin,
// kiểm tra tại máy chủ chứ không dựa vào việc ẩn nút ở giao diện.
router.use(requireAuth, requireAdmin);

/** GET /api/admin/orders — Tất cả đơn hàng (lọc ?status=) */
router.get('/orders', (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !ORDER_STATUSES.includes(status)) {
      throw new HttpError(400, `Trạng thái phải thuộc: ${ORDER_STATUSES.join(', ')}.`);
    }

    const sql = `SELECT o.*, u.email AS user_email, u.full_name AS user_name
                 FROM orders o JOIN users u ON u.id = o.user_id
                 ${status ? 'WHERE o.status = ?' : ''}
                 ORDER BY o.id DESC`;
    const orders = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
    const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
    res.json({ orders: orders.map((o) => ({ ...o, items: getItems.all(o.id) })) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/orders/:id/status — Đổi trạng thái đơn theo đúng quy trình */
router.patch('/orders/:id/status', (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    const { status } = req.body || {};
    if (!orderId) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    if (!ORDER_STATUSES.includes(status)) {
      throw new HttpError(400, `Trạng thái phải thuộc: ${ORDER_STATUSES.join(', ')}.`);
    }

    const update = db.transaction(() => {
      const current = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId);
      if (!current) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
      if (!ALLOWED_TRANSITIONS[current.status]?.includes(status)) {
        throw new HttpError(400, `Không thể chuyển đơn từ “${current.status}” sang “${status}”.`);
      }

      // Chỉ đổi khi trạng thái vẫn đúng như lúc đọc — hai request cùng huỷ
      // một đơn thì chỉ một request hoàn kho.
      const changed = db
        .prepare('UPDATE orders SET status = ? WHERE id = ? AND status = ?')
        .run(status, current.id, current.status).changes;
      if (!changed) {
        throw new HttpError(409, 'Đơn hàng vừa được cập nhật ở nơi khác. Vui lòng tải lại trang.');
      }
      if (status === 'cancelled') restoreStockForOrder(current.id);
    });

    update();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/products — Danh sách gồm cả loại đã ẩn */
router.get('/products', (req, res) => {
  res.json({ products: db.prepare('SELECT * FROM products ORDER BY id').all() });
});

/** Kiểm tra dữ liệu sản phẩm. partial = true khi sửa (cho phép bỏ trống trường không đổi). */
function readProductInput(body, { partial }) {
  const errors = {};
  const data = {};

  const has = (key) => body?.[key] !== undefined;

  if (!partial || has('name')) {
    const name = cleanText(body?.name, LIMITS.name);
    if (!name || name.length < 2) errors.name = 'Nhập tên loại gạo.';
    else data.name = name;
  }

  if (!partial || has('price')) {
    const price = toInteger(body?.price, { min: 1, max: LIMITS.price });
    if (price == null) errors.price = `Giá bán phải là số nguyên từ 1 đến ${LIMITS.price} đồng.`;
    else data.price = price;
  }

  if (!partial || has('stock')) {
    const blank = body?.stock === '' || body?.stock == null;
    if (blank) {
      if (!partial) data.stock = 0;   // thêm mới mà bỏ trống thì coi như chưa có hàng
    } else {
      const stock = toInteger(body.stock, { min: 0, max: LIMITS.stock });
      if (stock == null) errors.stock = `Tồn kho phải là số nguyên từ 0 đến ${LIMITS.stock}.`;
      else data.stock = stock;
    }
  }

  if (!partial || has('unit')) {
    data.unit = cleanText(body?.unit, LIMITS.unit) || 'kg';
  }
  if (has('origin')) data.origin = cleanText(body.origin, LIMITS.origin);
  if (has('description')) data.description = cleanText(body.description, LIMITS.description);

  if (has('image_url')) {
    const raw = cleanText(body.image_url, LIMITS.imageUrl);
    const url = cleanImageUrl(body.image_url);
    if (raw && !url) errors.image_url = 'Đường dẫn ảnh phải bắt đầu bằng http:// hoặc https://';
    else data.image_url = url;
  }

  if (has('is_active')) data.is_active = body.is_active ? 1 : 0;

  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
  return data;
}

/** POST /api/admin/products — Thêm loại gạo */
router.post('/products', (req, res, next) => {
  try {
    const data = readProductInput(req.body, { partial: false });
    const info = db
      .prepare(
        `INSERT INTO products (name, description, origin, price, unit, stock, image_url, is_active)
         VALUES (@name, @description, @origin, @price, @unit, @stock, @image_url, @is_active)`
      )
      .run({
        name: data.name,
        description: data.description ?? null,
        origin: data.origin ?? null,
        price: data.price,
        unit: data.unit,
        stock: data.stock ?? 0,
        image_url: data.image_url ?? null,
        is_active: data.is_active ?? 1,
      });
    res.status(201).json({
      product: db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid),
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/admin/products/:id — Sửa loại gạo (chỉ cập nhật trường được gửi lên) */
router.put('/products/:id', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    if (!productId) throw new HttpError(404, 'Không tìm thấy loại gạo.');

    const data = readProductInput(req.body, { partial: true });
    const fields = Object.keys(data);
    if (!fields.length) throw new HttpError(400, 'Không có thông tin nào để cập nhật.');

    const info = db
      .prepare(
        `UPDATE products SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`
      )
      .run({ ...data, id: productId });
    if (!info.changes) {
      const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
      if (!exists) throw new HttpError(404, 'Không tìm thấy loại gạo.');
    }
    res.json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(productId) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/products/:id — Ẩn khỏi cửa hàng (soft delete, giữ nguyên đơn cũ) */
router.delete('/products/:id', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    if (!productId) throw new HttpError(404, 'Không tìm thấy loại gạo.');
    const info = db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(productId);
    if (!info.changes) throw new HttpError(404, 'Không tìm thấy loại gạo.');
    res.json({ ok: true, product: db.prepare('SELECT * FROM products WHERE id = ?').get(productId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/stats — Thống kê nhanh cho dashboard */
router.get('/stats', (req, res) => {
  const countOrders = db.prepare('SELECT COUNT(*) c FROM orders WHERE status = ?');
  res.json({
    stats: {
      users: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer'").get().c,
      products: db.prepare('SELECT COUNT(*) c FROM products WHERE is_active = 1').get().c,
      orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
      pending: countOrders.get('pending').c,
      shipping: countOrders.get('shipping').c,
      lowStock: db.prepare('SELECT COUNT(*) c FROM products WHERE is_active = 1 AND stock <= 10').get().c,
      missingPrice: db.prepare('SELECT COUNT(*) c FROM products WHERE is_active = 1 AND price <= 0').get().c,
      revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status = 'completed'").get().s,
    },
  });
});

export default router;
