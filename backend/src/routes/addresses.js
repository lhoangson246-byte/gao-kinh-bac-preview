import { validateRoutes } from '../schemas.js';
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  DELIVERY_AREA_LABEL, LIMITS, mentionsOtherProvince, normalizeBacNinhAddress,
} from '../constants.js';
import { HttpError, cleanText, isPhone, normalizePhone, toInteger } from '../validate.js';

const router = Router();
router.use(requireAuth);
router.use(validateRoutes('addresses'));
const MAX_ADDRESSES = 10;

function listForUser(userId) {
  return db.prepare(`
    SELECT id, label, receiver_name, phone, address, is_default, latitude, longitude,
           location_accuracy, created_at, updated_at
    FROM delivery_addresses
    WHERE user_id = ?
    ORDER BY is_default DESC, updated_at DESC, id DESC
  `).all(userId);
}

function addressForUser(id, userId) {
  return db.prepare(`
    SELECT id, label, receiver_name, phone, address, is_default, latitude, longitude,
           location_accuracy, created_at, updated_at
    FROM delivery_addresses WHERE id = ? AND user_id = ?
  `).get(id, userId);
}

function validateAddress(body = {}) {
  const errors = {};
  const receiverName = cleanText(body.receiver_name, LIMITS.name);
  const rawPhone = cleanText(body.phone, LIMITS.phone);
  const rawAddress = cleanText(body.address, LIMITS.address);
  const label = cleanText(body.label, 40) || 'Nhà riêng';

  if (!receiverName || receiverName.length < 2) errors.receiver_name = 'Nhập tên người nhận.';
  if (!isPhone(rawPhone)) errors.phone = 'Số điện thoại không hợp lệ (ví dụ 0912345678).';
  if (!rawAddress || rawAddress.length < 8) {
    errors.address = 'Nhập địa chỉ chi tiết: số nhà, đường/thôn, phường/xã.';
  } else if (mentionsOtherProvince(rawAddress)) {
    errors.address = `Cửa hàng hiện chỉ giao hàng trong tỉnh ${DELIVERY_AREA_LABEL}.`;
  }
  const location = readLocation(body, errors);
  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);

  return {
    label,
    receiver_name: receiverName,
    phone: normalizePhone(rawPhone),
    address: normalizeBacNinhAddress(rawAddress),
    location,
  };
}

/**
 * Vị trí khách tự ghim bằng GPS điện thoại (không bắt buộc).
 * Trả về undefined khi không gửi (giữ nguyên vị trí cũ), null khi khách bỏ vị trí,
 * hoặc { latitude, longitude, accuracy }.
 */
function readLocation(body, errors) {
  if (body.latitude === undefined && body.longitude === undefined) return undefined;
  if (body.latitude === null && body.longitude === null) return null;
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    errors.location = 'Vị trí không hợp lệ. Vui lòng lấy lại vị trí.';
    return undefined;
  }
  const accuracy = Number(body.location_accuracy);
  // Làm tròn ~1 m: đủ để giao hàng, không lưu thừa độ chính xác.
  return {
    latitude: Math.round(latitude * 1e5) / 1e5,
    longitude: Math.round(longitude * 1e5) / 1e5,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
  };
}

/** Ghi vị trí cho một địa chỉ (gọi trong transaction). undefined = không đổi. */
function saveLocation(addressId, userId, location) {
  if (location === undefined) return;
  db.prepare(`
    UPDATE delivery_addresses SET latitude = ?, longitude = ?, location_accuracy = ?
    WHERE id = ? AND user_id = ?
  `).run(location?.latitude ?? null, location?.longitude ?? null, location?.accuracy ?? null, addressId, userId);
}

