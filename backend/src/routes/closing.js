import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requirePermission } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText } from '../validate.js';
import { localDate } from '../constants.js';
import { writeAdminAudit } from '../audit.js';
import { DEBT_STATUS_LABEL, todayVN } from '../debts.js';

/**
 * /api/admin/closing — đóng ngày (end of day) cho kế toán (quyền xem doanh thu): doanh thu trong ngày
 * chia theo chuyển khoản / tiền mặt / công nợ, kê loại tiền mặt đếm được và chênh lệch. Lưu lại phiếu
 * để in và xem lại.
 *
 * Quy ước: đơn online tính vào ngày GIAO XONG (lúc tiền về); hoá đơn quầy và phiếu trả tính theo ngày
 * lập; tiền thu nợ tính theo ngày kế toán ký đã thu.
 */
const router = Router();
router.use(requireAuth, requirePermission('revenue.view'));
router.use(validateRoutes('closing'));

export const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

export function closingFigures(day) {
  const sum = (sql, ...args) => db.prepare(sql).get(...args);
  const online = db.prepare(`
    SELECT CASE WHEN payment_status = 'debt' THEN 'debt' WHEN payment_method = 'bank' THEN 'transfer' ELSE 'cash' END AS kind,
           COUNT(*) AS n, COALESCE(SUM(total), 0) AS s
    FROM orders WHERE status = 'completed' AND ${localDate('COALESCE(completed_at, created_at)')} = ?
    GROUP BY kind
  `).all(day);
  const retail = db.prepare(`
    SELECT CASE WHEN payment_method = 'transfer' THEN 'transfer' ELSE 'cash' END AS kind, COUNT(*) AS n, COALESCE(SUM(total), 0) AS s
    FROM retail_invoices WHERE ${localDate('created_at')} = ? GROUP BY kind
  `).all(day);
  const refunds = db.prepare(`
    SELECT refund_method AS kind, COUNT(*) AS n, COALESCE(SUM(refund_amount), 0) AS s
    FROM retail_returns WHERE refund_method IN ('cash', 'transfer') AND ${localDate('created_at')} = ? GROUP BY kind
  `).all(day);
  const collected = db.prepare(`
    SELECT paid_method AS kind, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS s
    FROM debt_records WHERE paid_at IS NOT NULL AND status IN ('paid_pending_final', 'settled') AND ${localDate('paid_at')} = ?
    GROUP BY kind
  `).all(day);
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
  const debtOpen = sum("SELECT COALESCE(SUM(amount), 0) AS s FROM debt_records WHERE status IN ('pending_accounting', 'pending_final', 'open', 'paid_pending_final')").s;
  return { day, lines, totals: { revenue, cash, transfer, debt_new: lines.online_debt.s, debt_open: debtOpen } };
}

/**
 * Đơn nợ còn chờ duyệt tính tới hết ngày `day`: chưa duyệt cho nợ (hoặc bị trả lại) với ngày giao ≤ day,
 * hoặc đã ký thu tiền ≤ day mà mẹ chưa duyệt tất toán. Còn khoản nào thì chưa đóng ngày được.
 */
export function pendingDebts(day) {
  return db.prepare(`
    SELECT r.id, r.status, r.amount, o.code, a.contact_name, a.company FROM debt_records r
    JOIN orders o ON o.id = r.order_id JOIN debt_accounts a ON a.id = r.account_id
    WHERE (r.status IN ('pending_accounting', 'pending_final', 'rejected') AND r.delivered_on <= ?)
       OR (r.status = 'paid_pending_final' AND ${localDate('r.paid_at')} <= ?)
    ORDER BY r.id
  `).all(day, day).map((r) => ({ ...r, status_label: DEBT_STATUS_LABEL[r.status] }));
}

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** GET /?day=YYYY-MM-DD — số liệu tính sẵn + phiếu đã lưu (nếu có). */
router.get('/', (req, res, next) => {
  try {
    const day = req.query.day || todayVN();
    if (!isDay(day)) throw new HttpError(400, 'Ngày không hợp lệ.');
    const saved = db.prepare('SELECT data, closer_name, updated_at FROM day_closings WHERE day = ?').get(day);
    res.json({
      figures: closingFigures(day), denominations: DENOMINATIONS, pending_debts: pendingDebts(day),
      can_close: can(req.user, 'closing.manage'),
      saved: saved ? { ...JSON.parse(saved.data), closer_name: saved.closer_name, updated_at: saved.updated_at } : null,
    });
  } catch (err) { next(err); }
});

