import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  DELIVERY_AREA_CODE, DELIVERY_AREA_LABEL, DELIVERY_SLOT_CODES, LIMITS,
  mentionsOtherProvince, normalizeBacNinhAddress, FIRST_ORDER_DISCOUNT,
  RETAIL_POINTS_PER_REWARD, REWARD_VOUCHER_AMOUNT, MAX_REWARDS_PER_SALE, GUEST_MAX_QTY_PER_LINE,
} from '../constants.js';
import { createHash, randomBytes } from 'node:crypto';
import { HttpError, cleanText, isPhone, normalizePhone, toInteger } from '../validate.js';
import { readLocation } from './addresses.js';
import { attachItems } from '../order-lists.js';
import { loyaltyProfile, refundPoints, spendPoints } from '../loyalty.js';

const router = Router();

/** Mã đơn online, ví dụ DH000123. Migration dùng đúng định dạng này cho đơn cũ. */
export const orderCode = (id) => `DH${String(id).padStart(6, '0')}`;

/** Cột dòng hàng được phép trả cho khách. KHÔNG gồm cost_price (giá nhập, chỉ cửa hàng thấy). */
const ORDER_ITEM_COLUMNS = 'id, order_id, product_id, product_name, unit, price, quantity, is_reward';

/** Gộp các dòng trùng sản phẩm rồi kiểm tra số lượng. */
function normalizeItems(items, maxPerLine = LIMITS.quantityPerLine) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Giỏ hàng đang trống.', { items: 'Giỏ hàng đang trống.' });
  }
  if (items.length > LIMITS.linesPerOrder) {
    throw new HttpError(400, `Một đơn chỉ đặt tối đa ${LIMITS.linesPerOrder} loại gạo.`);
  }

  const merged = new Map();
  for (const line of items) {
    const productId = toInteger(line?.product_id, { min: 1 });
    const quantity = toInteger(line?.quantity, { min: 1, max: maxPerLine });
    if (!productId) throw new HttpError(400, 'Sản phẩm trong giỏ không hợp lệ.');
    if (!quantity) {
      throw new HttpError(400, `Số lượng phải là số nguyên từ 1 đến ${maxPerLine}.`);
    }
    const total = (merged.get(productId) || 0) + quantity;
    if (total > maxPerLine) {
      throw new HttpError(400, `Số lượng mỗi loại gạo tối đa ${maxPerLine}.`);
    }
    merged.set(productId, total);
  }
  return merged;
}

