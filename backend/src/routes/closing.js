import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText } from '../validate.js';
import { localDate } from '../constants.js';
import { writeAdminAudit } from '../audit.js';
import { todayVN } from '../debts.js';

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

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** GET /?day=YYYY-MM-DD — số liệu tính sẵn + phiếu đã lưu (nếu có). */
router.get('/', (req, res, next) => {
  try {
    const day = req.query.day || todayVN();
    if (!isDay(day)) throw new HttpError(400, 'Ngày không hợp lệ.');
    const saved = db.prepare('SELECT data, closer_name, updated_at FROM day_closings WHERE day = ?').get(day);
    res.json({ figures: closingFigures(day), denominations: DENOMINATIONS, saved: saved ? { ...JSON.parse(saved.data), closer_name: saved.closer_name, updated_at: saved.updated_at } : null });
  } catch (err) { next(err); }
});

/** POST / — lưu phiếu đóng ngày. body: { day, counts: { "500000": n, … }, note? } */
router.post('/', (req, res, next) => {
  try {
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
    const data = { figures, counts, counted_cash: counted, difference: counted - figures.totals.cash, note: cleanText(req.body.note, 1000) };
    db.prepare(`
      INSERT INTO day_closings (day, data, closed_by, closer_name) VALUES (?, ?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET data = excluded.data, closed_by = excluded.closed_by, closer_name = excluded.closer_name, updated_at = datetime('now')
    `).run(day, JSON.stringify(data), req.user.id, req.user.full_name);
    writeAdminAudit(req, { action: 'day_closing', entityType: 'day_closing', entityId: day, after: { counted, difference: data.difference } });
    res.json({ figures, denominations: DENOMINATIONS, saved: { ...data, closer_name: req.user.full_name, updated_at: new Date().toISOString() } });
  } catch (err) { next(err); }
});

export default router;
