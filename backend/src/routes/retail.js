import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  LIMITS, RETAIL_DISCOUNT_TIERS, RETAIL_PAYMENT_METHODS, RETAIL_VND_PER_POINT,
  retailDiscountFor, retailPointsFor,
} from '../constants.js';
import { HttpError, cleanText, isPhone, normalizePhone, toInteger } from '../validate.js';

const router = Router();

// Bán lẻ tại quầy là việc của nhân viên cửa hàng — luôn kiểm tra quyền ở máy chủ.
router.use(requireAuth, requireAdmin);

const MAX_LINES = 60;
const MAX_QTY_PER_LINE = 500;

/** Mã hoá đơn dễ đọc cho khách tra cứu lại: HD000123 */
const invoiceCode = (id) => `HD${String(id).padStart(6, '0')}`;

const getItems = db.prepare(
  'SELECT * FROM retail_invoice_items WHERE invoice_id = ? ORDER BY id'
);

function withItems(invoice) {
  if (!invoice) return null;
  return { ...invoice, items: getItems.all(invoice.id) };
}

/* ------------------------------------------------------------------ *
 * Chính sách đang áp dụng — để giao diện hiển thị đúng, không tự đoán
 * ------------------------------------------------------------------ */
router.get('/policy', (req, res) => {
  res.json({
    policy: {
      tiers: RETAIL_DISCOUNT_TIERS,
      vndPerPoint: RETAIL_VND_PER_POINT,
      paymentMethods: RETAIL_PAYMENT_METHODS,
    },
  });
});

/* ------------------------------------------------------------------ *
 * Tra cứu khách theo số điện thoại
 * ------------------------------------------------------------------ */

