import db from './db.js';

/**
 * Hai kho (13/11/2026, đổi vai 18/11/2026).
 *  - KH_BS  Kho Bồ Sơn: kho bán online. Tồn nằm ở `products.stock_bs` — đây là số khách thấy trên web;
 *    đơn khách đặt trên web và đơn nhân viên tạo (mặc định) đều trừ ở đây. Nhận công gạo, xuất bán sỉ.
 *  - KH_NC  Cửa hàng Nguyễn Cao: chỉ bán cho khách tới mua tại cửa hàng. Tồn nằm ở `products.stock` —
 *    hoá đơn bán tại quầy trừ ở đây.
 *
 * MỌI thay đổi tồn kho đi qua `moveStock`, hàm này vừa đổi số tồn vừa ghi một dòng vào
 * `stock_movements` (ai, lúc nào, kho nào, bao nhiêu, tồn sau đó). Nhờ vậy:
 *    tồn hiện tại của một kho = tổng `quantity` của mọi dòng nhật ký thuộc kho đó
 * tức đúng công thức: tồn đầu kỳ + nhập + chuyển đến − chuyển đi − bán.
 */
export const STORE = 'KH_NC';
export const MAIN = 'KH_BS';
export const WAREHOUSES = [
  { code: STORE, name: 'Cửa hàng Nguyễn Cao', short: 'Nguyễn Cao', kind: 'store' },
  { code: MAIN, name: 'Kho Bồ Sơn', short: 'Bồ Sơn', kind: 'main' },
];
const COLUMN = { [STORE]: 'stock', [MAIN]: 'stock_bs' };
/** Kho bán online MẶC ĐỊNH: số tồn khách thấy trên web và kho đơn web trừ hàng (18/11/2026: Kho Bồ Sơn). */
export const ONLINE = MAIN;
export const ONLINE_COLUMN = COLUMN[ONLINE];
/**
 * Từng sản phẩm chọn được kho bán online (19/11/2026, cột products.online_warehouse): hàng đã chuyển sang
 * Cửa hàng Nguyễn Cao mà vẫn muốn khách mua trên web thì đặt KH_NC.
 *  - onlineWarehouseOf(product): 'KH_BS' | 'KH_NC'
 *  - ONLINE_STOCK_SQL: biểu thức SQL tồn bán online (dùng được với bí danh bảng qua onlineStockSql('p.')).
 */
// 25/11/2026: bỏ cột "Đơn web trừ ở" — đơn khách đặt trên web LUÔN trừ ở Kho Bồ Sơn (cột online_warehouse cũ không
// còn dùng). Kho hết thì vẫn nhận đơn; kế toán tạo "lệnh lấy hàng ở cửa hàng" cho đơn (store_pickups bên dưới).
export const onlineWarehouseOf = () => MAIN;
/**
 * 24/11/2026: khách thấy trên web TỔNG tồn của cả hai nơi (cửa hàng + kho). Đơn vẫn trừ ở kho của sản phẩm
 * (cột "Bán web từ", mặc định Kho Bồ Sơn) hoặc kho nhân viên chọn khi tạo đơn; kho đó thiếu thì vẫn nhận đơn
 * (tồn kho đó âm) và thẻ đơn báo kế toán điều chuyển từ nơi kia sang / để shipper qua cửa hàng lấy.
 */
export const onlineStockSql = (prefix = '') => `(${prefix}stock + ${prefix}stock_bs)`;
export const ONLINE_STOCK_SQL = onlineStockSql();

export const isWarehouse = (code) => Object.hasOwn(COLUMN, code);

/*
 * Số lượng trong kho được phép lẻ (18/11/2026): kho nhập bao to rồi đóng ra túi, nên nhập theo kg — ví dụ
 * 582 kg gạo bao 10kg = 58,2 bao. Giữ tối đa 3 chữ số thập phân, làm tròn mọi phép cộng trừ để không lệch.
 */
