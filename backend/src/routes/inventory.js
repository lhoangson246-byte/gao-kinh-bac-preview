import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requireStaff } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText, toInteger } from '../validate.js';
import { LIMITS, PRODUCT_CATEGORY_CODES, localDate } from '../constants.js';
import { writeAdminAudit } from '../audit.js';
import {
  LOW_STOCK_AT, MAIN, MOVEMENT_GROUPS, MOVEMENT_KINDS, STORE, WAREHOUSES, inTransitByProduct, isWarehouse,
  moveStock, receiptCode, roundQty, stockColumn, stockStatus, toQty, transferCode, warehouseName,
} from '../inventory.js';

/**
 * /api/admin/inventory — hai kho: Cửa hàng Nguyễn Cao và Kho Bồ Sơn (13/11/2026).
 * Bảng tồn theo từng kho, phiếu nhập kho, lệnh điều chuyển (xuất kho đi → xác nhận nhận ở kho đến),
 * kiểm kê / tồn đầu kỳ và nhật ký kho. Quyền kiểm tra ở máy chủ cho từng việc.
 */
const router = Router();
router.use(requireAuth, requireStaff, validateRoutes('inventory'));

const INVENTORY_PERMISSIONS = ['inventory.view', 'inventory.receive', 'inventory.transfer', 'inventory.count'];
const allow = (...permissions) => (req, res, next) => (permissions.some((p) => can(req.user, p))
  ? next()
  : res.status(403).json({ message: 'Tài khoản của bạn chưa được cấp quyền này. Vui lòng hỏi chủ cửa hàng.' }));
// Có bất kỳ quyền kho nào thì xem được bảng tồn và nhật ký kho.
const view = allow(...INVENTORY_PERMISSIONS);

const MAX_QTY = 100_000;
const RECEIPT_KINDS = { 'cong-gao': 'Nhập công gạo', 'cua-hang': 'Nhập hàng cửa hàng' };
const TRANSFER_STATUSES = ['in_transit', 'received', 'cancelled'];
const actorOf = (req) => ({ id: req.user.id, full_name: req.user.full_name });
const blank = (value) => value === '' || value == null;

/** Bảng tồn kho của mọi sản phẩm và tổng theo từng kho. */
function overview() {
  const moving = inTransitByProduct();
  const totals = Object.fromEntries([STORE, MAIN, 'all'].map((code) => [code, { kg: 0, units: 0, other_units: 0 }]));
  const addTotal = (code, quantity, weight) => {
    for (const key of [code, 'all']) {
      totals[key].units += quantity;
      if (weight > 0) totals[key].kg += quantity * weight; else totals[key].other_units += quantity;
    }
  };
  // Thứ tự riêng của bảng tồn (stock_sort, kéo thả ở trang Kho); chưa xếp thì theo thứ tự trên web.
  const products = db.prepare(`
    SELECT id, sku, name, unit, weight_kg, is_active, stock, stock_bs, online_warehouse FROM products
    ORDER BY stock_sort IS NULL, stock_sort, sort_order, id
  `).all().map((p) => {
    const transit = moving.get(p.id);
    const row = {
      id: p.id, sku: p.sku || null, name: p.name, unit: p.unit, weight_kg: p.weight_kg || 0, is_active: p.is_active,
      stock_nc: p.stock, stock_bs: p.stock_bs, total: p.stock + p.stock_bs, online: p.online_warehouse === STORE ? STORE : MAIN,
      moving_to_nc: transit?.[STORE] || 0, moving_to_bs: transit?.[MAIN] || 0,
    };
    addTotal(STORE, row.stock_nc, row.weight_kg);
    addTotal(MAIN, row.stock_bs, row.weight_kg);
    return { ...row, status: stockStatus(row) };
  });
  for (const total of Object.values(totals)) {
    total.kg = Math.round(total.kg * 100) / 100;
    total.units = roundQty(total.units);
    total.other_units = roundQty(total.other_units);
  }
  const inTransit = db.prepare("SELECT COUNT(*) AS n FROM stock_transfers WHERE status = 'in_transit'").get().n;
  return { warehouses: WAREHOUSES, low_stock_at: LOW_STOCK_AT, products, totals, in_transit: inTransit };
}

