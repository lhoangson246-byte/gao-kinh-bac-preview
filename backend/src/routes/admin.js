import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { restoreStockForOrder } from './orders.js';
import { creditPoints, loyaltyPhoneForOrder } from '../loyalty.js';
import { ALLOWED_TRANSITIONS, ORDER_STATUSES, LIMITS, localDate } from '../constants.js';
import { HttpError, cleanImageUrl, cleanText, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';

const router = Router();

// Mọi API trong tệp này đều bắt buộc đăng nhập và có vai trò admin,
// kiểm tra tại máy chủ chứ không dựa vào việc ẩn nút ở giao diện.
router.use(requireAuth, requireAdmin);
router.use(validateRoutes('admin'));

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

      // Đơn giao xong thì cộng điểm vào hồ sơ theo SỐ ĐIỆN THOẠI CỦA TÀI KHOẢN
      // đặt hàng — cùng hồ sơ với mua tại quầy. Nhờ câu UPDATE có điều kiện
      // "WHERE status = ?" ở trên, mỗi đơn chỉ cộng điểm đúng một lần.
      if (status === 'completed') {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(current.id);
        const phone = loyaltyPhoneForOrder(order);
        if (phone) {
          const earned = creditPoints(phone, {
            amountPaid: order.total,
            fullName: order.receiver_name,
          });
          db.prepare('UPDATE orders SET points_earned = ? WHERE id = ?').run(earned, order.id);
        }
      }
      return current;
    });

    const before = update();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
    writeAdminAudit(req, {
      action: 'update_status', entityType: 'order', entityId: orderId,
      before: { status: before.status }, after: { status: order.status },
    });
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

  // Giá nhập chỉ cửa hàng thấy; 0 nghĩa là chưa khai báo.
  if (has('cost_price')) {
    const blank = body.cost_price === '' || body.cost_price == null;
    if (blank) data.cost_price = 0;
    else {
      const cost = toInteger(body.cost_price, { min: 0, max: LIMITS.price });
      if (cost == null) errors.cost_price = `Giá nhập phải là số nguyên từ 0 đến ${LIMITS.price} đồng.`;
      else data.cost_price = cost;
    }
  }

  if (has('is_active')) data.is_active = body.is_active ? 1 : 0;

  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
  return data;
}

/* ------------------------------------------------------------------ *
 * Nhập kho: cộng thêm số lượng và ghi lại lịch sử
 * ------------------------------------------------------------------ */

const MAX_STOCK_IN = 100_000;

/** POST /api/admin/products/:id/stock — nhập thêm hàng vào kho
 *  body: { quantity, cost_price?, note? }
 *  Số lượng được CỘNG THÊM vào tồn kho hiện có, không phải ghi đè.
 */
