import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requirePermission } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText } from '../validate.js';
import { localDate } from '../constants.js';
import { writeAdminAudit } from '../audit.js';
import { DEBT_STATUS_LABEL, todayVN } from '../debts.js';
import { MAIN, STORE, warehouseName } from '../inventory.js';

/** Nơi đóng ngày: Kho Bồ Sơn hoặc Cửa hàng Nguyễn Cao (19/11/2026). Mặc định là kho. */
export const LOCATIONS = [MAIN, STORE];
const readLocation = (value) => {
  const loc = value || MAIN;
  if (!LOCATIONS.includes(loc)) throw new HttpError(400, 'Chọn nơi đóng ngày: Kho Bồ Sơn hoặc Cửa hàng Nguyễn Cao.', { location: 'Nơi đóng ngày không hợp lệ.' });
  return loc;
};

/**
 * /api/admin/closing — đóng ngày (end of day) cho kế toán (quyền xem doanh thu): doanh thu trong ngày
 * chia theo chuyển khoản / tiền mặt / công nợ, kê loại tiền mặt đếm được và chênh lệch. Lưu lại phiếu
 * để in và xem lại.
 *
 * Quy ước: đơn online tính vào ngày GIAO XONG (lúc tiền về); hoá đơn quầy và phiếu trả tính theo ngày
 * lập; tiền thu nợ tính theo ngày kế toán ký đã thu.
 *
 * Tách theo nơi (19/11/2026), người đóng chọn nơi: đơn online thuộc kho đã xuất hàng (orders.warehouse);
 * hoá đơn bán tại quầy và phiếu trả hàng thuộc Cửa hàng Nguyễn Cao; thu nợ theo kho của đơn nợ.
 */
const router = Router();
router.use(requireAuth, requirePermission('revenue.view'));
router.use(validateRoutes('closing'));

export const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

export function closingFigures(day, location = MAIN) {
  const store = location === STORE;
  const sum = (sql, ...args) => db.prepare(sql).get(...args);
  const online = db.prepare(`
    SELECT CASE WHEN payment_status = 'debt' THEN 'debt' WHEN payment_method = 'bank' THEN 'transfer' ELSE 'cash' END AS kind,
           COUNT(*) AS n, COALESCE(SUM(total), 0) AS s
    FROM orders WHERE status = 'completed' AND warehouse = ? AND ${localDate('COALESCE(completed_at, created_at)')} = ?
    GROUP BY kind
  `).all(location, day);
  // Bán tại quầy và trả hàng chỉ có ở cửa hàng.
  const retail = store ? db.prepare(`
    SELECT CASE WHEN payment_method = 'transfer' THEN 'transfer' ELSE 'cash' END AS kind, COUNT(*) AS n, COALESCE(SUM(total), 0) AS s
    FROM retail_invoices WHERE ${localDate('created_at')} = ? GROUP BY kind
  `).all(day) : [];
  const refunds = store ? db.prepare(`
    SELECT refund_method AS kind, COUNT(*) AS n, COALESCE(SUM(refund_amount), 0) AS s
    FROM retail_returns WHERE refund_method IN ('cash', 'transfer') AND ${localDate('created_at')} = ? GROUP BY kind
  `).all(day) : [];
  const collected = db.prepare(`
    SELECT r.paid_method AS kind, COUNT(*) AS n, COALESCE(SUM(r.amount), 0) AS s
    FROM debt_records r JOIN orders o ON o.id = r.order_id
    WHERE r.paid_at IS NOT NULL AND r.status IN ('paid_pending_final', 'settled') AND o.warehouse = ? AND ${localDate('r.paid_at')} = ?
    GROUP BY r.paid_method
  `).all(location, day);
  const pick = (rows, kind) => rows.find((r) => r.kind === kind) || { n: 0, s: 0 };
  const lines = {
    online_cash: pick(online, 'cash'), online_transfer: pick(online, 'transfer'), online_debt: pick(online, 'debt'),
    retail_cash: pick(retail, 'cash'), retail_transfer: pick(retail, 'transfer'),
    refund_cash: pick(refunds, 'cash'), refund_transfer: pick(refunds, 'transfer'),
    debt_collected_cash: pick(collected, 'cash'), debt_collected_transfer: pick(collected, 'transfer'),
  };
  const cash = lines.online_cash.s + lines.retail_cash.s - lines.refund_cash.s + lines.debt_collected_cash.s;
  const transfer = lines.online_transfer.s + lines.retail_transfer.s - lines.refund_transfer.s + lines.debt_collected_transfer.s;
  const revenue = lines.online_cash.s + lines.online_transfer.s + lines.online_debt.s
    + lines.retail_cash.s + lines.retail_transfer.s - lines.refund_cash.s - lines.refund_transfer.s;
  const debtOpen = sum(`SELECT COALESCE(SUM(r.amount), 0) AS s FROM debt_records r JOIN orders o ON o.id = r.order_id
    WHERE r.status IN ('pending_accounting', 'open', 'paid_pending_final') AND o.warehouse = ?`, location).s;
  return { day, location, location_name: warehouseName(location), lines, details: closingDetails(day, lines, location), totals: { revenue, cash, transfer, debt_new: lines.online_debt.s, debt_open: debtOpen } };
}