function withItems(rows, table, key, { hideCost = false } = {}) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const items = db.prepare(`SELECT * FROM ${table} WHERE ${key} IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
  return rows.map((row) => ({
    ...row,
    items: items.filter((i) => i[key] === row.id).map((item) => {
      const copy = { ...item };
      if (hideCost) delete copy.cost_price;
      return copy;
    }),
  }));
}
const receiptsList = (req, where = '', args = [], limit = 30) => withItems(
  db.prepare(`SELECT * FROM stock_receipts ${where} ORDER BY id DESC LIMIT ?`).all(...args, limit),
  'stock_receipt_items', 'receipt_id', { hideCost: !can(req.user, 'products.manage') },
);
const transfersList = (where = '', args = [], limit = 50) => withItems(
  db.prepare(`SELECT * FROM stock_transfers ${where} ORDER BY (status = 'in_transit') DESC, id DESC LIMIT ?`).all(...args, limit),
  'stock_transfer_items', 'transfer_id',
);

/** GET /api/admin/inventory — bảng tồn hai kho, tổng theo kho và các lệnh chuyển đang trên đường. */
router.get('/', view, (req, res) => {
  res.json({ ...overview(), transfers: transfersList("WHERE status = 'in_transit'") });
});

/**
 * PUT /api/admin/inventory/products/:id/online { warehouse } — kho bán online của một sản phẩm (19/11/2026).
 * Chuyển hàng sang Cửa hàng Nguyễn Cao mà vẫn muốn khách mua trên web thì chọn KH_NC: web hiện tồn cửa hàng
 * và đơn web trừ ở cửa hàng. Không đổi số tồn nào.
 */
router.put('/products/:id/online', allow('inventory.transfer', 'products.manage'), (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    const { warehouse } = req.body;
    if (!productId || !isWarehouse(warehouse)) throw new HttpError(400, 'Chọn kho bán online.');
    const before = db.prepare('SELECT id, name, online_warehouse FROM products WHERE id = ?').get(productId);
    if (!before) throw new HttpError(404, 'Không tìm thấy sản phẩm.');
    db.prepare('UPDATE products SET online_warehouse = ? WHERE id = ?').run(warehouse, productId);
    writeAdminAudit(req, {
      action: 'online_warehouse', entityType: 'product', entityId: productId,
      before: { online_warehouse: before.online_warehouse }, after: { online_warehouse: warehouse },
    });
    res.json({ ...overview(), transfers: transfersList("WHERE status = 'in_transit'"),
      message: `“${before.name}” giờ bán trên web từ ${warehouseName(warehouse)}.` });
  } catch (err) { next(err); }
});

/** PUT /api/admin/inventory/order { ids } — thứ tự dòng trong bảng tồn kho (kéo thả, 19/11/2026). */
router.put('/order', allow('inventory.receive', 'inventory.transfer', 'inventory.count', 'products.manage'), (req, res, next) => {
  try {
    const ids = [...new Set((req.body.ids || []).map((v) => toInteger(v, { min: 1 })).filter(Boolean))];
    if (!ids.length) throw new HttpError(400, 'Danh sách sản phẩm trống.');
    db.transaction(() => {
      const set = db.prepare('UPDATE products SET stock_sort = ? WHERE id = ?');
      ids.forEach((id, index) => set.run(index + 1, id));
    })();
    res.json({ ...overview(), transfers: transfersList("WHERE status = 'in_transit'") });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/inventory/products — kế toán / người nhập kho thêm MẶT HÀNG MỚI ngay trong phiếu nhập (24/11/2026),
 * khi hàng về mà chưa có trên web. Mặt hàng được tạo ở trạng thái ẨN trên web, giá bán 0đ; chủ cửa hàng vào trang
 * Sản phẩm đặt giá, ảnh rồi bật hiện khi muốn bán online. Tồn kho cộng bằng chính phiếu nhập.
 * body: { name, unit, weight_kg?, category?, sku? }
 */
router.post('/products', allow('inventory.receive', 'products.manage'), (req, res, next) => {
  try {
    const name = cleanText(req.body.name, LIMITS.name);
    const unit = cleanText(req.body.unit, 40);
    const weight = req.body.weight_kg == null || req.body.weight_kg === '' ? 0 : Number(String(req.body.weight_kg).replace(',', '.'));
    const category = PRODUCT_CATEGORY_CODES.includes(req.body.category) ? req.body.category : 'gao';
    const sku = cleanText(req.body.sku, 20);
    const errors = {};
    if (!name || name.length < 2) errors.name = 'Nhập tên mặt hàng.';
    if (!unit) errors.unit = 'Nhập quy cách (ví dụ bao 25kg, túi 5kg, kg, gói).';
    if (!Number.isFinite(weight) || weight < 0 || weight > 1000) errors.weight_kg = 'Khối lượng một đơn vị từ 0 đến 1000 kg.';
    if (Object.keys(errors).length) throw new HttpError(400, 'Thông tin mặt hàng chưa đủ.', errors);
    if (db.prepare('SELECT 1 FROM products WHERE LOWER(name) = LOWER(?) AND LOWER(unit) = LOWER(?)').get(name, unit)) {
      throw new HttpError(409, `Đã có mặt hàng “${name}” (${unit}). Chọn trong danh sách thay vì thêm mới.`, { name: 'Mặt hàng này đã có.' });
    }
    if (sku && db.prepare('SELECT 1 FROM products WHERE LOWER(sku) = LOWER(?)').get(sku)) {
      throw new HttpError(400, 'Mã sản phẩm này đã dùng cho loại hàng khác.', { sku: 'Mã này đã dùng.' });
    }
    const id = db.prepare(`
      INSERT INTO products (name, price, cost_price, unit, weight_kg, stock, stock_bs, is_active, category, sku, sort_order)
      VALUES (?, 0, 0, ?, ?, 0, 0, 0, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products))
    `).run(name, unit, Math.round(weight * 1000) / 1000, category, sku || null).lastInsertRowid;
    writeAdminAudit(req, { action: 'create', entityType: 'product', entityId: id, after: { name, unit, weight_kg: weight, category, sku, is_active: 0, via: 'phiếu nhập kho' } });
    res.status(201).json({ ...overview(), product_id: id, message: `Đã thêm mặt hàng mới “${name}” (${unit}) — đang ẩn trên web, chủ cửa hàng đặt giá ở trang Sản phẩm khi muốn bán online.` });
  } catch (err) { next(err); }
});

/** GET /api/admin/inventory/stock — tồn từng kho của hàng đang bán, cho form tạo đơn chọn kho xuất. */
router.get('/stock', allow('orders.create', ...INVENTORY_PERMISSIONS), (req, res) => {
  res.json({
    warehouses: WAREHOUSES,
    products: db.prepare('SELECT id, stock AS stock_nc, stock_bs FROM products WHERE is_active = 1').all(),
  });
});

/** GET /api/admin/inventory/movements — nhật ký kho: ai làm gì, ở kho nào, bao nhiêu, tồn sau đó. */
router.get('/movements', view, (req, res, next) => {
  try {
    const where = [];
    const args = [];
    const productId = toInteger(req.query.product_id, { min: 1 });
    if (productId) { where.push('m.product_id = ?'); args.push(productId); }
    if (req.query.warehouse) { where.push('m.warehouse = ?'); args.push(req.query.warehouse); }
    const kinds = MOVEMENT_GROUPS[req.query.group];
    if (kinds) { where.push(`m.kind IN (${kinds.map(() => '?').join(',')})`); args.push(...kinds); }
    const from = req.query.from || null;
    const to = req.query.to || from;
    if (from && to) {
      if (from > to) throw new HttpError(400, '"Từ ngày" phải trước hoặc bằng "đến ngày".');
      where.push(`${localDate('m.created_at')} BETWEEN ? AND ?`);
      args.push(from, to);
    }
    const limit = toInteger(req.query.limit, { min: 1, max: 100 }) ?? 40;
    const offset = toInteger(req.query.offset, { min: 0, max: 100000 }) ?? 0;
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements m ${clause}`).get(...args).n;
    const rows = db.prepare(`
      SELECT m.id, m.created_at, m.product_id, m.product_name, m.unit, m.warehouse, m.kind, m.quantity,
             m.balance_after, m.ref_type, m.ref_code, m.note, COALESCE(m.actor_name, u.full_name) AS actor_name
      FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
      ${clause} ORDER BY m.id DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset);
    res.json({
      movements: rows.map((m) => ({ ...m, kind_label: MOVEMENT_KINDS[m.kind] || m.kind, warehouse_name: warehouseName(m.warehouse) })),
      total, limit, offset,
    });
  } catch (err) { next(err); }
});

/** GET /api/admin/inventory/receipts — các phiếu nhập gần đây. */
router.get('/receipts', view, (req, res) => {
  res.json({ receipts: receiptsList(req) });
});

/**
 * POST /api/admin/inventory/receipts — phiếu nhập kho, nhiều loại gạo một lần. Mỗi dòng ghi số nhập vào
 * Kho Bồ Sơn và số giao thẳng Cửa hàng Nguyễn Cao (một công gạo chia hai nơi trên cùng phiếu).
 * body: { kind: 'cong-gao' | 'cua-hang', source?, vehicle?, note?,
 *         items: [{ product_id, quantity_bs?, quantity_nc?, cost_price? }] }
 */
router.post('/receipts', allow('inventory.receive'), (req, res, next) => {
  try {
    const body = req.body;
    const kind = Object.hasOwn(RECEIPT_KINDS, body.kind) ? body.kind : null;
    if (!kind) throw new HttpError(400, 'Chọn loại phiếu nhập.', { kind: 'Chọn loại phiếu nhập.' });
    const source = cleanText(body.source, 120);
    const vehicle = cleanText(body.vehicle, 80);
    const note = cleanText(body.note, LIMITS.note);
    const canCost = can(req.user, 'products.manage');

    const wanted = new Map();
    for (const row of Array.isArray(body.items) ? body.items : []) {
      const productId = toInteger(row?.product_id, { min: 1 });
      const bs = blank(row?.quantity_bs) ? 0 : toQty(row.quantity_bs, { min: 0, max: MAX_QTY });
      const nc = blank(row?.quantity_nc) ? 0 : toQty(row.quantity_nc, { min: 0, max: MAX_QTY });
      if (!productId || bs == null || nc == null) throw new HttpError(400, `Số lượng nhập phải là số từ 0 đến ${MAX_QTY} (được lẻ, ví dụ 58,2).`, { items: 'Số lượng nhập chưa hợp lệ.' });
      if (bs + nc === 0) continue;
      const cost = blank(row?.cost_price) ? null : toInteger(row.cost_price, { min: 0, max: LIMITS.price });
      if (!blank(row?.cost_price) && cost == null) throw new HttpError(400, 'Giá nhập không hợp lệ.', { items: 'Giá nhập không hợp lệ.' });
      if (cost != null && !canCost) throw new HttpError(403, 'Tài khoản của bạn không được ghi giá nhập. Bỏ trống ô giá nhập.');
      const line = wanted.get(productId) || { [MAIN]: 0, [STORE]: 0, cost: null };
      line[MAIN] = roundQty(line[MAIN] + bs);
      line[STORE] = roundQty(line[STORE] + nc);
      if (cost != null) line.cost = cost;
      wanted.set(productId, line);
    }
    if (!wanted.size) throw new HttpError(400, 'Nhập số lượng cho ít nhất một loại hàng.', { items: 'Nhập số lượng cho ít nhất một loại hàng.' });

    const actor = actorOf(req);
    const receiptId = db.transaction(() => {
      const id = db.prepare(`
        INSERT INTO stock_receipts (kind, source, vehicle, note, created_by, actor_name) VALUES (?, ?, ?, ?, ?, ?)
      `).run(kind, source, vehicle, note, actor.id, actor.full_name).lastInsertRowid;
      const code = receiptCode(id);
      db.prepare('UPDATE stock_receipts SET code = ? WHERE id = ?').run(code, id);
      const getProduct = db.prepare('SELECT id, name, unit, stock, stock_bs FROM products WHERE id = ?');
      const insItem = db.prepare(`
        INSERT INTO stock_receipt_items (receipt_id, product_id, product_name, unit, warehouse, quantity, cost_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const detail = [RECEIPT_KINDS[kind], source, vehicle && `xe ${vehicle}`].filter(Boolean).join(' · ');
      for (const [productId, line] of wanted) {
        const product = getProduct.get(productId);
        if (!product) throw new HttpError(400, 'Có loại hàng không còn trong danh sách. Vui lòng tải lại trang.');
        for (const warehouse of [MAIN, STORE]) {
          const quantity = line[warehouse];
          if (!quantity) continue;
          if (product[stockColumn(warehouse)] + quantity > LIMITS.stock) {
            throw new HttpError(400, `“${product.name}”: tồn kho vượt giới hạn cho phép.`);
          }
          insItem.run(id, product.id, product.name, product.unit, warehouse, quantity, line.cost);
          moveStock({ productId, warehouse, delta: quantity, kind: 'receipt', ref: { type: 'receipt', id, code }, note: detail, actor });
        }
        // Khai giá nhập trên phiếu thì cập nhật luôn giá nhập của sản phẩm (như nút Nhập kho cũ).
        if (line.cost != null) db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(line.cost, productId);
      }
      return id;
    })();

    const [receipt] = receiptsList(req, 'WHERE id = ?', [receiptId], 1);
    writeAdminAudit(req, {
      action: 'receive_stock', entityType: 'stock_receipt', entityId: receipt.code,
      after: { code: receipt.code, kind, source, vehicle, items: receipt.items.map((i) => ({ product: i.product_name, warehouse: i.warehouse, quantity: i.quantity })) },
    });
    res.status(201).json({ receipt, ...overview(), message: `Đã lưu phiếu nhập ${receipt.code}.` });
  } catch (err) { next(err); }
});

