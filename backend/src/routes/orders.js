import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  DELIVERY_AREA_CODE, DELIVERY_AREA_LABEL, DELIVERY_SLOT_CODES, LIMITS,
  mentionsOtherProvince, normalizeBacNinhAddress, retailDiscountFor,
} from '../constants.js';
import { HttpError, cleanText, isPhone, normalizePhone, toInteger } from '../validate.js';

const router = Router();
router.use(requireAuth);
router.use(validateRoutes('orders'));

/** Cột dòng hàng được phép trả cho khách. KHÔNG gồm cost_price (giá nhập, chỉ cửa hàng thấy). */
const ORDER_ITEM_COLUMNS = 'id, order_id, product_id, product_name, unit, price, quantity';

/** Gộp các dòng trùng sản phẩm rồi kiểm tra số lượng. */
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Giỏ hàng đang trống.', { items: 'Giỏ hàng đang trống.' });
  }
  if (items.length > LIMITS.linesPerOrder) {
    throw new HttpError(400, `Một đơn chỉ đặt tối đa ${LIMITS.linesPerOrder} loại gạo.`);
  }

  const merged = new Map();
  for (const line of items) {
    const productId = toInteger(line?.product_id, { min: 1 });
    const quantity = toInteger(line?.quantity, { min: 1, max: LIMITS.quantityPerLine });
    if (!productId) throw new HttpError(400, 'Sản phẩm trong giỏ không hợp lệ.');
    if (!quantity) {
      throw new HttpError(400, `Số lượng phải là số nguyên từ 1 đến ${LIMITS.quantityPerLine}.`);
    }
    const total = (merged.get(productId) || 0) + quantity;
    if (total > LIMITS.quantityPerLine) {
      throw new HttpError(400, `Số lượng mỗi loại gạo tối đa ${LIMITS.quantityPerLine}.`);
    }
    merged.set(productId, total);
  }
  return merged;
}

/** POST /api/orders — Tạo đơn hàng
 *  body: { address_id?, receiver_name?, phone?, address?, delivery_area, delivery_slot?, note?,
 *          payment_method?, items: [{product_id, quantity}] }
 *  Khi có address_id, thông tin nhận hàng được đọc từ sổ địa chỉ của chính người dùng.
 *  Giá và tổng tiền luôn do máy chủ tự tính, không tin dữ liệu gửi từ trình duyệt.
 */
router.post('/', requireAuth, (req, res, next) => {
  try {
    const {
      address_id, receiver_name, phone, address, delivery_area,
      delivery_slot, note, payment_method, items,
    } = req.body || {};
    const errors = {};

    const addressId = address_id == null ? null : toInteger(address_id, { min: 1 });
    if (address_id != null && !addressId) errors.address_id = 'Địa chỉ giao hàng không hợp lệ.';
    const savedAddress = addressId
      ? db.prepare(`
          SELECT receiver_name, phone, address FROM delivery_addresses
          WHERE id = ? AND user_id = ?
        `).get(addressId, req.user.id)
      : null;
    if (addressId && !savedAddress) errors.address_id = 'Địa chỉ đã bị xoá hoặc không thuộc tài khoản này.';

    const receiverName = cleanText(savedAddress?.receiver_name ?? receiver_name, LIMITS.name);
    const receiverPhone = savedAddress?.phone ?? phone;
    const rawAddress = cleanText(savedAddress?.address ?? address, LIMITS.address);
    const paymentMethod = payment_method || 'cod';

    if (!receiverName || receiverName.length < 2) errors.receiver_name = 'Nhập tên người nhận.';
    if (!isPhone(receiverPhone)) errors.phone = 'Số điện thoại không hợp lệ (ví dụ 0912345678).';
    if (!rawAddress || rawAddress.length < 8) errors.address = 'Nhập địa chỉ giao hàng chi tiết.';
    else if (delivery_area !== DELIVERY_AREA_CODE || mentionsOtherProvince(rawAddress)) {
      errors.address = `Cửa hàng hiện chỉ giao hàng trong tỉnh ${DELIVERY_AREA_LABEL}.`;
    }
    if (delivery_slot != null && delivery_slot !== '' && !DELIVERY_SLOT_CODES.includes(delivery_slot)) {
      errors.delivery_slot = 'Khung giờ giao hàng không hợp lệ.';
    }
    if (!['cod', 'bank'].includes(paymentMethod)) {
      errors.payment_method = 'Hình thức thanh toán không hợp lệ.';
    }
    if (Object.keys(errors).length) {
      throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
    }

    const wanted = normalizeItems(items);
    const deliveryAddress = normalizeBacNinhAddress(rawAddress);
    const customerNote = cleanText(note, LIMITS.note);
    const customerPhone = normalizePhone(receiverPhone);
    const deliverySlot = DELIVERY_SLOT_CODES.includes(delivery_slot) ? delivery_slot : null;

    const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1');
    const insOrder = db.prepare(
      `INSERT INTO orders (user_id, receiver_name, phone, address, note, payment_method,
                           subtotal, discount, total, delivery_slot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit, price, quantity, cost_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // Trừ kho có điều kiện: nếu người khác vừa mua trước thì không dòng nào đổi
    // và cả transaction bị huỷ bỏ, tránh bán vượt tồn kho.
    const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');

    // Đọc giá, kiểm tra tồn kho, tạo đơn và trừ kho trong cùng một transaction.
    const createOrder = db.transaction(() => {
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

      // Đơn online hưởng cùng mốc giảm giá với mua tại quầy.
      const discount = retailDiscountFor(subtotal);
      const total = subtotal - discount;

      const orderId = insOrder.run(
        req.user.id, receiverName, customerPhone, deliveryAddress,
        customerNote, paymentMethod, subtotal, discount, total, deliverySlot
      ).lastInsertRowid;

      for (const { product, quantity } of lines) {
        const changed = decStock.run(quantity, product.id, quantity).changes;
        if (!changed) {
          throw new HttpError(409, `“${product.name}” vừa được mua hết. Vui lòng thử lại.`);
        }
        insItem.run(orderId, product.id, product.name, product.unit, product.price, quantity, product.cost_price ?? 0);
      }

      // Ghi nhớ SĐT / địa chỉ mặc định nếu tài khoản chưa có.
      db.prepare(
        'UPDATE users SET address = COALESCE(address, ?) WHERE id = ?'
      ).run(deliveryAddress, req.user.id);

      return orderId;
    });

    const orderId = createOrder();
    res.status(201).json({ order: getOrderForUser(orderId, req.user.id) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/orders — Lịch sử đơn hàng của tôi */
router.get('/', requireAuth, (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
    .all(req.user.id);
  const getItems = db.prepare(`SELECT ${ORDER_ITEM_COLUMNS} FROM order_items WHERE order_id = ? ORDER BY id`);
  res.json({ orders: orders.map((o) => ({ ...o, items: getItems.all(o.id) })) });
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

/** Trả số lượng về kho. Luôn gọi bên trong transaction đã khoá trạng thái đơn. */
export function restoreStockForOrder(orderId) {
  const items = db
    .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
    .all(orderId);
  const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const item of items) {
    if (item.product_id) restore.run(item.quantity, item.product_id);
  }
}

function getOrderForUser(orderId, userId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  if (!order) return null;
  order.items = db
    .prepare(`SELECT ${ORDER_ITEM_COLUMNS} FROM order_items WHERE order_id = ? ORDER BY id`)
    .all(order.id);
  return order;
}

export default router;