function makeDefault(addressId, userId) {
  const address = addressForUser(addressId, userId);
  if (!address) throw new HttpError(404, 'Không tìm thấy địa chỉ giao hàng.');

  db.prepare('UPDATE delivery_addresses SET is_default = 0 WHERE user_id = ?').run(userId);
  db.prepare(`
    UPDATE delivery_addresses SET is_default = 1, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(addressId, userId);
  // users.address được giữ như một trường tương thích cho phiên bản cũ.
  db.prepare('UPDATE users SET address = ? WHERE id = ?').run(address.address, userId);
}

/** GET /api/addresses — Sổ địa chỉ của tài khoản đang đăng nhập. */
router.get('/', requireAuth, (req, res) => {
  res.json({ addresses: listForUser(req.user.id) });
});

/** POST /api/addresses — Thêm địa chỉ; địa chỉ đầu tiên tự động là mặc định. */
router.post('/', requireAuth, (req, res, next) => {
  try {
    const data = validateAddress(req.body);
    const create = db.transaction(() => {
      // Đếm và thêm trong cùng transaction để các request song song không vượt giới hạn.
      const count = db.prepare('SELECT COUNT(*) count FROM delivery_addresses WHERE user_id = ?').get(req.user.id).count;
      if (count >= MAX_ADDRESSES) {
        throw new HttpError(400, `Bạn chỉ có thể lưu tối đa ${MAX_ADDRESSES} địa chỉ.`);
      }
      const shouldDefault = count === 0 || req.body?.is_default === true || req.body?.is_default === 1;
      if (shouldDefault) {
        db.prepare('UPDATE delivery_addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
      }
      const info = db.prepare(`
        INSERT INTO delivery_addresses (user_id, label, receiver_name, phone, address, is_default)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id, data.label, data.receiver_name, data.phone, data.address,
        shouldDefault ? 1 : 0
      );
      if (shouldDefault) {
        db.prepare('UPDATE users SET address = ? WHERE id = ?').run(data.address, req.user.id);
      }
      saveLocation(info.lastInsertRowid, req.user.id, data.location);
      return info.lastInsertRowid;
    });

    const id = create();
    res.status(201).json({ address: addressForUser(id, req.user.id), addresses: listForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/addresses/:id — Sửa một địa chỉ thuộc chính tài khoản. */
router.put('/:id', requireAuth, (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id || !addressForUser(id, req.user.id)) throw new HttpError(404, 'Không tìm thấy địa chỉ giao hàng.');
    const data = validateAddress(req.body);

    db.transaction(() => {
      db.prepare(`
        UPDATE delivery_addresses
        SET label = ?, receiver_name = ?, phone = ?,
            address = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(data.label, data.receiver_name, data.phone, data.address, id, req.user.id);
      saveLocation(id, req.user.id, data.location);
      if (req.body?.is_default === true || req.body?.is_default === 1) makeDefault(id, req.user.id);
      else if (addressForUser(id, req.user.id).is_default) {
        db.prepare('UPDATE users SET address = ? WHERE id = ?').run(data.address, req.user.id);
      }
    })();

    res.json({ address: addressForUser(id, req.user.id), addresses: listForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/addresses/:id/default — Chọn địa chỉ mặc định cho lần mua sau. */
router.patch('/:id/default', requireAuth, (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    if (!id) throw new HttpError(404, 'Không tìm thấy địa chỉ giao hàng.');
    db.transaction(() => makeDefault(id, req.user.id))();
    res.json({ address: addressForUser(id, req.user.id), addresses: listForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/addresses/:id — Xoá và tự chọn địa chỉ mặc định mới nếu cần. */
router.delete('/:id', requireAuth, (req, res, next) => {
  try {
    const id = toInteger(req.params.id, { min: 1 });
    const current = id ? addressForUser(id, req.user.id) : null;
    if (!current) throw new HttpError(404, 'Không tìm thấy địa chỉ giao hàng.');

    db.transaction(() => {
      db.prepare('DELETE FROM delivery_addresses WHERE id = ? AND user_id = ?').run(id, req.user.id);
      if (current.is_default) {
        const replacement = db.prepare(`
          SELECT id FROM delivery_addresses WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1
        `).get(req.user.id);
        if (replacement) makeDefault(replacement.id, req.user.id);
        else db.prepare('UPDATE users SET address = NULL WHERE id = ?').run(req.user.id);
      }
    })();

    res.json({ addresses: listForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

export default router;