/** GET /api/admin/inventory/transfers?status= — lệnh điều chuyển (đang chuyển xếp trước). */
router.get('/transfers', view, (req, res) => {
  const status = TRANSFER_STATUSES.includes(req.query.status) ? req.query.status : null;
  res.json({ transfers: status ? transfersList('WHERE status = ?', [status]) : transfersList() });
});

/**
 * POST /api/admin/inventory/transfers — tạo lệnh chuyển. Kho xuất bị trừ NGAY (hàng đã lên xe); kho nhận
 * chỉ được cộng khi nhân viên bên nhận đếm đủ và bấm xác nhận.
 * body: { from, to, note?, items: [{ product_id, quantity }] }
 */
router.post('/transfers', allow('inventory.transfer'), (req, res, next) => {
  try {
    const { from, to } = req.body;
    if (!isWarehouse(from) || !isWarehouse(to) || from === to) {
      throw new HttpError(400, 'Chọn kho xuất và kho nhận khác nhau.', { from: 'Chọn chiều chuyển.' });
    }
    const note = cleanText(req.body.note, LIMITS.note);
    const wanted = new Map();
    for (const row of Array.isArray(req.body.items) ? req.body.items : []) {
      const productId = toInteger(row?.product_id, { min: 1 });
      const quantity = toQty(row?.quantity, { min: 0.001, max: MAX_QTY });
      if (!productId || !quantity) throw new HttpError(400, 'Số lượng chuyển phải lớn hơn 0 (được lẻ, ví dụ 12,5).', { items: 'Số lượng chuyển chưa hợp lệ.' });
      wanted.set(productId, roundQty((wanted.get(productId) || 0) + quantity));
    }
    if (!wanted.size) throw new HttpError(400, 'Chọn ít nhất một loại hàng để chuyển.', { items: 'Chọn ít nhất một loại hàng để chuyển.' });

    const actor = actorOf(req);
    const transferId = db.transaction(() => {
      const id = db.prepare(`
        INSERT INTO stock_transfers (from_warehouse, to_warehouse, note, created_by, actor_name) VALUES (?, ?, ?, ?, ?)
      `).run(from, to, note, actor.id, actor.full_name).lastInsertRowid;
      const code = transferCode(id);
      db.prepare('UPDATE stock_transfers SET code = ? WHERE id = ?').run(code, id);
      const column = stockColumn(from);
      const getProduct = db.prepare(`SELECT id, name, unit, ${column} AS available FROM products WHERE id = ?`);
      const insItem = db.prepare(`
        INSERT INTO stock_transfer_items (transfer_id, product_id, product_name, unit, quantity) VALUES (?, ?, ?, ?, ?)
      `);
      for (const [productId, quantity] of wanted) {
        const product = getProduct.get(productId);
        if (!product) throw new HttpError(400, 'Có loại hàng không còn trong danh sách. Vui lòng tải lại trang.');
        const short = `“${product.name}” ở ${warehouseName(from)} chỉ còn ${Math.max(product.available, 0)} ${product.unit}.`;
        if (product.available < quantity) throw new HttpError(400, short, { items: short });
        const moved = moveStock({
          productId, warehouse: from, delta: -quantity, kind: 'transfer_out', ref: { type: 'transfer', id, code },
          note: `Chuyển sang ${warehouseName(to)}`, actor,
        });
        if (!moved) throw new HttpError(409, short, { items: short });
        insItem.run(id, product.id, product.name, product.unit, quantity);
      }
      return id;
    })();

    const [transfer] = transfersList('WHERE id = ?', [transferId], 1);
    writeAdminAudit(req, {
      action: 'create', entityType: 'stock_transfer', entityId: transfer.code,
      after: { code: transfer.code, from, to, items: transfer.items.map((i) => ({ product: i.product_name, quantity: i.quantity })) },
    });
    res.status(201).json({
      transfer, ...overview(), transfers: transfersList("WHERE status = 'in_transit'"),
      message: `Đã tạo lệnh chuyển ${transfer.code}. ${warehouseName(to)} bấm xác nhận khi nhận đủ hàng.`,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/inventory/transfers/:id/receive — bên nhận đếm hàng và xác nhận. Kho nhận được cộng
 * đúng số thực nhận; nhận thiếu thì phần thiếu ghi lại trên lệnh chuyển (không cộng vào kho nào).
 * Lệnh chỉ xác nhận được MỘT lần (khoá bằng trạng thái).
 * body: { note?, items?: [{ item_id, received }] } — bỏ items = nhận đủ.
 */
router.post('/transfers/:id/receive', allow('inventory.transfer'), (req, res, next) => {
  try {
    const transferId = toInteger(req.params.id, { min: 1 });
    if (!transferId) throw new HttpError(404, 'Không tìm thấy lệnh chuyển.');
    const note = cleanText(req.body.note, LIMITS.note);
    const counted = new Map();
    for (const row of Array.isArray(req.body.items) ? req.body.items : []) {
      const itemId = toInteger(row?.item_id, { min: 1 });
      const received = toQty(row?.received, { min: 0, max: MAX_QTY });
      if (!itemId || received == null) throw new HttpError(400, 'Số thực nhận phải là số từ 0 trở lên.');
      counted.set(itemId, received);
    }
    const actor = actorOf(req);
    db.transaction(() => {
      const transfer = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(transferId);
      if (!transfer) throw new HttpError(404, 'Không tìm thấy lệnh chuyển.');
      const locked = db.prepare(`
        UPDATE stock_transfers SET status = 'received', received_by = ?, receiver_name = ?, received_at = datetime('now'),
          receive_note = ? WHERE id = ? AND status = 'in_transit'
      `).run(actor.id, actor.full_name, note, transferId).changes;
      if (!locked) throw new HttpError(409, 'Lệnh chuyển này đã được xác nhận hoặc đã huỷ. Vui lòng tải lại trang.');
      const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ? ORDER BY id').all(transferId);
      const setReceived = db.prepare('UPDATE stock_transfer_items SET received_quantity = ? WHERE id = ?');
      for (const item of items) {
        const received = counted.has(item.id) ? counted.get(item.id) : item.quantity;
        if (received > item.quantity) {
          throw new HttpError(400, `“${item.product_name}”: số thực nhận (${received}) lớn hơn số đã chuyển (${item.quantity}).`);
        }
        setReceived.run(received, item.id);
        if (!item.product_id) continue;        // sản phẩm đã bị xoá hẳn
        const missing = roundQty(item.quantity - received);
        moveStock({
          productId: item.product_id, warehouse: transfer.to_warehouse, delta: received, kind: 'transfer_in',
          ref: { type: 'transfer', id: transferId, code: transfer.code },
          note: missing > 0 ? `Nhận ${received}/${item.quantity}, thiếu ${missing}` : `Nhận đủ từ ${warehouseName(transfer.from_warehouse)}`,
          actor,
        });
      }
    })();
    const [transfer] = transfersList('WHERE id = ?', [transferId], 1);
    writeAdminAudit(req, {
      action: 'receive', entityType: 'stock_transfer', entityId: transfer.code,
      after: { code: transfer.code, items: transfer.items.map((i) => ({ product: i.product_name, sent: i.quantity, received: i.received_quantity })) },
    });
    const missing = roundQty(transfer.items.reduce((sum, i) => sum + (i.quantity - (i.received_quantity ?? i.quantity)), 0));
    res.json({
      transfer, ...overview(), transfers: transfersList("WHERE status = 'in_transit'"),
      message: missing > 0 ? `Đã xác nhận ${transfer.code}. Thiếu ${missing} so với lệnh chuyển.` : `Đã xác nhận nhận đủ hàng của ${transfer.code}.`,
    });
  } catch (err) { next(err); }
});

/** POST /api/admin/inventory/transfers/:id/cancel — huỷ lệnh còn đang chuyển, hàng trả về kho xuất (một lần). */
router.post('/transfers/:id/cancel', allow('inventory.transfer'), (req, res, next) => {
  try {
    const transferId = toInteger(req.params.id, { min: 1 });
    if (!transferId) throw new HttpError(404, 'Không tìm thấy lệnh chuyển.');
    const note = cleanText(req.body.note, LIMITS.note);
    const actor = actorOf(req);
    db.transaction(() => {
      const transfer = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(transferId);
      if (!transfer) throw new HttpError(404, 'Không tìm thấy lệnh chuyển.');
      const locked = db.prepare(`
        UPDATE stock_transfers SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now'), receive_note = ?
        WHERE id = ? AND status = 'in_transit'
      `).run(actor.id, note, transferId).changes;
      if (!locked) throw new HttpError(409, 'Lệnh chuyển này đã được xác nhận hoặc đã huỷ. Vui lòng tải lại trang.');
      const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ? ORDER BY id').all(transferId);
      for (const item of items) {
        if (!item.product_id) continue;
        moveStock({
          productId: item.product_id, warehouse: transfer.from_warehouse, delta: item.quantity, kind: 'transfer_cancel',
          ref: { type: 'transfer', id: transferId, code: transfer.code }, note, actor,
        });
      }
    })();
    const [transfer] = transfersList('WHERE id = ?', [transferId], 1);
    writeAdminAudit(req, { action: 'cancel', entityType: 'stock_transfer', entityId: transfer.code, after: { code: transfer.code, note } });
    res.json({
      transfer, ...overview(), transfers: transfersList("WHERE status = 'in_transit'"),
      message: `Đã huỷ lệnh chuyển ${transfer.code}. Hàng đã trả về ${warehouseName(transfer.from_warehouse)}.`,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/inventory/count — kiểm kê hoặc đặt tồn đầu kỳ: gõ số ĐẾM ĐƯỢC, máy tự tính chênh lệch
 * và ghi nhật ký. body: { warehouse, kind: 'opening' | 'count', note?, items: [{ product_id, counted }] }
 */
router.post('/count', allow('inventory.count'), (req, res, next) => {
  try {
    const { warehouse } = req.body;
    if (!isWarehouse(warehouse)) throw new HttpError(400, 'Chọn kho cần kiểm kê.', { warehouse: 'Chọn kho.' });
    const kind = req.body.kind === 'opening' ? 'opening' : 'count';
    const note = cleanText(req.body.note, LIMITS.note);
    const wanted = new Map();
    for (const row of Array.isArray(req.body.items) ? req.body.items : []) {
      const productId = toInteger(row?.product_id, { min: 1 });
      const countedQty = toQty(row?.counted, { min: 0, max: LIMITS.stock });
      if (!productId || countedQty == null) throw new HttpError(400, `Số đếm được phải là số từ 0 đến ${LIMITS.stock} (được lẻ).`, { items: 'Số đếm được chưa hợp lệ.' });
      wanted.set(productId, countedQty);
    }
    if (!wanted.size) throw new HttpError(400, 'Nhập số đếm được cho ít nhất một loại hàng.', { items: 'Nhập số đếm được cho ít nhất một loại hàng.' });

    const actor = actorOf(req);
    const column = stockColumn(warehouse);
    const changes = db.transaction(() => {
      const getProduct = db.prepare(`SELECT id, name, ${column} AS current FROM products WHERE id = ?`);
      const changed = [];
      for (const [productId, countedQty] of wanted) {
        const product = getProduct.get(productId);
        if (!product) throw new HttpError(400, 'Có loại hàng không còn trong danh sách. Vui lòng tải lại trang.');
        const delta = roundQty(countedQty - product.current);
        if (!delta) continue;
        moveStock({ productId, warehouse, delta, kind, note, actor, strict: false });
        changed.push({ product: product.name, before: product.current, after: countedQty });
      }
      return changed;
    })();
    if (changes.length) {
      writeAdminAudit(req, {
        action: kind === 'opening' ? 'opening_stock' : 'count_stock', entityType: 'warehouse', entityId: warehouse,
        after: { warehouse, note, changes },
      });
    }
    res.json({
      ...overview(), changed: changes.length,
      message: changes.length
        ? `Đã cập nhật tồn ${warehouseName(warehouse)} cho ${changes.length} loại hàng.`
        : 'Số đếm được khớp với số trên máy, không có gì thay đổi.',
    });
  } catch (err) { next(err); }
});

export default router;