/** GET /api/retail/customers?phone=0912345678 */
router.get('/customers', (req, res, next) => {
  try {
    const phone = normalizePhone(req.query.phone);
    if (!phone) {
      throw new HttpError(400, 'Nhập số điện thoại hợp lệ (10 số, ví dụ 0912345678).', {
        phone: 'Số điện thoại không hợp lệ.',
      });
    }

    const customer = db.prepare('SELECT * FROM retail_customers WHERE phone = ?').get(phone);
    if (!customer) {
      // Chưa từng mua — vẫn trả 200 để nhân viên biết là khách mới, không phải lỗi.
      return res.json({ customer: null, invoices: [], isNew: true });
    }

    const invoices = db
      .prepare('SELECT * FROM retail_invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 20')
      .all(customer.id);
    res.json({ customer, invoices: invoices.map(withItems), isNew: false });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/retail/customers/:id — sửa tên / ghi chú của khách quen */
router.put('/customers/:id', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id) throw new HttpError(404, 'Không tìm thấy khách hàng.');

    const updates = {};
    if (req.body?.full_name !== undefined) {
      updates.full_name = cleanText(req.body.full_name, LIMITS.name);
    }
    if (req.body?.note !== undefined) {
      updates.note = cleanText(req.body.note, LIMITS.note);
    }
    const fields = Object.keys(updates);
    if (!fields.length) throw new HttpError(400, 'Không có thông tin nào để cập nhật.');

    const info = db
      .prepare(`UPDATE retail_customers
                SET ${fields.map((f) => `${f} = @${f}`).join(', ')}, updated_at = datetime('now')
                WHERE id = @id`)
      .run({ ...updates, id });
    if (!info.changes) throw new HttpError(404, 'Không tìm thấy khách hàng.');

    res.json({ customer: db.prepare('SELECT * FROM retail_customers WHERE id = ?').get(id) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Tạo hoá đơn bán tại quầy
 * ------------------------------------------------------------------ */

/** Gộp dòng trùng và kiểm tra số lượng. */
function normalizeLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Hoá đơn chưa có sản phẩm nào.', { items: 'Chưa chọn sản phẩm.' });
  }
  if (items.length > MAX_LINES) {
    throw new HttpError(400, `Một hoá đơn tối đa ${MAX_LINES} dòng.`);
  }

  const merged = new Map();
  for (const line of items) {
    const productId = toInteger(line?.product_id, { min: 1 });
    const quantity = toInteger(line?.quantity, { min: 1, max: MAX_QTY_PER_LINE });
    if (!productId) throw new HttpError(400, 'Sản phẩm trong hoá đơn không hợp lệ.');
    if (!quantity) {
      throw new HttpError(400, `Số lượng mỗi dòng phải từ 1 đến ${MAX_QTY_PER_LINE}.`);
    }
    const total = (merged.get(productId) || 0) + quantity;
    if (total > MAX_QTY_PER_LINE) {
      throw new HttpError(400, `Số lượng mỗi loại tối đa ${MAX_QTY_PER_LINE}.`);
    }
    merged.set(productId, total);
  }
  return merged;
}

/** POST /api/retail/invoices
 *  body: { phone?, full_name?, items: [{product_id, quantity}], payment_method?, note? }
 *  Giá, giảm giá và điểm đều do máy chủ tự tính.
 */
router.post('/invoices', (req, res, next) => {
  try {
    const { phone, full_name, items, payment_method, note } = req.body || {};

    // Khách vãng lai không cần số điện thoại; có số thì mới tích được điểm.
    const rawPhone = cleanText(phone, LIMITS.phone);
    if (rawPhone && !isPhone(rawPhone)) {
      throw new HttpError(400, 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).', {
        phone: 'Số điện thoại không hợp lệ.',
      });
    }
    const customerPhone = rawPhone ? normalizePhone(rawPhone) : null;
    const customerName = cleanText(full_name, LIMITS.name);

    const paymentMethod = payment_method || 'cash';
    if (!Object.keys(RETAIL_PAYMENT_METHODS).includes(paymentMethod)) {
      throw new HttpError(400, 'Hình thức thanh toán không hợp lệ.');
    }

    const wanted = normalizeLines(items);
    const invoiceNote = cleanText(note, LIMITS.note);

    // Bán tại quầy KHÔNG trừ tồn kho của cửa hàng online (theo yêu cầu của cửa hàng),
    // nên ở đây chỉ đọc giá hiện tại chứ không đụng vào cột stock.
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');

    const create = db.transaction(() => {
      const lines = [];
      let subtotal = 0;

      for (const [productId, quantity] of wanted) {
        const product = getProduct.get(productId);
        if (!product) throw new HttpError(400, `Không tìm thấy sản phẩm #${productId}.`);
        if (product.price <= 0) {
          throw new HttpError(400, `“${product.name}” chưa có giá bán. Hãy nhập giá trước khi bán.`);
        }
        lines.push({ product, quantity });
        subtotal += product.price * quantity;
      }

      const discount = retailDiscountFor(subtotal);
      const total = subtotal - discount;
      const pointsEarned = customerPhone ? retailPointsFor(total) : 0;

      // Khách có số điện thoại thì tạo hoặc cập nhật hồ sơ tích điểm.
      let customerId = null;
      if (customerPhone) {
        const existing = db.prepare('SELECT * FROM retail_customers WHERE phone = ?').get(customerPhone);
        if (existing) {
          customerId = existing.id;
          db.prepare(`
            UPDATE retail_customers
            SET points = points + ?, total_spent = total_spent + ?, visit_count = visit_count + 1,
                full_name = COALESCE(?, full_name), updated_at = datetime('now')
            WHERE id = ?
          `).run(pointsEarned, total, customerName, customerId);
        } else {
          customerId = db.prepare(`
            INSERT INTO retail_customers (phone, full_name, points, total_spent, visit_count)
            VALUES (?, ?, ?, ?, 1)
          `).run(customerPhone, customerName, pointsEarned, total).lastInsertRowid;
        }
      }

      const invoiceId = db.prepare(`
        INSERT INTO retail_invoices
          (customer_id, customer_phone, customer_name, subtotal, discount, total,
           points_earned, payment_method, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        customerId, customerPhone, customerName, subtotal, discount, total,
        pointsEarned, paymentMethod, invoiceNote, req.user.id
      ).lastInsertRowid;

      db.prepare('UPDATE retail_invoices SET code = ? WHERE id = ?').run(invoiceCode(invoiceId), invoiceId);

      const insItem = db.prepare(`
        INSERT INTO retail_invoice_items (invoice_id, product_id, product_name, unit, price, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const { product, quantity } of lines) {
        insItem.run(invoiceId, product.id, product.name, product.unit, product.price, quantity);
      }
      return invoiceId;
    });

    const invoiceId = create();
    const invoice = withItems(db.prepare('SELECT * FROM retail_invoices WHERE id = ?').get(invoiceId));
    const customer = invoice.customer_id
      ? db.prepare('SELECT * FROM retail_customers WHERE id = ?').get(invoice.customer_id)
      : null;

    res.status(201).json({ invoice, customer });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Tra cứu hoá đơn cũ
 * ------------------------------------------------------------------ */

/** GET /api/retail/invoices?q=&from=&to=&limit=&offset=
 *  q: mã hoá đơn, số điện thoại hoặc tên khách.
 */
router.get('/invoices', (req, res, next) => {
  try {
    const limit = toInteger(req.query.limit, { min: 1, max: 100 }) ?? 20;
    const offset = toInteger(req.query.offset, { min: 0, max: 100_000 }) ?? 0;
    const q = cleanText(req.query.q, 60);
    const from = cleanText(req.query.from, 10);   // YYYY-MM-DD
    const to = cleanText(req.query.to, 10);

    const isDate = (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDate(from) || !isDate(to)) {
      throw new HttpError(400, 'Ngày lọc phải theo dạng YYYY-MM-DD.');
    }

    const where = [];
    const params = {};
    if (q) {
      // Cho phép gõ "HD12", "12", số điện thoại hoặc tên khách.
      const digits = q.replace(/\D/g, '');
      const phone = normalizePhone(q);
      where.push(`(
        code = @codeExact
        OR code LIKE @like ESCAPE '\\'
        OR (@phone <> '' AND customer_phone = @phone)
        OR (@digits <> '' AND customer_phone LIKE @digitsLike ESCAPE '\\')
        OR IFNULL(customer_name, '') LIKE @like ESCAPE '\\'
      )`);
      const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      params.codeExact = digits ? invoiceCode(Number(digits)) : q.toUpperCase();
      params.like = `%${escaped}%`;
      params.phone = phone || '';
      params.digits = digits;
      params.digitsLike = `%${digits.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    }
    if (from) { where.push('date(created_at) >= date(@from)'); params.from = from; }
    if (to) { where.push('date(created_at) <= date(@to)'); params.to = to; }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM retail_invoices ${clause}`).get(params).c;
    const invoices = db
      .prepare(`SELECT * FROM retail_invoices ${clause} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });

    res.json({ invoices: invoices.map(withItems), total, limit, offset });
  } catch (err) {
    next(err);
  }
});

/** GET /api/retail/invoices/:id — xem lại một hoá đơn (nhận id hoặc mã HD000123) */
router.get('/invoices/:id', (req, res, next) => {
  try {
    const raw = String(req.params.id || '');
    const id = toInteger(raw.replace(/^HD/i, ''), { min: 1 });
    if (!id) throw new HttpError(404, 'Không tìm thấy hoá đơn.');

    const invoice = db.prepare('SELECT * FROM retail_invoices WHERE id = ?').get(id);
    if (!invoice) throw new HttpError(404, 'Không tìm thấy hoá đơn.');

    const customer = invoice.customer_id
      ? db.prepare('SELECT * FROM retail_customers WHERE id = ?').get(invoice.customer_id)
      : null;
    res.json({ invoice: withItems(invoice), customer });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Thống kê nhanh cho màn hình bán hàng
 * ------------------------------------------------------------------ */
router.get('/stats', (req, res) => {
  const today = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(total), 0) s, COALESCE(SUM(discount), 0) d
    FROM retail_invoices WHERE date(created_at) = date('now', 'localtime')
  `).get();

  res.json({
    stats: {
      todayInvoices: today.c,
      todayRevenue: today.s,
      todayDiscount: today.d,
      customers: db.prepare('SELECT COUNT(*) c FROM retail_customers').get().c,
      invoices: db.prepare('SELECT COUNT(*) c FROM retail_invoices').get().c,
    },
  });
});

export default router;