/** Tên khách hiện trên phiếu: tên công ty / khách buôn / người liên hệ công nợ, không có thì người nhận. */
const who = (r) => r.company || r.contact_name || r.receiver_name || r.customer_name || 'Khách lẻ';

/**
 * Bảng kê từng dòng cho phiếu đóng ngày (19/11/2026, theo mẫu bảng tính của kế toán):
 *  - debts: "Tổng nhà nợ ngày" — đơn giao xong trong ngày mà khách nợ.
 *  - transfers: "Tổng chuyển khoản" — đơn online, hoá đơn quầy, thu nợ bằng chuyển khoản (trừ hoàn tiền).
 *  - cash_in / cash_out: phần thu / chi tiền mặt máy tự tính; kế toán ghi thêm khoản thu / chi khác khi đóng.
 * Tổng mỗi bảng khớp đúng các con số trong `lines` / `totals`.
 */
function closingDetails(day, lines, location) {
  const ordersOf = (where) => db.prepare(`
    SELECT o.code, o.receiver_name, o.address, o.total AS amount, w.company, a.contact_name, a.company AS debt_company
    FROM orders o
    LEFT JOIN wholesale_customers w ON w.id = o.wholesale_customer_id
    LEFT JOIN debt_records r ON r.order_id = o.id
    LEFT JOIN debt_accounts a ON a.id = r.account_id
    WHERE o.status = 'completed' AND o.warehouse = ? AND ${localDate('COALESCE(o.completed_at, o.created_at)')} = ? AND ${where}
    ORDER BY COALESCE(o.completed_at, o.created_at), o.id
  `).all(location, day).map((r) => ({ code: r.code, name: who({ ...r, company: r.company || r.debt_company }), address: r.address || '', amount: r.amount }));
  const collected = (method) => db.prepare(`
    SELECT o.code, r.amount, a.contact_name, a.company FROM debt_records r
    JOIN orders o ON o.id = r.order_id JOIN debt_accounts a ON a.id = r.account_id
    WHERE r.paid_at IS NOT NULL AND r.status IN ('paid_pending_final', 'settled') AND r.paid_method = ? AND o.warehouse = ?
      AND ${localDate('r.paid_at')} = ?
    ORDER BY r.paid_at, r.id
  `).all(method, location, day).map((r) => ({ code: r.code, name: `Thu nợ: ${who(r)}`, address: '', amount: r.amount }));
  const retailTransfers = location !== STORE ? [] : db.prepare(`
    SELECT code, customer_name, customer_address, total AS amount FROM retail_invoices
    WHERE payment_method = 'transfer' AND ${localDate('created_at')} = ? ORDER BY created_at, id
  `).all(day).map((r) => ({ code: r.code, name: r.customer_name || 'Khách mua tại quầy', address: r.customer_address || '', amount: r.amount }));
  const group = (label, line, sign = 1) => (line.n ? [{ code: '', name: `${label} (${line.n})`, address: '', amount: sign * line.s }] : []);

  return {
    debts: ordersOf("o.payment_status = 'debt'"),
    transfers: [
      ...ordersOf("o.payment_status <> 'debt' AND o.payment_method = 'bank'"),
      ...retailTransfers,
      ...collected('transfer'),
      ...group('Trả hàng hoàn chuyển khoản', lines.refund_transfer, -1),
    ],
    cash_in: [
      ...ordersOf("o.payment_status <> 'debt' AND o.payment_method <> 'bank'"),
      ...group('Bán lẻ tại quầy, tiền mặt — số hoá đơn', lines.retail_cash),
      ...collected('cash'),
    ],
    cash_out: group('Trả hàng hoàn tiền mặt — số phiếu', lines.refund_cash),
  };
}