export const QTY_DECIMALS = 3;
export const roundQty = (n) => Math.round(n * 10 ** QTY_DECIMALS) / 10 ** QTY_DECIMALS;
/** "58,2" / "58.2" / 58.2 → 58.2; sai dạng, âm hoặc ngoài khoảng → null. */
export function toQty(value, { min = 0, max = 1_000_000 } = {}) {
  if (value === '' || value == null) return null;
  const text = typeof value === 'number' ? String(value) : String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = roundQty(Number(text));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
export const warehouseName = (code) => WAREHOUSES.find((w) => w.code === code)?.name || code;
/** Tên cột tồn của một kho. Chỉ trả về tên trong danh sách cố định ở trên. */
export function stockColumn(code) {
  if (!isWarehouse(code)) throw new Error(`Kho không hợp lệ: ${code}`);
  return COLUMN[code];
}

/** Từ mức này trở xuống, bảng tồn kho báo "Sắp hết". */
export const LOW_STOCK_AT = 20;

export const MOVEMENT_KINDS = {
  opening: 'Tồn đầu kỳ',
  receipt: 'Nhập kho',
  transfer_out: 'Chuyển đi',
  transfer_in: 'Nhận hàng chuyển đến',
  transfer_cancel: 'Huỷ lệnh chuyển, trả về kho xuất',
  order: 'Đơn hàng',
  order_wholesale: 'Đơn khách buôn',
  order_cancel: 'Huỷ đơn, hoàn kho',
  counter: 'Bán tại quầy',
  count: 'Kiểm kê',
  edit: 'Sửa tồn ở trang Sản phẩm',
  order_return: 'Khách trả hàng, nhập lại kho',
  pickup_out: 'Xuất cho đơn giao (shipper lấy tại cửa hàng)',
  pickup_cover: 'Bù hàng thiếu cho đơn (lấy ở cửa hàng)',
};
/** Nhóm để lọc nhật ký kho. */
export const MOVEMENT_GROUPS = {
  in: ['opening', 'receipt'],
  transfer: ['transfer_out', 'transfer_in', 'transfer_cancel', 'pickup_out', 'pickup_cover'],
  sale: ['order', 'order_wholesale', 'order_cancel', 'counter', 'order_return'],
  count: ['count', 'edit'],
};

/**
 * Đổi tồn của một sản phẩm ở một kho và ghi nhật ký. PHẢI gọi bên trong `db.transaction()`.
 *
 * `strict` (mặc định): khi xuất (`delta < 0`) mà kho không đủ hàng thì không đổi gì và trả về false,
 * để nơi gọi huỷ cả giao dịch — không bao giờ bán vượt tồn. `strict: false` dùng cho bán tại quầy và
 * kiểm kê, nơi số trên máy phải theo hàng thật (tồn được phép âm, bảng tồn kho sẽ báo đỏ).
 */
export function moveStock({ productId, warehouse, delta, kind, ref = null, note = null, actor = null, strict = true, totalGuard = false }) {
  const column = stockColumn(warehouse);
  if (!Number.isFinite(delta)) throw new Error('Số lượng thay đổi tồn không hợp lệ.');
  delta = roundQty(delta);
  if (!Object.hasOwn(MOVEMENT_KINDS, kind)) throw new Error(`Loại biến động kho không hợp lệ: ${kind}`);
  let changed = 1;
  if (delta < 0 && totalGuard) {
    // Đơn hàng (24/11/2026): trừ ở kho của đơn, chỉ cần TỔNG hai nơi còn đủ (kho đó được phép âm).
    changed = db.prepare(`UPDATE products SET ${column} = ROUND(${column} - ?, ${QTY_DECIMALS}) WHERE id = ? AND stock + stock_bs >= ?`)
      .run(-delta, productId, -delta).changes;
  } else if (delta < 0 && strict) {
    changed = db.prepare(`UPDATE products SET ${column} = ROUND(${column} - ?, ${QTY_DECIMALS}) WHERE id = ? AND ${column} >= ?`)
      .run(-delta, productId, -delta).changes;
  } else if (delta !== 0) {
    changed = db.prepare(`UPDATE products SET ${column} = ROUND(${column} + ?, ${QTY_DECIMALS}) WHERE id = ?`).run(delta, productId).changes;
  }
  if (!changed) return false;
  db.prepare(`
    INSERT INTO stock_movements
      (product_id, product_name, unit, warehouse, kind, quantity, balance_after, ref_type, ref_id, ref_code,
       note, created_by, actor_name)
    SELECT id, name, unit, ?, ?, ?, ${column}, ?, ?, ?, ?, ?, ? FROM products WHERE id = ?
  `).run(warehouse, kind, delta, ref?.type ?? null, ref?.id ?? null, ref?.code ?? null, note,
    actor?.id ?? null, actor?.full_name ?? null, productId);
  return true;
}

/** Số lượng đang trên đường (lệnh chuyển chưa xác nhận nhận), theo sản phẩm và kho nhận. */
export function inTransitByProduct() {
  const rows = db.prepare(`
    SELECT i.product_id, t.to_warehouse AS warehouse, SUM(i.quantity) AS quantity
    FROM stock_transfer_items i JOIN stock_transfers t ON t.id = i.transfer_id
    WHERE t.status = 'in_transit' AND i.product_id IS NOT NULL
    GROUP BY i.product_id, t.to_warehouse
  `).all();
  const map = new Map();
  for (const row of rows) {
    const entry = map.get(row.product_id) || { [STORE]: 0, [MAIN]: 0 };
    entry[row.warehouse] = row.quantity;
    map.set(row.product_id, entry);
  }
  return map;
}

/**
 * Trạng thái cảnh báo của một dòng trong bảng tồn kho (24/11/2026): tính theo TỔNG cửa hàng + kho — đúng số khách
 * thấy trên web. Riêng một nơi bị âm (đơn đã nhận khi nơi đó thiếu) thì báo điều chuyển từ nơi kia sang.
 */
export function stockStatus({ stock_nc: nc, stock_bs: bs, moving_to_nc: toNc = 0, moving_to_bs: toBs = 0 }) {
  const total = nc + bs;
  if (total <= 0) return { level: 'red', code: 'out', label: toNc + toBs > 0 ? 'Hết hàng, đang chuyển về' : 'Hết hàng, cần nhập' };
  if (nc < 0 || bs < 0) {
    // Âm do đơn đã nhận khi nơi đó thiếu, hoặc quầy bán khi số trên máy chưa khớp hàng thật.
    return { level: 'red', code: 'negative', label: `${nc < 0 ? 'Cửa hàng' : 'Bồ Sơn'} âm kho — điều chuyển từ ${nc < 0 ? 'Bồ Sơn' : 'cửa hàng'} hoặc kiểm kê` };
  }
  if (total <= LOW_STOCK_AT) return { level: 'yellow', code: 'low', label: 'Sắp hết' };
  return { level: 'green', code: 'ok', label: 'Đủ hàng' };
}

export const receiptCode = (id) => `NK${String(id).padStart(6, '0')}`;
export const transferCode = (id) => `DC${String(id).padStart(6, '0')}`;
export const pickupCode = (id) => `LH${String(id).padStart(6, '0')}`;