/**
 * GET /history — các ngày đã đóng gần nhất (bản lưu trữ số).
 */
router.get('/history', (req, res) => {
  const rows = db.prepare('SELECT day, data, closer_name, updated_at FROM day_closings ORDER BY day DESC LIMIT 90').all();
  res.json({
    closings: rows.map((r) => {
      const d = JSON.parse(r.data);
      return { day: r.day, revenue: d.figures.totals.revenue, cash: d.figures.totals.cash, transfer: d.figures.totals.transfer,
        counted_cash: d.counted_cash, difference: d.difference, closer_name: r.closer_name, updated_at: r.updated_at };
    }),
  });
});

/** GET /export?day= — tệp Excel của phiếu đã đóng (bản lưu trữ số của báo cáo in). */
router.get('/export', async (req, res, next) => {
  try {
    const day = req.query.day;
    if (!isDay(day)) throw new HttpError(400, 'Ngày không hợp lệ.');
    const row = db.prepare('SELECT data, closer_name, updated_at FROM day_closings WHERE day = ?').get(day);
    if (!row) throw new HttpError(404, 'Ngày này chưa đóng. Lưu phiếu đóng ngày trước khi tải tệp.');
    const buffer = await closingWorkbook(day, JSON.parse(row.data), row.closer_name, row.updated_at);
    const filename = `dong-ngay-${day}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
});

async function closingWorkbook(day, data, closer, savedAt) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gạo Kinh Bắc';
  const ws = wb.addWorksheet('Đóng ngày');
  ws.columns = [{ width: 46 }, { width: 12 }, { width: 20 }];
  const { lines, totals } = data.figures;
  const title = ws.addRow([`BÁO CÁO ĐÓNG NGÀY ${day.split('-').reverse().join('/')} — GẠO KINH BẮC`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([`Người đóng: ${closer || ''} · Lưu lúc: ${savedAt} (giờ máy chủ, UTC)`]);
  ws.addRow([]);
  const section = (name) => { const r = ws.addRow([name]); r.font = { bold: true }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EFE8' } }; };
  const line = (label, value, n = '', bold = false) => {
    const r = ws.addRow([label, n === '' ? '' : n, value]);
    r.getCell(3).numFmt = '#,##0';
    if (bold) r.font = { bold: true };
  };
  section('DOANH THU HÔM NAY');
  line('Đơn online giao xong — tiền mặt', lines.online_cash.s, lines.online_cash.n);
  line('Đơn online giao xong — chuyển khoản', lines.online_transfer.s, lines.online_transfer.n);
  line('Đơn online giao xong — công nợ (chưa thu)', lines.online_debt.s, lines.online_debt.n);
  line('Bán tại quầy — tiền mặt', lines.retail_cash.s, lines.retail_cash.n);
  line('Bán tại quầy — chuyển khoản', lines.retail_transfer.s, lines.retail_transfer.n);
  line('Trả hàng hoàn tiền mặt', -lines.refund_cash.s, lines.refund_cash.n);
  line('Trả hàng hoàn chuyển khoản', -lines.refund_transfer.s, lines.refund_transfer.n);
  line('Tổng doanh thu', totals.revenue, '', true);
  ws.addRow([]);
  section('CHUYỂN KHOẢN');
  line('Đơn online', lines.online_transfer.s);
  line('Bán tại quầy', lines.retail_transfer.s);
  line('Thu nợ bằng chuyển khoản', lines.debt_collected_transfer.s, lines.debt_collected_transfer.n);
  line('Hoàn tiền chuyển khoản', -lines.refund_transfer.s);
  line('Tổng chuyển khoản', totals.transfer, '', true);
  ws.addRow([]);
  section('TIỀN MẶT');
  line('Đơn online giao xong', lines.online_cash.s);
  line('Bán tại quầy', lines.retail_cash.s);
  line('Thu nợ bằng tiền mặt', lines.debt_collected_cash.s, lines.debt_collected_cash.n);
  line('Hoàn tiền mặt', -lines.refund_cash.s);
  line('Tổng tiền mặt theo sổ sách', totals.cash, '', true);
  const head = ws.addRow(['Kê loại tiền — mệnh giá', 'Số tờ', 'Thành tiền']);
  head.font = { bold: true };
  for (const value of DENOMINATIONS) line(`${value.toLocaleString('vi-VN')}đ`, value * (data.counts[value] || 0), data.counts[value] || 0);
  line('Tổng tiền mặt đếm được', data.counted_cash, '', true);
  line(`Chênh lệch so với sổ sách${data.difference === 0 ? ' (khớp)' : data.difference > 0 ? ' (thừa)' : ' (thiếu)'}`, data.difference, '', true);
  ws.addRow([]);
  section('CÔNG NỢ');
  line('Công nợ phát sinh trong ngày', lines.online_debt.s, lines.online_debt.n);
  line('Thu nợ trong ngày', lines.debt_collected_cash.s + lines.debt_collected_transfer.s);
  line('Tổng công nợ đang mở (tất cả các ngày)', totals.debt_open, '', true);
  ws.addRow([]);
  if (data.note) ws.addRow([`Ghi chú: ${data.note}`]);
  ws.addRow([]);
  ws.addRow(['Người lập (ký tên)', '', 'Chủ cửa hàng (ký tên)']);
  return wb.xlsx.writeBuffer();
}

/** POST / — lưu phiếu đóng ngày. body: { day, counts: { "500000": n, … }, note? } */
router.post('/', (req, res, next) => {
  try {
    if (!can(req.user, 'closing.manage')) throw new HttpError(403, 'Tài khoản của bạn chỉ được xem báo cáo, không đóng ngày được.');
    const { day } = req.body;
    if (!isDay(day)) throw new HttpError(400, 'Ngày không hợp lệ.');
    if (day > todayVN()) throw new HttpError(400, 'Chưa đóng được ngày trong tương lai.');
    const counts = {};
    for (const value of DENOMINATIONS) {
      const n = Number(req.body.counts?.[value] ?? 0);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, 'Số tờ tiền không hợp lệ.', { counts: 'Nhập số tờ là số nguyên không âm.' });
      counts[value] = n;
    }
    const counted = DENOMINATIONS.reduce((s, value) => s + value * counts[value], 0);
    const figures = closingFigures(day);
    // Công nợ phải được duyệt hết mới đóng được ngày.
    const pending = pendingDebts(day);
    if (pending.length) {
      throw new HttpError(400, `Còn ${pending.length} đơn nợ chưa duyệt xong (${pending.map((p) => p.code).join(', ')}). Duyệt hết công nợ rồi mới đóng ngày.`,
        { pending_debts: 'Còn đơn nợ chờ duyệt.' });
    }
    const note = cleanText(req.body.note, 1000);
    const difference = counted - figures.totals.cash;
    // Tiền đếm phải khớp sổ sách; lệch thì phải ghi giải trình.
    if (difference !== 0 && (!note || note.length < 10)) {
      throw new HttpError(400, `Tiền mặt đếm được ${difference > 0 ? 'thừa' : 'thiếu'} ${Math.abs(difference).toLocaleString('vi-VN')}đ so với sổ sách. Đếm lại, hoặc ghi giải trình vào ô ghi chú.`,
        { note: 'Ghi lý do chênh lệch.' });
    }
    const data = { figures, counts, counted_cash: counted, difference, note };
    db.prepare(`
      INSERT INTO day_closings (day, data, closed_by, closer_name) VALUES (?, ?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET data = excluded.data, closed_by = excluded.closed_by, closer_name = excluded.closer_name, updated_at = datetime('now')
    `).run(day, JSON.stringify(data), req.user.id, req.user.full_name);
    writeAdminAudit(req, { action: 'day_closing', entityType: 'day_closing', entityId: day, after: { counted, difference: data.difference } });
    res.json({ figures, denominations: DENOMINATIONS, pending_debts: [], can_close: true, saved: { ...data, closer_name: req.user.full_name, updated_at: new Date().toISOString() } });
  } catch (err) { next(err); }
});

export default router;
