import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  LIMITS, RETAIL_DISCOUNT_TIERS, RETAIL_PAYMENT_METHODS, RETAIL_POINTS_PER_REWARD,
  RETAIL_VND_PER_POINT, retailRewardsAffordable,
  localDate, retailDiscountFor, retailPointsFor,
} from '../constants.js';
import { HttpError, cleanText, isPhone, normalizePhone, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import { loyaltyProfile, onlineAccount } from '../loyalty.js';

const router = Router();

// Bán lẻ tại quầy là việc của nhân viên cửa hàng — luôn kiểm tra quyền ở máy chủ.
router.use(requireAuth, requireAdmin);
router.use(validateRoutes('retail'));

const MAX_LINES = 60;
const MAX_QTY_PER_LINE = 500;

/** Mã hoá đơn dễ đọc cho khách tra cứu lại: HD000123 */
const invoiceCode = (id) => `HD${String(id).padStart(6, '0')}`;
const returnCode = (id) => `DT${String(id).padStart(6, '0')}`;

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
      pointsPerReward: RETAIL_POINTS_PER_REWARD,
      rewards: db.prepare(
        'SELECT id, name, unit, image_url FROM products WHERE is_reward = 1 AND is_active = 1 ORDER BY id'
      ).all(),
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
      return res.json({
        customer: null, invoices: [], isNew: true,
        account: onlineAccount(phone), onlineOrders: 0,
        rewardsAffordable: 0, pointsPerReward: RETAIL_POINTS_PER_REWARD,
      });
    }

    const invoices = db
      .prepare('SELECT * FROM retail_invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 20')
      .all(customer.id);
    const account = onlineAccount(phone);
    res.json({
      customer,
      account,
      onlineOrders: account
        ? db.prepare("SELECT COUNT(*) c FROM orders WHERE user_id = ?").get(account.id).c
        : 0,
      rewardsAffordable: retailRewardsAffordable(customer.points),
      pointsPerReward: RETAIL_POINTS_PER_REWARD,
      invoices: invoices.map(withItems),
      isNew: false,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/retail/customers/account — tạo tài khoản đặt hàng online cho khách
 *  Nhân viên đăng ký giúp khách ngay tại quầy. Số điện thoại của tài khoản
 *  chính là số dùng để tích điểm, nên khách mua ở quầy hay đặt online đều
 *  cộng vào cùng một hồ sơ.
 *  body: { phone, full_name, password }
 */
router.post('/customers/account', async (req, res, next) => {
  try {
    const { phone, full_name, password } = req.body || {};

    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new HttpError(400, 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).', {
        phone: 'Số điện thoại không hợp lệ.',
      });
    }
    const fullName = cleanText(full_name, LIMITS.name);
    if (!fullName || fullName.length < 2) {
      throw new HttpError(400, 'Nhập họ tên khách.', { full_name: 'Nhập họ tên khách.' });
    }

    if (db.prepare('SELECT id FROM users WHERE phone = ?').get(normalized)) {
      throw new HttpError(409, 'Số điện thoại này đã có tài khoản đặt hàng.', {
        phone: 'Số này đã có tài khoản.',
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const created = db.transaction(() => {
      const userId = db.prepare(`
        INSERT INTO users (full_name, email, password_hash, phone, address)
        VALUES (?, NULL, ?, ?, NULL)
      `).run(fullName, hash, normalized).lastInsertRowid;

      // Chưa có hồ sơ tích điểm thì tạo luôn để nhân viên thấy ngay.
      if (!db.prepare('SELECT id FROM retail_customers WHERE phone = ?').get(normalized)) {
        db.prepare('INSERT INTO retail_customers (phone, full_name) VALUES (?, ?)')
          .run(normalized, fullName);
      }
      return userId;
    });

    const userId = created();
    writeAdminAudit(req, {
      action: 'create_account', entityType: 'customer_account', entityId: userId,
      after: { phone: normalized, full_name: fullName },
    });

    res.status(201).json({
      account: onlineAccount(normalized),
      customer: loyaltyProfile(normalized),
      message: 'Đã tạo tài khoản. Đọc số điện thoại và mật khẩu cho khách để khách đặt hàng online.',
    });
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

    const before = db.prepare('SELECT * FROM retail_customers WHERE id = ?').get(id);
    const info = db
      .prepare(`UPDATE retail_customers
                SET ${fields.map((f) => `${f} = @${f}`).join(', ')}, updated_at = datetime('now')
                WHERE id = @id`)
      .run({ ...updates, id });
    if (!info.changes) throw new HttpError(404, 'Không tìm thấy khách hàng.');

    const customer = db.prepare('SELECT * FROM retail_customers WHERE id = ?').get(id);
    writeAdminAudit(req, {
      action: 'update', entityType: 'retail_customer', entityId: id, before, after: customer,
    });
    res.json({ customer });
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

/** Gộp danh sách quà đổi điểm. Cho phép bỏ trống. */
function normalizeRewards(rewards) {
  if (rewards == null) return new Map();
  if (!Array.isArray(rewards)) throw new HttpError(400, 'Danh sách quà đổi điểm không hợp lệ.');
  if (rewards.length > MAX_LINES) throw new HttpError(400, `Tối đa ${MAX_LINES} dòng quà.`);

  const merged = new Map();
  for (const line of rewards) {
    const productId = toInteger(line?.product_id, { min: 1 });
    const quantity = toInteger(line?.quantity, { min: 1, max: MAX_QTY_PER_LINE });
    if (!productId) throw new HttpError(400, 'Phần quà không hợp lệ.');
    if (!quantity) throw new HttpError(400, 'Số lượng quà phải lớn hơn 0.');
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  return merged;
}

/** POST /api/retail/invoices
 *  body: { phone?, full_name?, items: [{product_id, quantity}],
 *          rewards?: [{product_id, quantity}], payment_method?, note? }
 *  Giá, giảm giá, điểm tích và điểm trừ đều do máy chủ tự tính.
 */
router.post('/invoices', (req, res, next) => {
  try {
    const { phone, full_name, items, rewards, payment_method, note } = req.body || {};

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

    const wantedRewards = normalizeRewards(rewards);
    // Hoá đơn chỉ gồm quà (khách vào lấy quà, không mua thêm) vẫn hợp lệ.
    const wanted = wantedRewards.size > 0 && (!Array.isArray(items) || items.length === 0)
      ? new Map()
      : normalizeLines(items);

    if (wantedRewards.size > 0 && !customerPhone) {
      throw new HttpError(400, 'Đổi quà cần số điện thoại của khách để trừ điểm.', {
        phone: 'Nhập số điện thoại để đổi quà.',
      });
    }
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

      // Quà đổi điểm: giá tính 0đ nên KHÔNG cộng vào tiền hàng, do đó cũng không
      // giúp khách đạt mốc giảm giá và không sinh thêm điểm.
      const rewardLines = [];
      let rewardCount = 0;
      for (const [productId, quantity] of wantedRewards) {
        const product = getProduct.get(productId);
        if (!product) throw new HttpError(400, `Không tìm thấy phần quà #${productId}.`);
        if (!product.is_reward) {
          throw new HttpError(400, `“${product.name}” không nằm trong danh sách quà đổi điểm.`);
        }
        rewardLines.push({ product, quantity });
        rewardCount += quantity;
      }
      const pointsUsed = rewardCount * RETAIL_POINTS_PER_REWARD;

      const discount = retailDiscountFor(subtotal);
      const total = subtotal - discount;
      const pointsEarned = customerPhone ? retailPointsFor(total) : 0;

      // Khách có số điện thoại thì tạo hoặc cập nhật hồ sơ tích điểm.
      let customerId = null;
      if (customerPhone) {
        const existing = db.prepare('SELECT * FROM retail_customers WHERE phone = ?').get(customerPhone);

        // Kiểm tra đủ điểm NGAY TRONG transaction, dựa trên số điểm đang có
        // trước khi cộng điểm của chính hoá đơn này.
        if (pointsUsed > 0) {
          const available = existing?.points ?? 0;
          if (available < pointsUsed) {
            throw new HttpError(400,
              `Khách chỉ có ${available} điểm, cần ${pointsUsed} điểm để đổi ${rewardCount} phần quà.`);
          }
        }

        if (existing) {
          customerId = existing.id;
          // Trừ có điều kiện: nếu điểm vừa bị dùng ở nơi khác thì không dòng nào
          // đổi và cả hoá đơn bị huỷ, tránh trừ điểm quá số đang có.
          const changed = db.prepare(`
            UPDATE retail_customers
            SET points = points + ? - ?, total_spent = total_spent + ?, visit_count = visit_count + 1,
                full_name = COALESCE(?, full_name), updated_at = datetime('now')
            WHERE id = ? AND points >= ?
          `).run(pointsEarned, pointsUsed, total, customerName, customerId, pointsUsed).changes;
          if (!changed) {
            throw new HttpError(409, 'Điểm của khách vừa thay đổi. Vui lòng tra cứu lại số điện thoại.');
          }
        } else {
          if (pointsUsed > 0) {
            throw new HttpError(400, 'Khách chưa có điểm nào nên chưa đổi quà được.');
          }
          customerId = db.prepare(`
            INSERT INTO retail_customers (phone, full_name, points, total_spent, visit_count)
            VALUES (?, ?, ?, ?, 1)
          `).run(customerPhone, customerName, pointsEarned, total).lastInsertRowid;
        }
      }

      const invoiceId = db.prepare(`
        INSERT INTO retail_invoices
          (customer_id, customer_phone, customer_name, subtotal, discount, total,
           points_earned, points_used, payment_method, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        customerId, customerPhone, customerName, subtotal, discount, total,
        pointsEarned, pointsUsed, paymentMethod, invoiceNote, req.user.id
      ).lastInsertRowid;

      db.prepare('UPDATE retail_invoices SET code = ? WHERE id = ?').run(invoiceCode(invoiceId), invoiceId);

      const insItem = db.prepare(`
        INSERT INTO retail_invoice_items
          (invoice_id, product_id, product_name, unit, price, quantity, cost_price, is_reward)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const { product, quantity } of lines) {
        insItem.run(invoiceId, product.id, product.name, product.unit,
          product.price, quantity, product.cost_price ?? 0, 0);
      }
      // Quà ghi giá 0 nhưng vẫn giữ giá vốn để báo cáo lãi không bị thổi phồng.
      for (const { product, quantity } of rewardLines) {
        insItem.run(invoiceId, product.id, product.name, product.unit,
          0, quantity, product.cost_price ?? 0, 1);
      }
      return invoiceId;
    });

    const invoiceId = create();
    const invoice = withItems(db.prepare('SELECT * FROM retail_invoices WHERE id = ?').get(invoiceId));
    const customer = invoice.customer_id
      ? db.prepare('SELECT * FROM retail_customers WHERE id = ?').get(invoice.customer_id)
      : null;

    writeAdminAudit(req, {
      action: 'create', entityType: 'retail_invoice', entityId: invoice.code,
      after: { code: invoice.code, total: invoice.total, customer_phone: invoice.customer_phone },
    });

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
    // Lọc theo ngày ở Việt Nam, không phải ngày UTC lưu trong cơ sở dữ liệu.
    if (from) { where.push(`${localDate('created_at')} >= @from`); params.from = from; }
    if (to) { where.push(`${localDate('created_at')} <= @to`); params.to = to; }

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
 * Đổi / trả hàng
 * ------------------------------------------------------------------ */

const getReturnItems = db.prepare(
  'SELECT * FROM retail_return_items WHERE return_id = ? ORDER BY id'
);

function withReturnItems(row) {
  return row ? { ...row, items: getReturnItems.all(row.id) } : null;
}

/** GET /api/retail/returns?limit=30 — các phiếu đổi trả gần đây. */
router.get('/returns', (req, res, next) => {
  try {
    const limit = toInteger(req.query.limit, { min: 1, max: 100 }) ?? 30;
    const rows = db.prepare(`
      SELECT r.*, i.code AS invoice_code, i.customer_name, i.customer_phone
      FROM retail_returns r JOIN retail_invoices i ON i.id = r.invoice_id
      ORDER BY r.id DESC LIMIT ?
    `).all(limit);
    res.json({ returns: rows.map(withReturnItems) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/retail/returns
 * body: { invoice_id, return_type, reason, refund_amount?, refund_method?, note?, items }
 */
router.post('/returns', (req, res, next) => {
  try {
    const invoiceId = toInteger(req.body?.invoice_id, { min: 1 });
    const returnType = req.body?.return_type;
    const reason = cleanText(req.body?.reason, LIMITS.note);
    const note = cleanText(req.body?.note, LIMITS.note);
    if (!invoiceId) throw new HttpError(400, 'Chưa chọn hoá đơn cần đổi/trả.');
    if (!['return', 'exchange'].includes(returnType)) {
      throw new HttpError(400, 'Hình thức xử lý phải là đổi hàng hoặc trả hàng.');
    }
    if (!reason || reason.length < 3) {
      throw new HttpError(400, 'Vui lòng nhập lý do đổi/trả.', { reason: 'Nhập lý do đổi/trả.' });
    }

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length || rawItems.length > MAX_LINES) {
      throw new HttpError(400, 'Chọn ít nhất một sản phẩm cần đổi/trả.');
    }

    const wanted = new Map();
    for (const row of rawItems) {
      const itemId = toInteger(row?.invoice_item_id, { min: 1 });
      const quantity = toInteger(row?.quantity, { min: 1, max: MAX_QTY_PER_LINE });
      if (!itemId || !quantity) throw new HttpError(400, 'Sản phẩm hoặc số lượng đổi/trả không hợp lệ.');
      wanted.set(itemId, (wanted.get(itemId) || 0) + quantity);
    }

    const refundMethod = returnType === 'exchange' ? 'none' : (req.body?.refund_method || 'cash');
    if (!['cash', 'transfer', 'none'].includes(refundMethod) || (returnType === 'return' && refundMethod === 'none')) {
      throw new HttpError(400, 'Hình thức hoàn tiền không hợp lệ.');
    }

    const create = db.transaction(() => {
      const invoice = db.prepare('SELECT * FROM retail_invoices WHERE id = ?').get(invoiceId);
      if (!invoice) throw new HttpError(404, 'Không tìm thấy hoá đơn cần đổi/trả.');

      const selected = [];
      let selectedValue = 0;
      for (const [itemId, quantity] of wanted) {
        const item = db.prepare(
          'SELECT * FROM retail_invoice_items WHERE id = ? AND invoice_id = ?'
        ).get(itemId, invoiceId);
        if (!item) throw new HttpError(400, 'Có sản phẩm không thuộc hoá đơn đã chọn.');
        const processed = db.prepare(`
          SELECT COALESCE(SUM(ri.quantity), 0) quantity
          FROM retail_return_items ri
          JOIN retail_returns r ON r.id = ri.return_id
          WHERE r.invoice_id = ? AND ri.invoice_item_id = ?
        `).get(invoiceId, itemId).quantity;
        if (quantity > item.quantity - processed) {
          throw new HttpError(400, `“${item.product_name}” chỉ còn ${item.quantity - processed} ${item.unit} có thể đổi/trả.`);
        }
        selected.push({ item, quantity });
        selectedValue += item.price * quantity;
      }

      let refundAmount = 0;
      if (returnType === 'return') {
        const rawRefund = req.body?.refund_amount;
        refundAmount = rawRefund === '' || rawRefund == null
          ? Math.min(selectedValue, invoice.total)
          : toInteger(rawRefund, { min: 0, max: invoice.total });
        if (refundAmount == null) throw new HttpError(400, 'Số tiền hoàn không hợp lệ.');
        const refunded = db.prepare(
          "SELECT COALESCE(SUM(refund_amount), 0) amount FROM retail_returns WHERE invoice_id = ? AND return_type = 'return'"
        ).get(invoiceId).amount;
        if (refunded + refundAmount > invoice.total) {
          throw new HttpError(400, `Tổng tiền hoàn không được vượt ${invoice.total.toLocaleString('vi-VN')}đ.`);
        }
      }

      const info = db.prepare(`
        INSERT INTO retail_returns
          (invoice_id, return_type, reason, refund_amount, refund_method, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(invoiceId, returnType, reason, refundAmount, refundMethod, note, req.user.id);
      const returnId = info.lastInsertRowid;
      db.prepare('UPDATE retail_returns SET code = ? WHERE id = ?').run(returnCode(returnId), returnId);

      const insertItem = db.prepare(`
        INSERT INTO retail_return_items
          (return_id, invoice_item_id, product_name, unit, price, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const { item, quantity } of selected) {
        insertItem.run(returnId, item.id, item.product_name, item.unit, item.price, quantity);
      }
      return returnId;
    });

    const returnId = create();
    const row = db.prepare(`
      SELECT r.*, i.code AS invoice_code, i.customer_name, i.customer_phone
      FROM retail_returns r JOIN retail_invoices i ON i.id = r.invoice_id
      WHERE r.id = ?
    `).get(returnId);
    const saved = withReturnItems(row);
    writeAdminAudit(req, {
      action: 'create', entityType: 'retail_return', entityId: saved.code,
      after: {
        code: saved.code, invoice_code: saved.invoice_code, return_type: saved.return_type,
        refund_amount: saved.refund_amount, reason: saved.reason,
      },
    });
    res.status(201).json({ return: saved });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Thống kê nhanh cho màn hình bán hàng
 * ------------------------------------------------------------------ */
router.get('/stats', (req, res) => {
  // Cả hai vế đều quy về ngày theo giờ Việt Nam, nếu không thì hoá đơn bán
  // lúc sáng sớm (giờ UTC còn là hôm trước) sẽ bị đếm sai ngày.
  const today = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(total), 0) s, COALESCE(SUM(discount), 0) d
    FROM retail_invoices
    WHERE ${localDate('created_at')} = ${localDate("'now'")}
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