export const EXTRA_LIMIT = 50;
/** Khoản thu / chi tiền mặt kế toán ghi thêm (đổ xăng, mua đồ, tiền khác…): [{ type: 'in'|'out', label, amount }]. */
export function readExtras(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > EXTRA_LIMIT) throw new HttpError(400, `Tối đa ${EXTRA_LIMIT} khoản thu / chi thêm.`, { extras: 'Danh sách khoản thu / chi không hợp lệ.' });
  return list.map((row) => {
    const label = cleanText(row?.label, 120);
    const amount = Number(row?.amount);
    if (!['in', 'out'].includes(row?.type) || !label || !Number.isInteger(amount) || amount < 1 || amount > 10_000_000_000) {
      throw new HttpError(400, 'Mỗi khoản thu / chi cần ghi diễn giải và số tiền (số nguyên lớn hơn 0).', { extras: 'Ghi đủ diễn giải và số tiền.' });
    }
    return { type: row.type, label, amount };
  });
}
/** Tiền mặt phải có = tiền mặt máy tính + thu thêm − chi thêm. */
export const cashExpected = (figures, extras) => figures.totals.cash
  + extras.reduce((s, e) => s + (e.type === 'in' ? e.amount : -e.amount), 0);

/**
 * Đơn nợ còn chờ duyệt tính tới hết ngày `day`: kế toán chưa duyệt (hoặc bị trả lại) với ngày giao ≤ day,
 * hoặc đã ký thu tiền ≤ day mà mẹ chưa duyệt tất toán. Còn khoản nào thì chưa đóng ngày được.
 */
export function pendingDebts(day, location = MAIN) {
  return db.prepare(`
    SELECT r.id, r.status, r.amount, o.code, a.contact_name, a.company FROM debt_records r
    JOIN orders o ON o.id = r.order_id JOIN debt_accounts a ON a.id = r.account_id
    WHERE o.warehouse = ? AND ((r.status IN ('pending_accounting', 'rejected') AND r.delivered_on <= ?)
       OR (r.status = 'paid_pending_final' AND ${localDate('r.paid_at')} <= ?))
    ORDER BY r.id
  `).all(location, day, day).map((r) => ({ ...r, status_label: DEBT_STATUS_LABEL[r.status] }));
}

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

const savedSlip = (day, location) => db.prepare('SELECT data, closer_name, updated_at FROM location_closings WHERE day = ? AND location = ?').get(day, location);
const LOCATION_LIST = LOCATIONS.map((code) => ({ code, name: warehouseName(code) }));

/** GET /?day=YYYY-MM-DD&location=KH_BS|KH_NC — số liệu tính sẵn của một nơi + phiếu đã lưu (nếu có). */
router.get('/', (req, res, next) => {
  try {
    const day = req.query.day || todayVN();
    if (!isDay(day)) throw new HttpError(400, 'Ngày không hợp lệ.');
    const location = readLocation(req.query.location);
    const saved = savedSlip(day, location);
    // Ngày đã đóng gộp theo cách cũ (trước 19/11/2026): báo để kế toán biết.
    const legacy = db.prepare('SELECT closer_name, updated_at FROM day_closings WHERE day = ?').get(day) || null;
    res.json({
      figures: closingFigures(day, location), denominations: DENOMINATIONS, pending_debts: pendingDebts(day, location),
      locations: LOCATION_LIST, can_close: can(req.user, 'closing.manage'), legacy,
      saved: saved ? { ...JSON.parse(saved.data), closer_name: saved.closer_name, updated_at: saved.updated_at } : null,
    });
  } catch (err) { next(err); }
});