/** Quà đổi điểm khách chọn: [{product_id, quantity}] → Map. */
function normalizeRewardLines(rewards) {
  if (rewards == null) return new Map();
  if (!Array.isArray(rewards) || rewards.length > LIMITS.linesPerOrder) {
    throw new HttpError(400, 'Danh sách quà đổi điểm không hợp lệ.');
  }
  const merged = new Map();
  for (const line of rewards) {
    const productId = toInteger(line?.product_id, { min: 1 });
    const quantity = toInteger(line?.quantity, { min: 1, max: MAX_REWARDS_PER_SALE });
    if (!productId || !quantity) throw new HttpError(400, 'Phần quà không hợp lệ.');
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  return merged;
}

/**
 * Lõi tạo đơn, dùng chung cho đơn có tài khoản và đơn mua nhanh không cần tài khoản.
 * Đọc giá, kiểm tra tồn kho, tạo đơn, trừ kho, trừ điểm đổi quà trong CÙNG một transaction.
 * Giá và tổng tiền luôn do máy chủ tự tính, không tin dữ liệu gửi từ trình duyệt.
 */
function placeOrder({
  userId, guest = false, receiverName, customerPhone, deliveryAddress, customerNote,
  paymentMethod, deliverySlot, lat = null, lng = null, wanted,
  wantedRewards = new Map(), vouchers = 0, pointsPhone = null, guestTokenHash = null,
}) {
  const rewardCount = vouchers + [...wantedRewards.values()].reduce((sum, q) => sum + q, 0);
  return db.transaction(() => {
    // Chuẩn bị câu lệnh BÊN TRONG transaction. Với Turso (libSQL qua HTTP), câu
    // lệnh chuẩn bị trước khi BEGIN không chạy cùng phiên với transaction, nên
    // tạo đơn trên Vercel báo "Lỗi máy chủ" dù chạy bình thường ở máy.
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1');
    const insOrder = db.prepare(
      `INSERT INTO orders (user_id, receiver_name, phone, address, note, payment_method,
                           subtotal, discount, total, delivery_slot, delivery_lat, delivery_lng,
                           voucher_discount, points_used, points_phone, is_guest, guest_token_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit, price, quantity, cost_price,
                                points_per_unit, is_reward)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // Trừ kho có điều kiện: nếu người khác vừa mua trước thì không dòng nào đổi
    // và cả transaction bị huỷ bỏ, tránh bán vượt tồn kho.
    const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');

    const lines = [];
    let subtotal = 0;

    for (const [productId, quantity] of wanted) {
      const product = getProduct.get(productId);
      if (!product) {
        throw new HttpError(400, 'Có loại gạo trong giỏ không còn được bán. Vui lòng cập nhật giỏ hàng.');
      }
      if (product.price <= 0) {
        // Cửa hàng chưa nhập giá — không được để khách đặt với giá 0 đồng.
        throw new HttpError(400, `“${product.name}” chưa có giá bán. Vui lòng liên hệ cửa hàng.`);
      }
      if (product.stock < quantity) {
        throw new HttpError(400, `“${product.name}” chỉ còn ${product.stock} ${product.unit}.`);
      }
      lines.push({ product, quantity });
      subtotal += product.price * quantity;
    }

    // Quà đổi điểm: giá 0đ, vẫn trừ kho như hàng bán, không sinh điểm.
    const rewardLines = [];
    for (const [productId, quantity] of wantedRewards) {
      const product = getProduct.get(productId);
      if (!product || !product.is_reward) {
        throw new HttpError(400, 'Có phần quà không còn trong danh sách đổi điểm. Vui lòng chọn lại.');
      }
      rewardLines.push({ product, quantity });
    }

    // Ưu đãi đơn đầu tiên. Đơn đã huỷ không tính là đã mua, nhưng đơn còn chờ xác nhận thì
    // có, nên không thể đặt liền hai đơn để ăn giảm giá hai lần. Câu lệnh nằm trong cùng
    // transaction với INSERT bên dưới nên hai yêu cầu song song cũng chỉ một đơn được giảm.
    const boughtBefore = firstOrderUsed({ userId: guest ? null : userId, phone: customerPhone, guest });
    // Không để tiền giảm vượt quá tiền hàng.
    const firstDiscount = boughtBefore ? 0 : Math.min(FIRST_ORDER_DISCOUNT, subtotal);
    // Voucher đổi điểm không được vượt số tiền còn phải trả, để khách không mất điểm oan.
    const voucherDiscount = vouchers * REWARD_VOUCHER_AMOUNT;
    if (voucherDiscount > subtotal - firstDiscount) {
      throw new HttpError(400,
        `Đơn còn ${(subtotal - firstDiscount).toLocaleString('vi-VN')}đ, chưa đủ để dùng ${vouchers} voucher ${REWARD_VOUCHER_AMOUNT.toLocaleString('vi-VN')}đ.`,
        { rewards: 'Bớt voucher hoặc thêm hàng.' });
    }
    // orders.discount là TỔNG tiền giảm (đơn đầu + voucher); voucher_discount là phần voucher.
    const discount = firstDiscount + voucherDiscount;
    const total = subtotal - discount;
    const pointsUsed = rewardCount * RETAIL_POINTS_PER_REWARD;
    if (pointsUsed > 0) spendPoints(pointsPhone, pointsUsed);

    const orderId = insOrder.run(
      userId, receiverName, customerPhone, deliveryAddress,
      customerNote, paymentMethod, subtotal, discount, total, deliverySlot, lat, lng,
      voucherDiscount, pointsUsed, pointsUsed > 0 ? pointsPhone : null, guest ? 1 : 0, guestTokenHash
    ).lastInsertRowid;
    // Mã đơn tự tạo từ số thứ tự: DH000123, cùng kiểu mã hoá đơn quầy HD000123.
    db.prepare('UPDATE orders SET code = ? WHERE id = ?').run(orderCode(orderId), orderId);

    for (const { product, quantity } of lines) {
      const changed = decStock.run(quantity, product.id, quantity).changes;
      if (!changed) {
        throw new HttpError(409, `“${product.name}” vừa được mua hết. Vui lòng thử lại.`);
      }
      insItem.run(orderId, product.id, product.name, product.unit, product.price, quantity,
        product.cost_price ?? 0, product.points_per_unit ?? null, 0);
    }
    for (const { product, quantity } of rewardLines) {
      const changed = decStock.run(quantity, product.id, quantity).changes;
      if (!changed) {
        throw new HttpError(409, `Quà “${product.name}” vừa hết hàng. Vui lòng chọn quà khác.`);
      }
      // Quà ghi giá 0 nhưng giữ giá vốn để báo cáo lãi không bị thổi phồng.
      insItem.run(orderId, product.id, product.name, product.unit, 0, quantity,
        product.cost_price ?? 0, 0, 1);
    }

    // Ghi nhớ địa chỉ mặc định nếu tài khoản chưa có (đơn mua nhanh không có tài khoản riêng).
    if (!guest) {
      db.prepare('UPDATE users SET address = COALESCE(address, ?) WHERE id = ?').run(deliveryAddress, userId);
    }
    return orderId;
  })();
}

/**
 * Ưu đãi đơn đầu tiên đã dùng chưa: mỗi tài khoản một lần, và mỗi số điện thoại một lần.
 * - Có tài khoản: đã có đơn chưa huỷ của tài khoản, hoặc đơn mua nhanh mang số của tài khoản.
 * - Mua nhanh: số điện thoại này đã từng nhận đơn chưa huỷ, hoặc là số của một tài khoản đã mua.
 */
function firstOrderUsed({ userId, phone, guest }) {
  if (!guest) {
    const accountPhone = db.prepare('SELECT phone FROM users WHERE id = ?').get(userId)?.phone || '';
    return !!db.prepare(`
      SELECT 1 FROM orders
      WHERE status <> 'cancelled' AND (user_id = ? OR (is_guest = 1 AND ? <> '' AND phone = ?))
      LIMIT 1
    `).get(userId, accountPhone, accountPhone);
  }
  return !!db.prepare(`
    SELECT 1 FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status <> 'cancelled' AND (o.phone = ? OR u.phone = ?)
    LIMIT 1
  `).get(phone, phone);
}

/** Tài khoản hệ thống đứng tên đơn mua nhanh (tạo trong migration). */
function guestAccountId() {
  const row = db.prepare("SELECT id FROM users WHERE role = 'guest' ORDER BY id LIMIT 1").get();
  if (!row) throw new HttpError(503, 'Chức năng đặt hàng nhanh đang được cập nhật. Vui lòng đăng nhập để đặt hàng.');
  return row.id;
}

/** Kiểm tra thông tin nhận hàng gõ tay (đơn mua nhanh, hoặc đơn cũ không dùng sổ địa chỉ). */
function readDelivery(body, errors) {
  const receiverName = cleanText(body.receiver_name, LIMITS.name);
  const rawAddress = cleanText(body.address, LIMITS.address);
  const paymentMethod = body.payment_method || 'cod';
  if (!receiverName || receiverName.length < 2) errors.receiver_name = 'Nhập tên người nhận.';
  if (!isPhone(body.phone)) errors.phone = 'Số điện thoại không hợp lệ (ví dụ 0912345678).';
  if (!rawAddress || rawAddress.length < 8) errors.address = 'Nhập địa chỉ giao hàng chi tiết.';
  else if (body.delivery_area !== DELIVERY_AREA_CODE || mentionsOtherProvince(rawAddress)) {
    errors.address = `Cửa hàng hiện chỉ giao hàng trong tỉnh ${DELIVERY_AREA_LABEL}.`;
  }
  if (body.delivery_slot != null && body.delivery_slot !== '' && !DELIVERY_SLOT_CODES.includes(body.delivery_slot)) {
    errors.delivery_slot = 'Khung giờ giao hàng không hợp lệ.';
  }
  if (!['cod', 'bank'].includes(paymentMethod)) errors.payment_method = 'Hình thức thanh toán không hợp lệ.';
  return { receiverName, rawAddress, paymentMethod };
}

/**
 * POST /api/orders/guest — Đặt hàng nhanh, KHÔNG cần tài khoản.
 *  body: { receiver_name, phone, address, delivery_area, delivery_slot?, note?, payment_method?,
 *          items: [{product_id, quantity}], latitude?, longitude?, location_accuracy? }
 *  Không đổi điểm được (không xác minh được chủ số điện thoại), nhưng đơn giao xong vẫn tích
 *  điểm vào số điện thoại trên đơn. Trả về mã bí mật dùng một lần để gắn đơn vào tài khoản
 *  nếu khách tạo tài khoản ngay sau đó.
 */
router.post('/guest', validateRoutes('guest-orders'), (req, res, next) => {
  try {
    const body = req.body || {};
    const errors = {};
    const { receiverName, rawAddress, paymentMethod } = readDelivery(body, errors);
    const location = readLocation(body, errors);
    if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);

    const wanted = normalizeItems(body.items, GUEST_MAX_QTY_PER_LINE);
    const guestId = guestAccountId();
    const token = randomBytes(24).toString('hex');
    const orderId = placeOrder({
      userId: guestId,
      guest: true,
      receiverName,
      customerPhone: normalizePhone(body.phone),
      deliveryAddress: normalizeBacNinhAddress(rawAddress),
      customerNote: cleanText(body.note, LIMITS.note),
      paymentMethod,
      deliverySlot: DELIVERY_SLOT_CODES.includes(body.delivery_slot) ? body.delivery_slot : null,
      lat: location?.latitude ?? null,
      lng: location?.longitude ?? null,
      wanted,
      guestTokenHash: createHash('sha256').update(token).digest('hex'),
    });
    res.status(201).json({ order: getOrderForUser(orderId, guestId), guest_token: token });
  } catch (err) {
    next(err);
  }
});

// Mọi tuyến bên dưới cần đăng nhập.
router.use(requireAuth);
router.use(validateRoutes('orders'));

/** POST /api/orders — Tạo đơn hàng
 *  body: { address_id?, receiver_name?, phone?, address?, delivery_area, delivery_slot?, note?,
 *          payment_method?, items: [{product_id, quantity}],
 *          voucher_count?, rewards?: [{product_id, quantity}] }
 *  Mỗi voucher (giảm 30.000đ) hoặc mỗi phần quà 1kg trừ 1.000 điểm của số điện thoại
 *  đăng nhập. Điểm bị trừ ngay khi đặt và được hoàn lại nếu đơn bị huỷ.
 *  Khi có address_id, thông tin nhận hàng được đọc từ sổ địa chỉ của chính người dùng.
 */
router.post('/', requireAuth, (req, res, next) => {
  try {
    const { address_id, delivery_slot, note, items, voucher_count, rewards } = req.body || {};
    const errors = {};

    const addressId = address_id == null ? null : toInteger(address_id, { min: 1 });
    if (address_id != null && !addressId) errors.address_id = 'Địa chỉ giao hàng không hợp lệ.';
    const savedAddress = addressId
      ? db.prepare(`
          SELECT receiver_name, phone, address, latitude, longitude FROM delivery_addresses
          WHERE id = ? AND user_id = ?
        `).get(addressId, req.user.id)
      : null;
    if (addressId && !savedAddress) errors.address_id = 'Địa chỉ đã bị xoá hoặc không thuộc tài khoản này.';

    const delivery = savedAddress
      ? { ...req.body, receiver_name: savedAddress.receiver_name, phone: savedAddress.phone, address: savedAddress.address }
      : req.body || {};
    const { receiverName, rawAddress, paymentMethod } = readDelivery(delivery, errors);
    if (Object.keys(errors).length) {
      throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
    }

    const wanted = normalizeItems(items);
    const vouchers = voucher_count == null || voucher_count === '' ? 0
      : toInteger(voucher_count, { min: 0, max: MAX_REWARDS_PER_SALE });
    if (vouchers == null) throw new HttpError(400, 'Số voucher không hợp lệ.');
    const wantedRewards = normalizeRewardLines(rewards);
    const rewardCount = vouchers + [...wantedRewards.values()].reduce((sum, q) => sum + q, 0);
    if (rewardCount > MAX_REWARDS_PER_SALE) {
      throw new HttpError(400, `Mỗi đơn đổi tối đa ${MAX_REWARDS_PER_SALE} phần quà.`);
    }
    // Điểm thuộc về SỐ ĐIỆN THOẠI CỦA TÀI KHOẢN, giống lúc cộng điểm khi đơn giao xong.
    const pointsPhone = rewardCount > 0
      ? normalizePhone(db.prepare('SELECT phone FROM users WHERE id = ?').get(req.user.id)?.phone)
      : null;
    if (rewardCount > 0 && !pointsPhone) {
      throw new HttpError(400, 'Tài khoản chưa có số điện thoại nên chưa dùng được điểm tích luỹ.');
    }

    const orderId = placeOrder({
      userId: req.user.id,
      receiverName,
      customerPhone: normalizePhone(delivery.phone),
      deliveryAddress: normalizeBacNinhAddress(rawAddress),
      customerNote: cleanText(note, LIMITS.note),
      paymentMethod,
      deliverySlot: DELIVERY_SLOT_CODES.includes(delivery_slot) ? delivery_slot : null,
      lat: savedAddress?.latitude ?? null,
      lng: savedAddress?.longitude ?? null,
      wanted,
      wantedRewards,
      vouchers,
      pointsPhone,
    });
    res.status(201).json({ order: getOrderForUser(orderId, req.user.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/discount — tài khoản này còn được giảm giá đơn đầu tiên không.
 * Chỉ để giỏ hàng hiển thị trước cho khách; máy chủ vẫn tự quyết khi tạo đơn.
 * Khai báo trước '/:id' để không bị nuốt bởi tuyến đó.
 */
router.get('/discount', requireAuth, (req, res) => {
  const boughtBefore = firstOrderUsed({ userId: req.user.id });
  // Điểm tích luỹ và danh sách quà để trang đặt hàng cho khách đổi điểm.
  const phone = db.prepare('SELECT phone FROM users WHERE id = ?').get(req.user.id)?.phone;
  const points = loyaltyProfile(phone)?.points ?? 0;
  res.json({
    available: !boughtBefore,
    amount: FIRST_ORDER_DISCOUNT,
    points,
    pointsPerReward: RETAIL_POINTS_PER_REWARD,
    voucherAmount: REWARD_VOUCHER_AMOUNT,
    rewards: db.prepare(`
      SELECT id, name, unit, image_url, stock FROM products
      WHERE is_reward = 1 AND is_active = 1 AND stock > 0 ORDER BY id
    `).all(),
  });
});

/** GET /api/orders — Lịch sử đơn hàng của tôi */
router.get('/', requireAuth, (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
    .all(req.user.id);
  const items = db.prepare(`SELECT ${ORDER_ITEM_COLUMNS} FROM order_items
    WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)
    ORDER BY order_id, id`).all(req.user.id);
  for (const order of orders) delete order.guest_token_hash;
  res.json({ orders: attachItems(orders, items, 'order_id') });
});

/** PATCH /api/orders/:id/cancel — Khách tự huỷ khi đơn còn chờ xác nhận */
router.patch('/:id/cancel', requireAuth, (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    if (!orderId) throw new HttpError(404, 'Không tìm thấy đơn hàng.');

    // Chỉ đổi trạng thái khi đơn vẫn đang 'pending'. Nhờ vậy hai request huỷ
    // song song chỉ có đúng một request hoàn kho.
    const cancel = db.transaction(() => {
      const order = db
        .prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?')
        .get(orderId, req.user.id);
      if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng.');

      const changed = db
        .prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'")
        .run(order.id).changes;
      if (!changed) {
        throw new HttpError(400, 'Chỉ có thể tự huỷ đơn đang chờ xác nhận. Vui lòng liên hệ cửa hàng.');
      }
      restoreStockForOrder(order.id);
    });

    cancel();
    res.json({ order: getOrderForUser(orderId, req.user.id) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/orders/:id — Chi tiết 1 đơn của tôi */
router.get('/:id', requireAuth, (req, res, next) => {
  try {
    const orderId = toInteger(req.params.id, { min: 1 });
    const order = orderId ? getOrderForUser(orderId, req.user.id) : null;
    if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

/**
 * Huỷ đơn: trả số lượng (cả quà) về kho và hoàn điểm đã dùng để đổi quà/voucher.
 * Luôn gọi bên trong transaction đã khoá trạng thái đơn (UPDATE ... WHERE status = ?),
 * nên mỗi đơn chỉ được hoàn kho và hoàn điểm đúng một lần.
 */
export function restoreStockForOrder(orderId) {
  const items = db
    .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
    .all(orderId);
  const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const item of items) {
    if (item.product_id) restore.run(item.quantity, item.product_id);
  }
  const order = db.prepare('SELECT points_used, points_phone FROM orders WHERE id = ?').get(orderId);
  if (order?.points_used > 0) refundPoints(order.points_phone, order.points_used);
}

function getOrderForUser(orderId, userId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  if (!order) return null;
  delete order.guest_token_hash;
  order.items = db
    .prepare(`SELECT ${ORDER_ITEM_COLUMNS} FROM order_items WHERE order_id = ? ORDER BY id`)
    .all(order.id);
  return order;
}

export default router;