router.post('/products/:id/stock', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    if (!productId) throw new HttpError(404, 'Không tìm thấy loại gạo.');

    const quantity = toInteger(req.body?.quantity, { min: 1, max: MAX_STOCK_IN });
    if (!quantity) {
      throw new HttpError(400, `Số lượng nhập phải là số nguyên từ 1 đến ${MAX_STOCK_IN}.`, {
        quantity: 'Nhập số lượng lớn hơn 0.',
      });
    }

    const hasCost = req.body?.cost_price !== undefined
      && req.body.cost_price !== '' && req.body.cost_price !== null;
    const costPrice = hasCost ? toInteger(req.body.cost_price, { min: 0, max: LIMITS.price }) : null;
    if (hasCost && costPrice == null) {
      throw new HttpError(400, 'Giá nhập không hợp lệ.', { cost_price: 'Giá nhập không hợp lệ.' });
    }
    const note = cleanText(req.body?.note, LIMITS.note);

    const receive = db.transaction(() => {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (!product) throw new HttpError(404, 'Không tìm thấy loại gạo.');

      const stockAfter = product.stock + quantity;
      if (stockAfter > LIMITS.stock) throw new HttpError(400, 'Tồn kho vượt giới hạn cho phép.');
      db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stockAfter, productId);
      // Khai giá nhập ở lần nhập này thì cập nhật luôn giá nhập của sản phẩm.
      if (costPrice != null) {
        db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(costPrice, productId);
      }

      db.prepare(`
        INSERT INTO stock_entries (product_id, quantity, cost_price, stock_after, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(productId, quantity, costPrice, stockAfter, note, req.user.id);

      return product;
    });

    const before = receive();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    writeAdminAudit(req, {
      action: 'receive_stock', entityType: 'product', entityId: productId,
      before: { stock: before.stock, cost_price: before.cost_price },
      after: { stock: product.stock, cost_price: product.cost_price, quantity, note },
    });
    res.status(201).json({
      product,
      entries: db.prepare(
        'SELECT * FROM stock_entries WHERE product_id = ? ORDER BY id DESC LIMIT 10'
      ).all(productId),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/products/:id/stock — lịch sử nhập kho của một loại gạo */
router.get('/products/:id/stock', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    if (!productId) throw new HttpError(404, 'Không tìm thấy loại gạo.');
    res.json({
      entries: db.prepare(
        'SELECT * FROM stock_entries WHERE product_id = ? ORDER BY id DESC LIMIT 50'
      ).all(productId),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/stock-entries — các lần nhập kho gần đây của mọi loại gạo */
router.get('/stock-entries', (req, res, next) => {
  try {
    const limit = toInteger(req.query.limit, { min: 1, max: 100 }) ?? 30;
    res.json({
      entries: db.prepare(`
        SELECT e.*, p.name AS product_name, p.unit
        FROM stock_entries e JOIN products p ON p.id = e.product_id
        ORDER BY e.id DESC LIMIT ?
      `).all(limit),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/products — Thêm loại gạo */
router.post('/products', (req, res, next) => {
  try {
    const data = readProductInput(req.body, { partial: false });
    const info = db
      .prepare(
        `INSERT INTO products (name, description, origin, price, cost_price, unit, stock, image_url, is_active)
         VALUES (@name, @description, @origin, @price, @cost_price, @unit, @stock, @image_url, @is_active)`
      )
      .run({
        name: data.name,
        description: data.description ?? null,
        origin: data.origin ?? null,
        price: data.price,
        cost_price: data.cost_price ?? 0,
        unit: data.unit,
        stock: data.stock ?? 0,
        image_url: data.image_url ?? null,
        is_active: data.is_active ?? 1,
      });
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    writeAdminAudit(req, {
      action: 'create', entityType: 'product', entityId: product.id, after: product,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/admin/products/:id — Sửa loại gạo (chỉ cập nhật trường được gửi lên) */
router.put('/products/:id', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    if (!productId) throw new HttpError(404, 'Không tìm thấy loại gạo.');

    const before = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!before) throw new HttpError(404, 'Không tìm thấy loại gạo.');
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
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    writeAdminAudit(req, {
      action: 'update', entityType: 'product', entityId: productId, before, after: product,
    });
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/products/:id — Ẩn khỏi cửa hàng (soft delete, giữ nguyên đơn cũ) */
router.delete('/products/:id', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    if (!productId) throw new HttpError(404, 'Không tìm thấy loại gạo.');
    const before = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    const info = db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(productId);
    if (!info.changes) throw new HttpError(404, 'Không tìm thấy loại gạo.');
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    writeAdminAudit(req, {
      action: 'hide', entityType: 'product', entityId: productId, before, after: product,
    });
    res.json({ ok: true, product });
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
      missingCost: db.prepare('SELECT COUNT(*) c FROM products WHERE is_active = 1 AND cost_price <= 0').get().c,
      // Giá trị vốn của hàng đang nằm trong kho.
      inventoryValue: db.prepare('SELECT COALESCE(SUM(cost_price * stock), 0) s FROM products WHERE is_active = 1').get().s,
      revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status = 'completed'").get().s,
    },
  });
});

/** GET /api/admin/activity — nhật ký thay đổi và đăng nhập gần đây. */
router.get('/activity', (req, res, next) => {
  try {
    const limit = toInteger(req.query.limit, { min: 1, max: 100 }) ?? 50;
    const audit = db.prepare(`
      SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT ?
    `).all(limit).map((row) => ({
      ...row,
      before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
      before_json: undefined,
      after_json: undefined,
    }));
    const logins = db.prepare(`
      SELECT h.id, h.user_id, h.login_method, h.ip_address, h.user_agent, h.created_at,
             u.full_name, u.email, u.phone, u.role
      FROM login_history h LEFT JOIN users u ON u.id = h.user_id
      ORDER BY h.id DESC LIMIT ?
    `).all(limit);
    res.json({ audit, logins });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Báo cáo doanh thu theo ngày / tháng
 * ------------------------------------------------------------------ */

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v) => /^\d{4}-\d{2}$/.test(v);

/** Đổi bộ lọc người dùng chọn thành khoảng ngày [from, to] theo giờ Việt Nam. */
function resolvePeriod(query) {
  const type = query.period || 'month';

  if (type === 'day') {
    const date = cleanText(query.date, 10);
    if (!date || !isDay(date)) throw new HttpError(400, 'Ngày phải theo dạng YYYY-MM-DD.');
    return { type, from: date, to: date, label: `Ngày ${date.split('-').reverse().join('/')}` };
  }

  if (type === 'month') {
    const month = cleanText(query.month, 7);
    if (!month || !isMonth(month)) throw new HttpError(400, 'Tháng phải theo dạng YYYY-MM.');
    const [y, m] = month.split('-').map(Number);
    if (m < 1 || m > 12) throw new HttpError(400, 'Tháng không hợp lệ.');
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();   // ngày cuối tháng
    return {
      type, month,
      from: `${month}-01`,
      to: `${month}-${String(lastDay).padStart(2, '0')}`,
      label: `Tháng ${m}/${y}`,
    };
  }

  if (type === 'range') {
    const from = cleanText(query.from, 10);
    const to = cleanText(query.to, 10);
    if (!from || !isDay(from) || !to || !isDay(to)) {
      throw new HttpError(400, 'Khoảng ngày phải theo dạng YYYY-MM-DD.');
    }
    if (from > to) throw new HttpError(400, '"Từ ngày" phải trước hoặc bằng "đến ngày".');
    return {
      type, from, to,
      label: `${from.split('-').reverse().join('/')} – ${to.split('-').reverse().join('/')}`,
    };
  }

  throw new HttpError(400, 'Kiểu lọc phải là day, month hoặc range.');
}

/** GET /api/admin/revenue?period=day|month|range&date=&month=&from=&to=
 *  Gộp doanh thu đơn online đã hoàn thành và hoá đơn bán tại quầy.
 */
router.get('/revenue', (req, res, next) => {
  try {
    const period = resolvePeriod(req.query);
    const range = { from: period.from, to: period.to };

    // Đơn online chỉ tính khi đã hoàn thành — giống quy tắc doanh thu cũ.
    const online = db.prepare(`
      SELECT COUNT(*) c, COALESCE(SUM(total), 0) s
      FROM orders
      WHERE status = 'completed'
        AND ${localDate('created_at')} BETWEEN @from AND @to
    `).get(range);

    const retail = db.prepare(`
      SELECT COUNT(*) c, COALESCE(SUM(total), 0) s, COALESCE(SUM(discount), 0) d
      FROM retail_invoices
      WHERE ${localDate('created_at')} BETWEEN @from AND @to
    `).get(range);

    // Chi tiết theo từng ngày để thấy ngày nào bán được nhiều.
    const daily = db.prepare(`
      SELECT day, SUM(online) online, SUM(retail) retail FROM (
        SELECT ${localDate('created_at')} day, total online, 0 retail
        FROM orders
        WHERE status = 'completed' AND ${localDate('created_at')} BETWEEN @from AND @to
        UNION ALL
        SELECT ${localDate('created_at')} day, 0 online, total retail
        FROM retail_invoices
        WHERE ${localDate('created_at')} BETWEEN @from AND @to
      )
      GROUP BY day ORDER BY day
    `).all(range);

    // Giá vốn được chép vào từng dòng hàng lúc bán, nên đổi giá nhập về sau
    // không làm sai lãi của các đơn cũ.
    const onlineCost = db.prepare(`
      SELECT COALESCE(SUM(i.cost_price * i.quantity), 0) c
      FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.status = 'completed' AND ${localDate('o.created_at')} BETWEEN @from AND @to
    `).get(range).c;
    const retailCost = db.prepare(`
      SELECT COALESCE(SUM(i.cost_price * i.quantity), 0) c
      FROM retail_invoice_items i JOIN retail_invoices v ON v.id = i.invoice_id
      WHERE ${localDate('v.created_at')} BETWEEN @from AND @to
    `).get(range).c;

    const cost = onlineCost + retailCost;
    const revenue = online.s + retail.s;
    // Chỉ có ý nghĩa khi mọi loại gạo đã khai giá nhập.
    const missingCost = db.prepare(
      'SELECT COUNT(*) c FROM products WHERE is_active = 1 AND cost_price <= 0'
    ).get().c;

    res.json({
      period: { ...period },
      online: { revenue: online.s, orders: online.c },
      retail: { revenue: retail.s, invoices: retail.c, discount: retail.d },
      total: { revenue, transactions: online.c + retail.c },
      profit: { cost, gross: revenue - cost, missingCostProducts: missingCost },
      daily: daily.map((d) => ({ ...d, total: d.online + d.retail })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