/**
 * GET /history — các ngày đã đóng gần nhất (bản lưu trữ số).
 */
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT day, location, data, closer_name, updated_at FROM (
      SELECT day, location, data, closer_name, updated_at FROM location_closings
      UNION ALL SELECT day, 'ALL' AS location, data, closer_name, updated_at FROM day_closings
    ) ORDER BY day DESC, location LIMIT 180
  `).all();
  res.json({
    closings: rows.map((r) => {
      const d = JSON.parse(r.data);
      return { day: r.day, location: r.location, location_name: r.location === 'ALL' ? 'Gộp hai nơi (bản cũ)' : warehouseName(r.location),
        revenue: d.figures.totals.revenue, cash: d.figures.totals.cash, transfer: d.figures.totals.transfer,
        counted_cash: d.counted_cash, difference: d.difference, closer_name: r.closer_name, updated_at: r.updated_at };
    }),
  });
});

/** GET /export?day= — tệp Excel của phiếu đã đóng (bản lưu trữ số của báo cáo in). */
router.get('/export', async (req, res, next) => {
  try {
    const day = req.query.day;
    if (!isDay(day)) throw new HttpError(400, 'Ngày không hợp lệ.');
    // location=ALL: phiếu gộp cũ (trước 19/11/2026).
    const legacy = req.query.location === 'ALL';
    const location = legacy ? 'ALL' : readLocation(req.query.location);
    const row = legacy ? db.prepare('SELECT data, closer_name, updated_at FROM day_closings WHERE day = ?').get(day) : savedSlip(day, location);
    if (!row) throw new HttpError(404, 'Ngày này chưa đóng. Lưu phiếu đóng ngày trước khi tải tệp.');
    const place = legacy ? 'Gộp hai nơi' : warehouseName(location);
    const buffer = await closingWorkbook(day, JSON.parse(row.data), row.closer_name, row.updated_at, place);
    const filename = `dong-ngay-${day}-${legacy ? 'gop' : location === MAIN ? 'kho-bo-son' : 'cua-hang-nguyen-cao'}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
});

