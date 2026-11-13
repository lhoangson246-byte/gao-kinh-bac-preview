import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { accessTable, can, requireStaff } from '../permissions.js';
import { changeOrderStatus } from '../order-status.js';
import { notifyShipperAssigned } from '../push.js';
import { guestAccountId, normalizeItems, placeOrder } from './orders.js';
import { DELIVERY_SLOT_CODES, mentionsOtherProvince, normalizeBacNinhAddress } from '../constants.js';
import { MAX_POINTS_PER_UNIT } from '../constants.js';
import {
  ORDER_STATUSES, LIMITS, localDate, parseWeightKg, PRODUCT_CATEGORY_CODES,
} from '../constants.js';
import { HttpError, cleanImageUrl, cleanText, normalizePhone, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import { listAdminOrders } from '../order-lists.js';
import { buildOrdersWorkbook } from '../orders-export.js';
import { MAX_BANNERS, MAX_BRANCHES, readStorefront } from './settings.js';
import {
  MAX_GROUPS, groupIdsByProduct, groupIdsOf, listGroups, setProductGroups, uniqueSlug,
} from '../product-groups.js';
import { getWholesale, wholesalePrices } from '../wholesale.js';
import { MAP_ONLY_ADDRESS, parseMapLink, splitAddressMap } from '../map-link.js';
import { STORE, isWarehouse, moveStock } from '../inventory.js';

const router = Router();

// Mọi API trong tệp này đều bắt buộc đăng nhập và là chủ cửa hàng hoặc nhân viên có đúng quyền,
// kiểm tra tại máy chủ chứ không dựa vào việc ẩn nút ở giao diện. Đường dẫn không có trong bảng
// dưới đây (cài đặt cửa hàng, nhật ký…) chỉ chủ cửa hàng dùng được.
router.use(requireAuth, requireStaff, accessTable([
  ['GET', /^\/orders(\/latest)?\/?$/, ['orders.view']],
  ['POST', /^\/orders\/?$/, ['orders.create']],
  ['PATCH', /^\/orders\/[^/]+\/status\/?$/, ['orders.manage']],
  ['PATCH', /^\/orders\/[^/]+\/shipper\/?$/, ['orders.manage']],
  ['PATCH', /^\/orders\/[^/]+\/transfer\/?$/, ['orders.manage']],
  ['GET', /^\/shippers\/?$/, ['orders.manage', 'orders.create']],
  ['GET', /^\/stats\/?$/, ['orders.view', 'products.manage']],
  ['GET', /^\/export\/orders\/?$/, ['orders.export']],
  ['GET', /^\/revenue\/?$/, ['revenue.view']],
  ['*', /^\/(products|groups|stock-entries|upsell)(\/|$)/, ['products.manage']],
]));
router.use(validateRoutes('admin'));

/** GET /api/admin/orders — Tất cả đơn hàng (lọc ?status=) */
router.get('/orders', (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !ORDER_STATUSES.includes(status)) {
      throw new HttpError(400, `Trạng thái phải thuộc: ${ORDER_STATUSES.join(', ')}.`);
    }

    const limit = toInteger(req.query.limit, { min: 1, max: 300 }) ?? 30;
    const offset = toInteger(req.query.offset, { min: 0, max: 100000 }) ?? 0;
    // Lọc theo ngày đặt (giờ Việt Nam), tính cả hai đầu.
    const from = req.query.from || null;
    const to = req.query.to || req.query.from || null;
    if (from && to && from > to) throw new HttpError(400, '"Từ ngày" phải trước hoặc bằng "đến ngày".');
    res.json(listAdminOrders({ status, from, to, limit, offset, transferPending: req.query.transfer === 'pending' }));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/orders/:id/transfer { confirmed: true } — cửa hàng đã kiểm tra tài khoản và nhận
 * được tiền khách chuyển khoản (có hoặc không có ảnh khách gửi).
 */
router.patch('/orders/:id/transfer', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const order = id && db.prepare('SELECT id, code, payment_method, status, transfer_confirmed_at FROM orders WHERE id = ?').get(id);
    if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    if (order.payment_method !== 'bank') throw new HttpError(400, 'Đơn này khách trả tiền mặt, không phải chuyển khoản.');
    if (order.status === 'cancelled') throw new HttpError(400, 'Đơn đã huỷ.');
    if (!order.transfer_confirmed_at) {
      db.prepare("UPDATE orders SET transfer_confirmed_at = datetime('now'), transfer_confirmed_by = ? WHERE id = ? AND transfer_confirmed_at IS NULL")
        .run(req.user.id, id);
      writeAdminAudit(req, { action: 'confirm_transfer', entityType: 'order', entityId: id, after: { code: order.code } });
    }
    const row = db.prepare(`
      SELECT o.transfer_confirmed_at, u.full_name AS transfer_confirmed_name FROM orders o
      LEFT JOIN users u ON u.id = o.transfer_confirmed_by WHERE o.id = ?
    `).get(id);
    res.json({ order: { id, transfer_confirmed_at: row.transfer_confirmed_at, transfer_confirmed_name: row.transfer_confirmed_name } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/orders/latest — đơn mới nhất và số đơn chờ xác nhận.
 * Trang quản trị hỏi định kỳ (khoảng 20 giây/lần) để kêu chuông khi có đơn mới, nên chỉ đọc
 * đúng những gì cần, không kèm danh sách hàng.
 */
router.get('/orders/latest', (req, res) => {
  const latest = db.prepare(`
    SELECT id, code, receiver_name, total, is_guest, created_at FROM orders ORDER BY id DESC LIMIT 1
  `).get() || null;
  const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").get().c;
  res.json({ latest, pending });
});

/** PATCH /api/admin/orders/:id/status — Đổi trạng thái đơn theo đúng quy trình */
router.patch('/orders/:id/status', (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    if (!orderId) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    const { before, order } = changeOrderStatus(orderId, req.body?.status, {
      actor: req.user,
      guard: (current) => {
        // Đơn giao tận nơi do nhân viên giao hàng bấm hoàn thành (kèm ảnh) trên tài khoản của mình
        // (02/11/2026). Khách lấy tại cửa hàng thì người xử lý đơn bấm; chủ cửa hàng được hoàn thành thay.
        if (req.body?.status !== 'completed' || req.user.role === 'admin') return;
        const fulfillment = db.prepare('SELECT fulfillment FROM orders WHERE id = ?').get(current.id)?.fulfillment;
        if (fulfillment !== 'pickup') {
          throw new HttpError(403, 'Đơn giao tận nơi do nhân viên giao hàng bấm hoàn thành (kèm ảnh) trên tài khoản của mình.');
        }
      },
    });
    writeAdminAudit(req, {
      action: 'update_status', entityType: 'order', entityId: orderId,
      before: { status: before.status }, after: { status: order.status },
    });
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/orders — nhân viên nhập đơn bằng tay (khách gọi điện, nhắn Zalo) rồi giao cho khách.
 *  body: { receiver_name, phone, home_delivery, address?, delivery_slot?, note?, payment_method?,
 *          items: [{product_id, quantity}], discount_code?, shipper_id? }
 * Giá, tồn kho, ưu đãi đơn đầu / mã giảm giá tính y như đơn online (cùng hàm placeOrder). Đơn được
 * xác nhận ngay; không giao tận nơi thì ghi "Khách lấy tại cửa hàng".
 */
router.post('/orders', async (req, res, next) => {
  try {
    const body = req.body;
    const errors = {};
    const receiverName = cleanText(body.receiver_name, LIMITS.name);
    if (!receiverName || receiverName.length < 2) errors.receiver_name = 'Nhập họ tên khách.';
    const phone = normalizePhone(body.phone);
    if (!phone) errors.phone = 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).';
    const homeDelivery = body.home_delivery !== false;
    // Định vị khách gửi (link Google Maps hoặc toạ độ): chỉ cần khi giao tận nơi.
    // Link dán thẳng vào ô địa chỉ được tách ra làm định vị (nếu ô định vị đang trống).
    const pasted = homeDelivery ? splitAddressMap(body.address) : null;
    const mapInput = typeof body.map_url === 'string' && body.map_url.trim() ? body.map_url : pasted?.url;
    const map = homeDelivery ? parseMapLink(mapInput) : { url: null };
    if (map.error) errors.map_url = map.error;
    let address = 'Khách lấy tại cửa hàng';
    if (homeDelivery) {
      const typed = pasted ? pasted.address : body.address;
      if (typeof typed === 'string' && typed.length > LIMITS.address) errors.address = `Địa chỉ dài quá ${LIMITS.address} ký tự.`;
      const raw = errors.address ? null : cleanText(typed, LIMITS.address);
      if (errors.address) { /* đã báo ở trên */ }
      else if (!raw && map.url) address = MAP_ONLY_ADDRESS;      // chỉ có định vị: giao theo điểm ghim
      else if (!raw || (raw.length < 8 && !map.url)) errors.address = 'Nhập địa chỉ giao hàng chi tiết hoặc dán link định vị Google Maps.';
      else if (mentionsOtherProvince(raw)) errors.address = 'Cửa hàng chỉ giao trong tỉnh Bắc Ninh.';
      else address = normalizeBacNinhAddress(raw);
    }
    const slot = body.delivery_slot || null;
    if (slot && !DELIVERY_SLOT_CODES.includes(slot)) errors.delivery_slot = 'Khung giờ giao không hợp lệ.';
    const payment = body.payment_method || 'cod';
    if (!['cod', 'bank'].includes(payment)) errors.payment_method = 'Hình thức thanh toán không hợp lệ.';
    const shipperId = body.shipper_id == null ? null : toInteger(body.shipper_id, { min: 1 });
    if (shipperId) {
      const shipper = db.prepare("SELECT permissions, is_locked FROM users WHERE id = ? AND role = 'staff'").get(shipperId);
      if (!shipper || shipper.is_locked || !can({ role: 'staff', permissions: shipper.permissions }, 'delivery')) {
        errors.shipper_id = 'Người này không phải nhân viên giao hàng đang làm.';
      }
    }
    // Khách buôn: giá từng dòng = giá nhân viên ghi, không có thì giá cố định của khách, không có nữa
    // thì giá web. Khách lẻ: không nhận giá từ trình duyệt, luôn tính giá web.
    const items = Array.isArray(body.items) ? body.items : [];
    let wholesale = null;
    let priceOverrides = null;
    if (body.customer_type === 'wholesale') {
      const wid = toInteger(body.wholesale_customer_id, { min: 1 });
      wholesale = wid && getWholesale(wid);
      if (!wholesale || !wholesale.is_active) errors.wholesale_customer_id = 'Chọn khách buôn trong danh sách.';
      if (body.discount_code) errors.discount_code = 'Khách buôn không áp dụng mã giảm giá.';
      if (wholesale?.is_active) {
        priceOverrides = wholesalePrices(wholesale.id);
        for (const line of items) {
          if (line?.price == null) continue;
          const price = toInteger(line.price, { min: 1, max: LIMITS.price });
          if (!price) errors.items = 'Giá bán cho khách buôn phải là số nguyên lớn hơn 0.';
          else priceOverrides.set(Number(line.product_id), price);
        }
      }
    } else if (items.some((line) => line?.price != null)) {
      errors.items = 'Khách lẻ tính đúng giá web, không sửa giá được.';
    }
    // Kho xuất hàng: khách lẻ luôn lấy ở Cửa hàng Nguyễn Cao; khách buôn do nhân viên chọn (thường là
    // Kho Bồ Sơn). Không gửi lên thì là Cửa hàng Nguyễn Cao như trước nay.
    const warehouse = body.warehouse || STORE;
    if (!isWarehouse(warehouse)) errors.warehouse = 'Chọn kho xuất hàng.';
    else if (warehouse !== STORE && body.customer_type !== 'wholesale') errors.warehouse = 'Đơn khách lẻ xuất từ Cửa hàng Nguyễn Cao.';
    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);

    const orderId = placeOrder({
      // Khách buôn có tài khoản: đơn hiện trong lịch sử đơn của khách.
      userId: wholesale?.user_id || guestAccountId(),
      guest: !wholesale?.user_id,
      wholesaleCustomerId: wholesale?.id ?? null,
      priceOverrides,
      receiverName,
      customerPhone: phone,
      deliveryAddress: address,
      mapUrl: map.url,
      customerNote: cleanText(body.note, LIMITS.note),
      paymentMethod: payment,
      deliverySlot: slot,
      wanted: normalizeItems(body.items),
      discountCode: body.discount_code || null,
      staff: { createdBy: req.user.id, fulfillment: homeDelivery ? 'delivery' : 'pickup', shipperId },
      warehouse,
      stockActor: { id: req.user.id, full_name: req.user.full_name },
    });
    writeAdminAudit(req, {
      action: 'create_order', entityType: 'order', entityId: orderId,
      after: { phone, home_delivery: homeDelivery, shipper_id: shipperId, ...(wholesale ? { wholesale: wholesale.code, prices: Object.fromEntries(priceOverrides) } : {}) },
    });
    if (shipperId) await notifyShipperAssigned(orderId, shipperId);
    const order = db.prepare(`
      SELECT o.*, s.full_name AS shipper_name FROM orders o LEFT JOIN users s ON s.id = o.shipper_id WHERE o.id = ?
    `).get(orderId);
    delete order.guest_token_hash;
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/shippers — nhân viên giao hàng đang làm (để chọn người giao cho đơn). */
router.get('/shippers', (req, res) => {
  const shippers = db.prepare(`
    SELECT id, full_name, phone, permissions FROM users WHERE role = 'staff' AND is_locked = 0 ORDER BY full_name
  `).all().filter((u) => can({ role: 'staff', permissions: u.permissions }, 'delivery'))
    .map(({ permissions, ...u }) => u);
  res.json({ shippers });
});

/**
 * PATCH /api/admin/orders/:id/shipper — phân công (hoặc bỏ phân công) nhân viên giao đơn.
 *  body: { shipper_id: number | null }. Nhân viên được giao nhận thông báo đẩy trên điện thoại.
 */
router.patch('/orders/:id/shipper', async (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    const shipperId = req.body.shipper_id == null ? null : toInteger(req.body.shipper_id, { min: 1 });
    const result = db.transaction(() => {
      const order = orderId && db.prepare('SELECT id, code, status, shipper_id FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
      if (['completed', 'cancelled'].includes(order.status)) {
        throw new HttpError(400, 'Đơn đã kết thúc, không đổi người giao được.');
      }
      if (shipperId) {
        const shipper = db.prepare("SELECT id, full_name, permissions, is_locked FROM users WHERE id = ? AND role = 'staff'").get(shipperId);
        if (!shipper || shipper.is_locked || !can({ role: 'staff', permissions: shipper.permissions }, 'delivery')) {
          throw new HttpError(400, 'Người này không phải nhân viên giao hàng đang làm.', { shipper_id: 'Chọn nhân viên giao hàng khác.' });
        }
      }
      db.prepare('UPDATE orders SET shipper_id = ? WHERE id = ?').run(shipperId, order.id);
      return order;
    })();
    writeAdminAudit(req, {
      action: 'assign_shipper', entityType: 'order', entityId: orderId,
      before: { shipper_id: result.shipper_id }, after: { shipper_id: shipperId },
    });
    if (shipperId && shipperId !== result.shipper_id) await notifyShipperAssigned(orderId, shipperId);
    res.json({ order: db.prepare(`
      SELECT o.id, o.shipper_id, s.full_name AS shipper_name FROM orders o LEFT JOIN users s ON s.id = o.shipper_id WHERE o.id = ?
    `).get(orderId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/products — Danh sách gồm cả loại đã ẩn */
router.get('/products', (req, res) => {
  const groups = groupIdsByProduct();
  const products = db.prepare('SELECT * FROM products ORDER BY sort_order, id').all()
    .map((p) => ({ ...p, group_ids: groups.get(p.id) || [] }));
  res.json({ products });
});

/* ------------------------------------------------------------------ *
 * Nhóm gạo (bộ lọc trang chủ): tạo, đổi tên, ẩn/hiện, xếp thứ tự, xoá.
 * ------------------------------------------------------------------ */
const groupWithProducts = () => {
  const members = new Map();
  for (const row of db.prepare('SELECT group_id, product_id FROM product_group_items ORDER BY group_id, sort_order, product_id').all()) {
    if (!members.has(row.group_id)) members.set(row.group_id, []);
    members.get(row.group_id).push(row.product_id);
  }
  return listGroups().map((g) => ({ ...g, product_ids: members.get(g.id) || [] }));
};

/** GET /api/admin/groups — mọi nhóm (cả nhóm đang ẩn) kèm danh sách sản phẩm. */
router.get('/groups', (req, res) => {
  res.json({ groups: groupWithProducts() });
});

/** POST /api/admin/groups { name } — thêm nhóm mới, xếp cuối. */
router.post('/groups', (req, res, next) => {
  try {
    const name = cleanText(req.body?.name, 60);
    if (!name || name.length < 2) throw new HttpError(400, 'Nhập tên nhóm.', { name: 'Nhập tên nhóm (ít nhất 2 ký tự).' });
    const id = db.transaction(() => {
      if (db.prepare('SELECT COUNT(*) n FROM product_groups').get().n >= MAX_GROUPS) {
        throw new HttpError(400, `Tối đa ${MAX_GROUPS} nhóm.`);
      }
      if (db.prepare('SELECT 1 FROM product_groups WHERE lower(name) = lower(?)').get(name)) {
        throw new HttpError(409, 'Đã có nhóm trùng tên.', { name: 'Đã có nhóm trùng tên.' });
      }
      const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 n FROM product_groups').get().n;
      return db.prepare('INSERT INTO product_groups (slug, name, sort_order) VALUES (?, ?, ?)')
        .run(uniqueSlug(name), name, order).lastInsertRowid;
    })();
    const group = groupWithProducts().find((g) => g.id === Number(id));
    writeAdminAudit(req, { action: 'create', entityType: 'product_group', entityId: group.id, after: group });
    res.status(201).json({ group });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/groups/reorder { ids: [...] } — xếp thứ tự nhóm trên bộ lọc. */
router.post('/groups/reorder', (req, res, next) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((v) => toInteger(v, { min: 1 }));
    if (!ids.length || ids.some((v) => !v)) throw new HttpError(400, 'Danh sách nhóm không hợp lệ.');
    db.transaction(() => {
      const update = db.prepare('UPDATE product_groups SET sort_order = ? WHERE id = ?');
      ids.forEach((id, index) => update.run(index + 1, id));
    })();
    writeAdminAudit(req, { action: 'reorder', entityType: 'product_group', entityId: null, after: { ids } });
    res.json({ groups: groupWithProducts() });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/groups/:id { name?, is_active?, product_ids? } — đổi tên, ẩn/hiện trên bộ lọc,
 * hoặc đặt lại danh sách sản phẩm của nhóm. Mã nhóm giữ nguyên khi đổi tên để link cũ vẫn chạy.
 */
router.put('/groups/:id', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const before = id ? groupWithProducts().find((g) => g.id === id) : null;
    if (!before) throw new HttpError(404, 'Không tìm thấy nhóm.');
    const body = req.body || {};
    db.transaction(() => {
      if (body.name !== undefined) {
        const name = cleanText(body.name, 60);
        if (!name || name.length < 2) throw new HttpError(400, 'Nhập tên nhóm.', { name: 'Nhập tên nhóm (ít nhất 2 ký tự).' });
        if (db.prepare('SELECT 1 FROM product_groups WHERE lower(name) = lower(?) AND id <> ?').get(name, id)) {
          throw new HttpError(409, 'Đã có nhóm trùng tên.', { name: 'Đã có nhóm trùng tên.' });
        }
        db.prepare('UPDATE product_groups SET name = ? WHERE id = ?').run(name, id);
      }
      if (body.is_active !== undefined) {
        db.prepare('UPDATE product_groups SET is_active = ? WHERE id = ?').run(body.is_active ? 1 : 0, id);
      }
      if (Array.isArray(body.product_ids)) {
        const ids = [...new Set(body.product_ids.map((v) => toInteger(v, { min: 1 })).filter(Boolean))];
        // Giữ thứ tự đã kéo thả của sản phẩm vẫn còn trong nhóm; sản phẩm mới chọn xếp cuối.
        const current = db.prepare('SELECT product_id FROM product_group_items WHERE group_id = ?').all(id).map((r) => r.product_id);
        const remove = db.prepare('DELETE FROM product_group_items WHERE group_id = ? AND product_id = ?');
        for (const productId of current) if (!ids.includes(productId)) remove.run(id, productId);
        let order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM product_group_items WHERE group_id = ?').get(id).n;
        const insert = db.prepare(`
          INSERT OR IGNORE INTO product_group_items (group_id, product_id, sort_order)
          SELECT ?, id, ? FROM products WHERE id = ?
        `);
        for (const productId of ids) if (!current.includes(productId)) insert.run(id, ++order, productId);
      }
    })();
    const group = groupWithProducts().find((g) => g.id === id);
    writeAdminAudit(req, { action: 'update', entityType: 'product_group', entityId: id, before, after: group });
    res.json({ group });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/groups/:id/order { product_ids } — xếp thứ tự sản phẩm trong nhóm (kéo thả). Chỉ nhận
 * sản phẩm đang thuộc nhóm; sản phẩm của nhóm không có trong danh sách giữ thứ tự cũ, xếp sau.
 */
router.post('/groups/:id/order', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const before = id ? groupWithProducts().find((g) => g.id === id) : null;
    if (!before) throw new HttpError(404, 'Không tìm thấy nhóm.');
    const ids = (Array.isArray(req.body?.product_ids) ? req.body.product_ids : []).map((v) => toInteger(v, { min: 1 }));
    if (!ids.length || ids.some((v) => !v) || new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'Danh sách sản phẩm không hợp lệ.');
    }
    if (ids.some((productId) => !before.product_ids.includes(productId))) {
      throw new HttpError(400, 'Có sản phẩm không thuộc nhóm này. Vui lòng tải lại trang.');
    }
    const order = [...ids, ...before.product_ids.filter((productId) => !ids.includes(productId))];
    db.transaction(() => {
      const update = db.prepare('UPDATE product_group_items SET sort_order = ? WHERE group_id = ? AND product_id = ?');
      order.forEach((productId, index) => update.run(index + 1, id, productId));
    })();
    writeAdminAudit(req, { action: 'reorder_products', entityType: 'product_group', entityId: id, before: { product_ids: before.product_ids }, after: { product_ids: order } });
    res.json({ groups: groupWithProducts() });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/groups/:id — xoá nhóm (sản phẩm vẫn giữ nguyên, chỉ bỏ khỏi nhóm). */
router.delete('/groups/:id', (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const before = id ? groupWithProducts().find((g) => g.id === id) : null;
    if (!before) throw new HttpError(404, 'Không tìm thấy nhóm.');
    db.transaction(() => {
      db.prepare('DELETE FROM product_group_items WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM product_groups WHERE id = ?').run(id);
    })();
    writeAdminAudit(req, { action: 'delete', entityType: 'product_group', entityId: id, before, after: null });
    res.json({ ok: true, message: `Đã xoá nhóm “${before.name}”. Các sản phẩm vẫn còn nguyên.` });
  } catch (err) {
    next(err);
  }
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

  // Khối lượng một đơn vị bán, dùng để tính mốc 50kg được giảm giá tại quầy.
  // Bỏ trống thì tự suy từ tên đơn vị ("bao 10kg" → 10).
  if (!partial || has('weight_kg') || has('unit')) {
    const blank = body?.weight_kg === '' || body?.weight_kg == null;
    if (blank) {
      if (!partial || has('unit')) data.weight_kg = parseWeightKg(data.unit ?? body?.unit);
    } else {
      const kg = Number(String(body.weight_kg).replace(',', '.'));
      if (!Number.isFinite(kg) || kg < 0 || kg > 1000) {
        errors.weight_kg = 'Khối lượng phải là số từ 0 đến 1000 kg.';
      } else {
        data.weight_kg = kg;
      }
    }
  }
  if (has('origin')) data.origin = cleanText(body.origin, LIMITS.origin);
  // Mã sản phẩm của cửa hàng (ví dụ SP014), dùng ở bảng tồn kho.
  if (has('sku')) data.sku = cleanText(body.sku, 30);
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

  if (!partial || has('category')) {
    const category = body?.category ?? 'gao';
    if (!PRODUCT_CATEGORY_CODES.includes(category)) errors.category = 'Nhóm hàng không hợp lệ.';
    else data.category = category;
  }

  // Giá gốc trước khi giảm; 0 nghĩa là không giảm giá. Chỉ để hiện nhãn giảm giá,
  // khách luôn trả đúng giá bán nên không đổi cách tính tiền ở đâu cả.
  if (has('original_price')) {
    const blank = body.original_price === '' || body.original_price == null;
    if (blank) data.original_price = 0;
    else {
      const original = toInteger(body.original_price, { min: 0, max: LIMITS.price });
      if (original == null) errors.original_price = `Giá gốc phải là số nguyên từ 0 đến ${LIMITS.price} đồng.`;
      else data.original_price = original;
    }
  }

  // Điểm riêng cho mỗi túi/bao. Bỏ trống (null) = theo tiền 1.000đ = 1 điểm; 0 = không cộng điểm.
  if (has('points_per_unit')) {
    const blank = body.points_per_unit === '' || body.points_per_unit == null;
    if (blank) data.points_per_unit = null;
    else {
      const points = toInteger(body.points_per_unit, { min: 0, max: MAX_POINTS_PER_UNIT });
      if (points == null) errors.points_per_unit = `Điểm mỗi đơn vị phải là số nguyên từ 0 đến ${MAX_POINTS_PER_UNIT}.`;
      else data.points_per_unit = points;
    }
  }

  // Loại này có nằm trong danh sách quà đổi 1.000 điểm không.
  if (has('is_reward')) data.is_reward = body.is_reward ? 1 : 0;

  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
  return data;
}

/**
 * Giá gốc chỉ có nghĩa khi cao hơn giá bán. Kiểm tra trên giá trị SAU khi gộp
 * với dữ liệu cũ, vì cửa hàng có thể chỉ sửa một trong hai ô.
 */
function assertSalePrice({ price, original_price: original }) {
  if (original > 0 && original <= price) {
    throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', {
      original_price: 'Giá gốc phải cao hơn giá bán. Để trống nếu sản phẩm không giảm giá.',
    });
  }
}

/* ------------------------------------------------------------------ *
 * Nhập kho: cộng thêm số lượng và ghi lại lịch sử
 * ------------------------------------------------------------------ */

const MAX_STOCK_IN = 100_000;

/** POST /api/admin/products/:id/stock — nhập thêm hàng vào kho
 *  body: { quantity, cost_price?, note? }
 *  Số lượng được CỘNG THÊM vào tồn kho hiện có, không phải ghi đè.
 */
/**
 * POST /api/admin/products/order { ids } — thứ tự sản phẩm khách thấy ở "Tất cả mặt hàng" (kéo thả).
 * Sản phẩm không có trong danh sách giữ thứ tự cũ, xếp sau.
 */
router.post('/products/order', (req, res, next) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((v) => toInteger(v, { min: 1 }));
    if (!ids.length || ids.some((v) => !v) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Danh sách sản phẩm không hợp lệ.');
    const current = db.prepare('SELECT id FROM products ORDER BY sort_order, id').all().map((r) => r.id);
    if (ids.some((id) => !current.includes(id))) throw new HttpError(400, 'Có sản phẩm không còn trong cửa hàng. Vui lòng tải lại trang.');
    const order = [...ids, ...current.filter((id) => !ids.includes(id))];
    db.transaction(() => {
      const update = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?');
      order.forEach((id, index) => update.run(index + 1, id));
    })();
    writeAdminAudit(req, { action: 'reorder', entityType: 'product', entityId: null, before: { ids: current }, after: { ids: order } });
    const groups = groupIdsByProduct();
    res.json({ products: db.prepare('SELECT * FROM products ORDER BY sort_order, id').all().map((p) => ({ ...p, group_ids: groups.get(p.id) || [] })) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/upsell { ids } — sản phẩm mua kèm (upsale): hiện ở giỏ hàng của khách và gắn nhãn HOT,
 * theo đúng thứ tự gửi lên. Danh sách rỗng = không mời mua kèm.
 */
router.put('/upsell', (req, res, next) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((v) => toInteger(v, { min: 1 }));
    if (ids.some((v) => !v) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Danh sách sản phẩm mua kèm không hợp lệ.');
    const before = db.prepare('SELECT id FROM products WHERE upsell_rank IS NOT NULL ORDER BY upsell_rank').all().map((r) => r.id);
    db.transaction(() => {
      const exists = db.prepare('SELECT 1 FROM products WHERE id = ?');
      if (ids.some((id) => !exists.get(id))) throw new HttpError(400, 'Có sản phẩm không còn trong cửa hàng. Vui lòng tải lại trang.');
      db.prepare('UPDATE products SET upsell_rank = NULL WHERE upsell_rank IS NOT NULL').run();
      const set = db.prepare('UPDATE products SET upsell_rank = ? WHERE id = ?');
      ids.forEach((id, index) => set.run(index + 1, id));
    })();
    writeAdminAudit(req, { action: 'set_upsell', entityType: 'product', entityId: null, before: { ids: before }, after: { ids } });
    const groups = groupIdsByProduct();
    res.json({ products: db.prepare('SELECT * FROM products ORDER BY sort_order, id').all().map((p) => ({ ...p, group_ids: groups.get(p.id) || [] })) });
  } catch (err) {
    next(err);
  }
});

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
      // Nút "Nhập kho" ở trang Sản phẩm nhập thẳng vào Cửa hàng Nguyễn Cao, có ghi nhật ký kho.
      moveStock({
        productId, warehouse: STORE, delta: quantity, kind: 'receipt',
        note: note || 'Nhập kho nhanh ở trang Sản phẩm', actor: req.user,
      });
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
/** Mã sản phẩm (SP014…) không được trùng giữa hai sản phẩm. */
function assertSkuFree(sku, exceptId) {
  if (!sku) return;
  const taken = db.prepare('SELECT id FROM products WHERE LOWER(sku) = LOWER(?) AND id <> ?').get(sku, exceptId ?? 0);
  if (taken) throw new HttpError(400, 'Mã sản phẩm này đã dùng cho loại hàng khác.', { sku: 'Mã này đã dùng cho loại hàng khác.' });
}

router.post('/products', (req, res, next) => {
  try {
    const data = readProductInput(req.body, { partial: false });
    assertSalePrice({ price: data.price, original_price: data.original_price ?? 0 });
    assertSkuFree(data.sku, null);
    const productId = db.transaction(() => {
      const id = db
        .prepare(
          `INSERT INTO products (name, description, origin, price, cost_price, unit, weight_kg, stock,
                                 image_url, is_active, category, original_price, points_per_unit, is_reward, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products))`
        )
        .run(
          data.name, data.description ?? null, data.origin ?? null, data.price,
          data.cost_price ?? 0, data.unit, data.weight_kg ?? 0, 0,
          data.image_url ?? null, data.is_active ?? 1, data.category ?? 'gao', data.original_price ?? 0,
          data.points_per_unit ?? null, data.is_reward ?? 0,
        ).lastInsertRowid;
      // Tồn ban đầu là tồn Cửa hàng Nguyễn Cao, ghi vào nhật ký kho như mọi thay đổi tồn khác.
      if (data.stock > 0) {
        moveStock({ productId: id, warehouse: STORE, delta: data.stock, kind: 'opening', note: 'Tồn ban đầu khi thêm sản phẩm', actor: req.user });
      }
      if (data.sku) db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(data.sku, id);
      // Nhóm gạo (bộ lọc trang chủ): một sản phẩm thuộc được nhiều nhóm.
      if (Array.isArray(req.body?.group_ids)) setProductGroups(id, req.body.group_ids);
      return id;
    })();
    const product = { ...db.prepare('SELECT * FROM products WHERE id = ?').get(productId), group_ids: groupIdsOf(productId) };
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
    const groupIds = Array.isArray(req.body?.group_ids) ? req.body.group_ids : null;
    if (!fields.length && !groupIds) throw new HttpError(400, 'Không có thông tin nào để cập nhật.');
    assertSalePrice({ ...before, ...data });
    assertSkuFree(data.sku, productId);

    db.transaction(() => {
      // Sửa ô tồn kho ở trang Sản phẩm = điều chỉnh tồn Cửa hàng Nguyễn Cao; đi qua nhật ký kho để
      // ai sửa, sửa bao nhiêu đều để lại dấu.
      if (data.stock !== undefined) {
        const current = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
        if (data.stock !== current) {
          moveStock({ productId, warehouse: STORE, delta: data.stock - current, kind: 'edit', actor: req.user, strict: false });
        }
      }
      const columns = fields.filter((f) => f !== 'stock');
      if (columns.length) {
        db.prepare(`UPDATE products SET ${columns.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
          .run(...columns.map((f) => data[f]), productId);
      }
      if (groupIds) setProductGroups(productId, groupIds);
    })();
    const product = { ...db.prepare('SELECT * FROM products WHERE id = ?').get(productId), group_ids: groupIdsOf(productId) };
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

/**
 * DELETE /api/admin/products/:id/permanent — Xoá hẳn loại gạo khỏi hệ thống.
 *
 * Khác với "Ẩn" ở trên: dòng sản phẩm biến mất thật. Làm được việc này an toàn
 * vì đơn hàng và hoá đơn đều đã chụp lại tên, đơn vị và giá lúc bán
 * (order_items / retail_invoice_items, khoá ngoại ON DELETE SET NULL), nên lịch
 * sử mua bán và doanh thu vẫn nguyên vẹn. Lịch sử nhập kho của riêng loại gạo
 * này thì mất theo, vì nó không còn ý nghĩa.
 */
router.delete('/products/:id/permanent', (req, res, next) => {
  try {
    const productId = toInteger(req.params.id, { min: 1 });
    if (!productId) throw new HttpError(404, 'Không tìm thấy loại gạo.');
    const { before, sold } = db.transaction(() => {
      const before = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (!before) throw new HttpError(404, 'Không tìm thấy loại gạo.');
      const sold = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM order_items WHERE product_id = ?) +
        (SELECT COUNT(*) FROM retail_invoice_items WHERE product_id = ?) AS n
    `).get(productId, productId).n;

      db.prepare('DELETE FROM product_group_items WHERE product_id = ?').run(productId);
      db.prepare('DELETE FROM wholesale_prices WHERE product_id = ?').run(productId);
      const info = db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      if (!info.changes) throw new HttpError(404, 'Không tìm thấy loại gạo.');
      return { before, sold };
    })();

    writeAdminAudit(req, {
      action: 'delete', entityType: 'product', entityId: productId, before, after: null,
    });
    res.json({
      ok: true,
      message: `Đã xoá hẳn “${before.name}”. ${sold} dòng trong đơn và hoá đơn cũ vẫn giữ nguyên tên và giá lúc bán.`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/settings/storefront — đổi ảnh banner trang chủ và số điện thoại tư vấn.
 * Chỉ trường nào được gửi mới bị đổi:
 *  - banner_images: danh sách ảnh chạy vòng theo đúng thứ tự (mảng rỗng = banner màu mặc định)
 *  - banner_image_url: cách cũ, một ảnh duy nhất ('' = bỏ ảnh)
 *  - contact_phone: số điện thoại tư vấn ('' = ẩn khung liên hệ trên trang chủ)
 *  - zalo_phone: số Zalo nhận báo giá ('' = dùng số tư vấn)
 */
router.put('/settings/storefront', (req, res, next) => {
  try {
    const body = req.body || {};
    const errors = {};
    const updates = [];

    let banners = null;
    if (Array.isArray(body.banner_images)) {
      banners = body.banner_images.map((raw) => cleanText(raw, LIMITS.imageUrl)).filter(Boolean);
    } else if (body.banner_image_url !== undefined) {
      const raw = cleanText(body.banner_image_url, LIMITS.imageUrl);
      banners = raw ? [raw] : [];
    }
    if (banners) {
      const cleaned = banners.map((url) => cleanImageUrl(url));
      if (cleaned.some((url) => !url)) {
        errors.banner_images = 'Đường dẫn ảnh phải bắt đầu bằng http://, https:// hoặc / (ảnh có sẵn trong ứng dụng).';
        errors.banner_image_url = errors.banner_images;
      } else if (cleaned.length > MAX_BANNERS) {
        errors.banner_images = `Tối đa ${MAX_BANNERS} ảnh banner.`;
      } else {
        // Bỏ ảnh trùng, giữ lần xuất hiện đầu tiên.
        const unique = [...new Set(cleaned)];
        updates.push(['banner_images', JSON.stringify(unique)], ['banner_image_url', unique[0] || '']);
      }
    }

    if (body.contact_phone !== undefined && body.contact_phone !== null) {
      const raw = cleanText(body.contact_phone, LIMITS.phone) || '';
      const phone = raw ? normalizePhone(raw) : '';
      if (raw && !phone) errors.contact_phone = 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).';
      else updates.push(['contact_phone', phone]);
    }

    if (body.bank_qr_url !== undefined) {
      const raw = cleanText(body.bank_qr_url || '', LIMITS.imageUrl) || '';
      const url = raw ? cleanImageUrl(raw) : '';
      if (raw && !url) errors.bank_qr_url = 'Đường dẫn ảnh QR phải bắt đầu bằng https:// hoặc / (ảnh tải lên cửa hàng).';
      else updates.push(['bank_qr_url', url]);
    }

    if (body.zalo_phone !== undefined && body.zalo_phone !== null) {
      const raw = cleanText(body.zalo_phone, LIMITS.phone) || '';
      const phone = raw ? normalizePhone(raw) : '';
      if (raw && !phone) errors.zalo_phone = 'Số Zalo không hợp lệ (10 số, ví dụ 0912345678).';
      else updates.push(['zalo_phone', phone]);
    }

    // Các cơ sở của cửa hàng (chân trang): tên, địa chỉ bắt buộc, số điện thoại tuỳ chọn.
    if (Array.isArray(body.branches)) {
      if (body.branches.length > MAX_BRANCHES) {
        errors.branches = `Tối đa ${MAX_BRANCHES} cơ sở.`;
      } else {
        const branches = [];
        body.branches.forEach((raw, index) => {
          const name = cleanText(raw?.name, 80) || '';
          const address = cleanText(raw?.address, LIMITS.address) || '';
          const rawPhone = cleanText(raw?.phone, LIMITS.phone) || '';
          const phone = rawPhone ? normalizePhone(rawPhone) : '';
          if (!name && !address && !rawPhone) return;            // dòng để trống: bỏ qua
          if (address.length < 8) errors.branches = `Cơ sở ${index + 1}: nhập địa chỉ đầy đủ.`;
          else if (rawPhone && !phone) errors.branches = `Cơ sở ${index + 1}: số điện thoại không hợp lệ.`;
          else branches.push({ name, address, phone });
        });
        if (!errors.branches) updates.push(['store_branches', JSON.stringify(branches)]);
      }
    }

    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);

    const before = readStorefront();
    db.transaction(() => {
      const upsert = db.prepare(`
        INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      for (const [key, value] of updates) upsert.run(key, value);
    })();
    const settings = readStorefront();
    writeAdminAudit(req, {
      action: 'update', entityType: 'storefront', entityId: null, before, after: settings,
    });
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/stats — Thống kê nhanh cho dashboard */
router.get('/stats', (req, res) => {
  const countOrders = db.prepare('SELECT COUNT(*) c FROM orders WHERE status = ?');
  const payload = {
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
      inventoryValue: db.prepare('SELECT COALESCE(SUM(cost_price * (MAX(stock, 0) + MAX(stock_bs, 0))), 0) s FROM products WHERE is_active = 1').get().s,
      revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status = 'completed'").get().s,
    },
  };
  // Nhân viên chưa được xem doanh thu / giá nhập thì không nhận các con số tiền này.
  if (!can(req.user, 'revenue.view')) delete payload.stats.revenue;
  if (!can(req.user, 'products.manage')) { delete payload.stats.inventoryValue; delete payload.stats.missingCost; }
  res.json(payload);
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
export function resolvePeriod(query) {
  if (Object.keys(query).length === 0) {
    const today = db.prepare(`SELECT ${localDate("'now'")} AS day`).get().day;
    return { type: 'day', from: today, to: today, label: `Ngày ${today.split('-').reverse().join('/')}` };
  }
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

router.get('/export/orders', async (req, res, next) => {
  try {
    const { status, ...rest } = req.query;
    const period = resolvePeriod(rest);
    // ?status=completed: chỉ đơn online ở trạng thái đó (ví dụ kế toán xuất đơn đã giao xong).
    const buffer = await buildOrdersWorkbook(period, { status: status || null });
    const filename = `don-hang${status ? `-${status}` : ''}-${period.from}_${period.to}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
});

/** GET /api/admin/revenue?period=day|month|range&date=&month=&from=&to=
 *  Gộp doanh thu đơn online đã hoàn thành và hoá đơn bán tại quầy.
 */
router.get('/revenue', (req, res, next) => {
  try {
    const period = resolvePeriod(req.query);
    const range = [period.from, period.to];

    // Đơn online chỉ tính khi đã hoàn thành — giống quy tắc doanh thu cũ.
    const online = db.prepare(`
      SELECT COUNT(*) c, COALESCE(SUM(total), 0) s
      FROM orders
      WHERE status = 'completed'
        AND ${localDate('created_at')} BETWEEN ? AND ?
    `).get(...range);

    const retail = db.prepare(`
      SELECT COUNT(*) c, COALESCE(SUM(total), 0) s, COALESCE(SUM(discount + voucher_discount), 0) d
      FROM retail_invoices
      WHERE ${localDate('created_at')} BETWEEN ? AND ?
    `).get(...range);

    // Chi tiết theo từng ngày để thấy ngày nào bán được nhiều.
    const daily = db.prepare(`
      SELECT day, SUM(online) online, SUM(retail) retail FROM (
        SELECT ${localDate('created_at')} day, total online, 0 retail
        FROM orders
        WHERE status = 'completed' AND ${localDate('created_at')} BETWEEN ? AND ?
        UNION ALL
        SELECT ${localDate('created_at')} day, 0 online, total retail
        FROM retail_invoices
        WHERE ${localDate('created_at')} BETWEEN ? AND ?
      )
      GROUP BY day ORDER BY day
    `).all(...range, ...range);

    // Giá vốn được chép vào từng dòng hàng lúc bán, nên đổi giá nhập về sau
    // không làm sai lãi của các đơn cũ.
    const onlineCost = db.prepare(`
      SELECT COALESCE(SUM(i.cost_price * i.quantity), 0) c
      FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.status = 'completed' AND ${localDate('o.created_at')} BETWEEN ? AND ?
    `).get(...range).c;
    const retailCost = db.prepare(`
      SELECT COALESCE(SUM(i.cost_price * i.quantity), 0) c
      FROM retail_invoice_items i JOIN retail_invoices v ON v.id = i.invoice_id
      WHERE ${localDate('v.created_at')} BETWEEN ? AND ?
    `).get(...range).c;

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
