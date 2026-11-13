import db from './db.js';

/**
 * Hai kho (13/11/2026).
 *  - KH_NC  Cửa hàng Nguyễn Cao: kho bán lẻ. Tồn nằm ở `products.stock` — đơn trên web, đơn nhân viên
 *    tạo cho khách lẻ và hoá đơn bán tại quầy đều trừ ở đây.
 *  - KH_BS  Kho Bồ Sơn: kho tổng. Tồn nằm ở `products.stock_bs` — nhận công gạo, xuất bán sỉ.
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

export const isWarehouse = (code) => Object.hasOwn(COLUMN, code);
export const warehouseName = (code) => WAREHOUSES.find((w) => w.code === code)?.name || code;
/** Tên cột tồn của một kho. Chỉ trả về tên trong danh sách cố định ở trên. */
export function stockColumn(code) {
  if (!isWarehouse(code)) throw new Error(`Kho không hợp lệ: ${code}`);
  return COLUMN[code];
}

/** Từ mức này trở xuống, bảng tồn kho báo "Sắp hết ở cửa hàng". */
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
};
/** Nhóm để lọc nhật ký kho. */
export const MOVEMENT_GROUPS = {
  in: ['opening', 'receipt'],
  transfer: ['transfer_out', 'transfer_in', 'transfer_cancel'],
  sale: ['order', 'order_wholesale', 'order_cancel', 'counter'],
  count: ['count', 'edit'],
};

/**
 * Đổi tồn của một sản phẩm ở một kho và ghi nhật ký. PHẢI gọi bên trong `db.transaction()`.
 *
 * `strict` (mặc định): khi xuất (`delta < 0`) mà kho không đủ hàng thì không đổi gì và trả về false,
 * để nơi gọi huỷ cả giao dịch — không bao giờ bán vượt tồn. `strict: false` dùng cho bán tại quầy và
 * kiểm kê, nơi số trên máy phải theo hàng thật (tồn được phép âm, bảng tồn kho sẽ báo đỏ).
 */
export function moveStock({ productId, warehouse, delta, kind, ref = null, note = null, actor = null, strict = true }) {
  const column = stockColumn(warehouse);
  if (!Number.isInteger(delta)) throw new Error('Số lượng thay đổi tồn phải là số nguyên.');
  if (!Object.hasOwn(MOVEMENT_KINDS, kind)) throw new Error(`Loại biến động kho không hợp lệ: ${kind}`);
  let changed = 1;
  if (delta < 0 && strict) {
    changed = db.prepare(`UPDATE products SET ${column} = ${column} - ? WHERE id = ? AND ${column} >= ?`)
      .run(-delta, productId, -delta).changes;
  } else if (delta !== 0) {
    changed = db.prepare(`UPDATE products SET ${column} = ${column} + ? WHERE id = ?`).run(delta, productId).changes;
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

/** Trạng thái cảnh báo của một dòng trong bảng tồn kho. */
export function stockStatus({ stock_nc: nc, stock_bs: bs, moving_to_nc: moving = 0 }) {
  if (nc < 0 || bs < 0) return { level: 'red', code: 'negative', label: 'Âm kho, cần kiểm kê' };
  if (nc + bs <= 0) return { level: 'red', code: 'out', label: moving > 0 ? 'Hết hàng, đang chuyển về' : 'Hết hàng, cần nhập' };
  if (nc <= 0) return { level: 'blue', code: 'main_only', label: moving > 0 ? 'Đang chuyển về cửa hàng' : 'Chỉ có ở kho Bồ Sơn' };
  if (nc <= LOW_STOCK_AT) return { level: 'yellow', code: 'low', label: 'Sắp hết ở cửa hàng' };
  return { level: 'green', code: 'ok', label: 'Đủ hàng' };
}

export const receiptCode = (id) => `NK${String(id).padStart(6, '0')}`;
export const transferCode = (id) => `DC${String(id).padStart(6, '0')}`;