async function closingWorkbook(day, data, closer, savedAt, place) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gạo Kinh Bắc';
  const ws = wb.addWorksheet('Đóng ngày');
  ws.columns = [{ width: 40 }, { width: 14 }, { width: 18 }, { width: 18 }];
  const { lines, totals } = data.figures;
  // Phiếu lưu trước 19/11/2026 chưa có bảng kê từng dòng: dựng lại từ số tổng.
  const details = data.figures.details || { debts: [], transfers: [], cash_in: [], cash_out: [] };
  const extras = data.extras || [];
  const dd = day.split('-').reverse().join('/');
  const money = '#,##0';
  const head = (text, fill = 'FFD9EAD3') => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, 4);
    r.font = { bold: true, size: 13 };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    r.alignment = { horizontal: 'center' };
  };
  const total = (label, value, col = 4) => {
    const r = ws.addRow([label]);
    r.getCell(col).value = value;
    r.getCell(col).numFmt = money;
    r.font = { bold: true, color: { argb: 'FFC00000' } };
  };
  const item = (row) => {
    const r = ws.addRow([row.name + (row.address ? ` — ${row.address}` : ''), row.code || '', '', row.amount]);
    r.getCell(4).numFmt = money;
  };

  const company = ws.addRow(['CTY CP LƯƠNG THỰC LÚA VÀNG CHÂU Á']);
  company.font = { bold: true, size: 12 };
  const title = ws.addRow([`BÁO CÁO ĐÓNG NGÀY ${dd} — ${place.toUpperCase()}`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([`Người đóng: ${closer || ''} · Lưu lúc: ${savedAt} (giờ máy chủ, UTC) · Doanh thu: ${totals.revenue.toLocaleString('vi-VN')}đ`]);
  ws.addRow([]);

  head(`TỔNG NHÀ NỢ NGÀY ${dd}`);
  total('TỔNG', lines.online_debt.s);
  details.debts.forEach(item);
  ws.addRow([]);

  head('TỔNG CHUYỂN KHOẢN');
  total('TỔNG', totals.transfer);
  details.transfers.forEach(item);
  ws.addRow([]);

  head('TỔNG TIỀN MẶT — THU / CHI');
  const hdr = ws.addRow(['Diễn giải', 'Mã', 'Thu', 'Chi']);
  hdr.font = { bold: true };
  const thuChi = (name, code, thu, chi) => {
    const r = ws.addRow([name, code || '', thu || null, chi || null]);
    r.getCell(3).numFmt = money;
    r.getCell(4).numFmt = money;
  };
  for (const row of details.cash_in) thuChi(row.name + (row.address ? ` — ${row.address}` : ''), row.code, row.amount, 0);
  for (const e of extras.filter((x) => x.type === 'in')) thuChi(e.label, '', e.amount, 0);
  for (const row of details.cash_out) thuChi(row.name, row.code, 0, row.amount);
  for (const e of extras.filter((x) => x.type === 'out')) thuChi(e.label, '', 0, e.amount);
  const inSum = details.cash_in.reduce((s, r) => s + r.amount, 0) + extras.filter((x) => x.type === 'in').reduce((s, e) => s + e.amount, 0);
  const outSum = details.cash_out.reduce((s, r) => s + r.amount, 0) + extras.filter((x) => x.type === 'out').reduce((s, e) => s + e.amount, 0);
  const sumRow = ws.addRow(['TỔNG', '', inSum, outSum]);
  sumRow.font = { bold: true, color: { argb: 'FFC00000' } };
  sumRow.getCell(3).numFmt = money;
  sumRow.getCell(4).numFmt = money;
  total('CÒN LẠI', data.expected_cash ?? totals.cash, 3);
  ws.addRow([]);

  head('TỔNG TIỀN MẶT — KÊ LOẠI TIỀN', 'FFFFFF00');
  const h2 = ws.addRow(['Loại tiền', 'Số tờ', '', 'Tổng tiền']);
  h2.font = { bold: true };
  for (const value of DENOMINATIONS) {
    const n = data.counts[value] || 0;
    const r = ws.addRow([value, n, '', value * n]);
    r.getCell(1).numFmt = money;
    r.getCell(4).numFmt = money;
  }
  total('TỔNG', data.counted_cash);
  const diff = data.difference;
  total(`Chênh lệch so với còn lại${diff === 0 ? ' (khớp)' : diff > 0 ? ' (thừa)' : ' (thiếu)'}`, diff);
  ws.addRow([]);
  ws.addRow([`Tổng công nợ đang mở (tất cả các ngày): ${totals.debt_open.toLocaleString('vi-VN')}đ`]);
  if (data.note) ws.addRow([`Ghi chú: ${data.note}`]);
  ws.addRow([]);
  ws.addRow(['Người lập (ký tên)', '', '', 'Chủ cửa hàng (ký tên)']);
  return wb.xlsx.writeBuffer();
}

/** POST / — lưu phiếu đóng ngày. body: { day, counts: { "500000": n, … }, note? } */
router.post('/', (req, res, next) => {
  try {
    if (!can(req.user, 'closing.manage')) throw new HttpError(403, 'Tài khoản của bạn chỉ được xem báo cáo, không đóng ngày được.');
    const { day } = req.body;
    if (!isDay(day)) throw new HttpError(400, 'Ngày không hợp lệ.');
    if (day > todayVN()) throw new HttpError(400, 'Chưa đóng được ngày trong tương lai.');
    const location = readLocation(req.body.location);
    const counts = {};
    for (const value of DENOMINATIONS) {
      const n = Number(req.body.counts?.[value] ?? 0);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, 'Số tờ tiền không hợp lệ.', { counts: 'Nhập số tờ là số nguyên không âm.' });
      counts[value] = n;
    }
    const counted = DENOMINATIONS.reduce((s, value) => s + value * counts[value], 0);
    const figures = closingFigures(day, location);
    // Công nợ (của nơi này) phải được duyệt hết mới đóng được ngày.
    const pending = pendingDebts(day, location);
    if (pending.length) {
      throw new HttpError(400, `Còn ${pending.length} đơn nợ chưa duyệt xong (${pending.map((p) => p.code).join(', ')}). Duyệt hết công nợ rồi mới đóng ngày.`,
        { pending_debts: 'Còn đơn nợ chờ duyệt.' });
    }
    const note = cleanText(req.body.note, 1000);
    const extras = readExtras(req.body.extras);
    const expected = cashExpected(figures, extras);
    const difference = counted - expected;
    // Tiền đếm phải khớp sổ sách; lệch thì phải ghi giải trình.
    if (difference !== 0 && (!note || note.length < 10)) {
      throw new HttpError(400, `Tiền mặt đếm được ${difference > 0 ? 'thừa' : 'thiếu'} ${Math.abs(difference).toLocaleString('vi-VN')}đ so với tiền mặt còn lại. Đếm lại, hoặc ghi giải trình vào ô ghi chú.`,
        { note: 'Ghi lý do chênh lệch.' });
    }
    const data = { figures, counts, counted_cash: counted, extras, expected_cash: expected, difference, note };
    db.prepare(`
      INSERT INTO location_closings (day, location, data, closed_by, closer_name) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, location) DO UPDATE SET data = excluded.data, closed_by = excluded.closed_by, closer_name = excluded.closer_name, updated_at = datetime('now')
    `).run(day, location, JSON.stringify(data), req.user.id, req.user.full_name);
    writeAdminAudit(req, { action: 'day_closing', entityType: 'day_closing', entityId: `${day}:${location}`, after: { location, counted, difference: data.difference } });
    res.json({ figures, denominations: DENOMINATIONS, pending_debts: [], locations: LOCATION_LIST, can_close: true, legacy: null, saved: { ...data, closer_name: req.user.full_name, updated_at: new Date().toISOString() } });
  } catch (err) { next(err); }
});

export default router;
