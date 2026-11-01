/**
 * Công nợ (12/11/2026). Đơn của khách lấy hàng trước, trả sau (thường công ty lớn, 14 – 30 ngày):
 *
 *   Nhân viên giao bấm "Khách nợ" + ảnh gạo đã giao + ảnh hoá đơn nợ   → pending_accounting
 *   Kế toán duyệt                                                         → pending_final
 *   Mẹ duyệt                                                              → open (đang nợ)
 *   Kế toán ký "đã thu tiền" (tiền mặt / chuyển khoản)                   → paid_pending_final
 *   Mẹ duyệt tất toán                                                     → settled
 *
 * Bước duyệt nào cũng từ chối được (kèm lý do) → rejected; kế toán gửi duyệt lại sau khi xử lý.
 * Mỗi bước và mỗi bình luận ghi vào debt_events. Hạn trả = ngày giao + số ngày công nợ của khách
 * (cửa hàng đặt riêng từng khách); quá hạn thì trang công nợ cảnh báo.
 */
import db from './db.js';
import { HttpError } from './validate.js';
import { REPORT_TIME_SHIFT } from './constants.js';
import { promoToday } from './promotions.js';

export const DEBT_STATUS_LABEL = {
  pending_accounting: 'Chờ kế toán duyệt',
  pending_final: 'Chờ mẹ duyệt',
  open: 'Đang nợ',
  paid_pending_final: 'Đã thu tiền – chờ mẹ duyệt tất toán',
  settled: 'Đã tất toán',
  rejected: 'Bị trả lại',
};
export const DEFAULT_TERM_DAYS = 15;
export const UNSETTLED = ['pending_accounting', 'pending_final', 'open', 'paid_pending_final', 'rejected'];

export const todayVN = () => db.prepare(`SELECT date('now', '${REPORT_TIME_SHIFT}') AS d`).get().d;
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function logDebtEvent(debtId, user, action, comment = null) {
  db.prepare('INSERT INTO debt_events (debt_id, user_id, user_name, action, comment) VALUES (?, ?, ?, ?, ?)')
    .run(debtId, user?.id ?? null, user?.full_name ?? null, action, comment || null);
}

/** Tài khoản công nợ theo số điện thoại khách; chưa có thì tạo với hạn mặc định. */
export function debtAccountFor({ phone, contactName, company }) {
  const existing = db.prepare('SELECT * FROM debt_accounts WHERE phone = ?').get(phone);
  if (existing) {
    if (company && !existing.company) db.prepare("UPDATE debt_accounts SET company = ?, updated_at = datetime('now') WHERE id = ?").run(company, existing.id);
    return existing.id;
  }
  return db.prepare('INSERT INTO debt_accounts (phone, contact_name, company, term_days) VALUES (?, ?, ?, ?)')
    .run(phone, contactName, company || null, DEFAULT_TERM_DAYS).lastInsertRowid;
}

/**
 * Danh sách cho trang theo dõi công nợ, gom theo khách. `scope`: 'open' (mọi đơn nợ chưa tất toán)
 * hoặc 'settled'. Mỗi đơn có hạn trả, số ngày quá hạn, ảnh, người duyệt và dòng thời gian bình luận.
 */
export function listDebts(scope = 'open') {
  // Ngày để xét quá hạn. Bài kiểm tra ghim được bằng PROMO_TODAY (bị bỏ qua trên Vercel).
  const today = promoToday();
  const statusClause = scope === 'settled' ? "r.status = 'settled'" : "r.status <> 'settled'";
  const rows = db.prepare(`
    SELECT r.*, a.contact_name, a.company, a.phone AS account_phone, a.term_days, a.note AS account_note,
           o.code, o.receiver_name, o.address, o.total AS order_total, o.completed_at,
           cu.full_name AS created_name, ac.full_name AS accounting_name, fi.full_name AS final_name,
           pa.full_name AS paid_name, se.full_name AS settled_name
    FROM debt_records r
    JOIN debt_accounts a ON a.id = r.account_id
    JOIN orders o ON o.id = r.order_id
    LEFT JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users ac ON ac.id = r.accounting_by
    LEFT JOIN users fi ON fi.id = r.final_by
    LEFT JOIN users pa ON pa.id = r.paid_by
    LEFT JOIN users se ON se.id = r.settled_by
    WHERE ${statusClause}
    ORDER BY a.contact_name, r.delivered_on, r.id
    LIMIT 2000
  `).all();
  const ids = rows.map((r) => r.id);
  const events = ids.length ? db.prepare(`
    SELECT debt_id, user_name, action, comment, created_at FROM debt_events
    WHERE debt_id IN (${ids.map(() => '?').join(',')}) ORDER BY id
  `).all(...ids) : [];
  const items = rows.length ? db.prepare(`
    SELECT order_id, product_name, quantity, unit FROM order_items
    WHERE order_id IN (${rows.map(() => '?').join(',')}) ORDER BY order_id, id
  `).all(...rows.map((r) => r.order_id)) : [];

  const accounts = new Map();
  for (const r of rows) {
    const dueOn = addDays(r.delivered_on, r.term_days);
    const overdueDays = r.status !== 'settled' && today > dueOn
      ? Math.round((Date.parse(today) - Date.parse(dueOn)) / 86400000) : 0;
    const record = {
      id: r.id, order_id: r.order_id, code: r.code, amount: r.amount, status: r.status, status_label: DEBT_STATUS_LABEL[r.status],
      delivered_on: r.delivered_on, due_on: dueOn, overdue_days: overdueDays,
      delivered_photo: `/api/proofs/${r.delivered_photo}`, invoice_photo: `/api/proofs/${r.invoice_photo}`,
      address: r.address,
      items: items.filter((i) => i.order_id === r.order_id).map(({ order_id, ...i }) => i),
      steps: {
        created: { by: r.created_name, at: r.created_at },
        accounting: r.accounting_at ? { by: r.accounting_name, at: r.accounting_at } : null,
        final: r.final_at ? { by: r.final_name, at: r.final_at } : null,
        paid: r.paid_at ? { by: r.paid_name, at: r.paid_at, method: r.paid_method } : null,
        settled: r.settled_at ? { by: r.settled_name, at: r.settled_at } : null,
      },
      events: events.filter((e) => e.debt_id === r.id).map(({ debt_id, ...e }) => e),
    };
    if (!accounts.has(r.account_id)) {
      accounts.set(r.account_id, {
        id: r.account_id, contact_name: r.contact_name, company: r.company, phone: r.account_phone,
        term_days: r.term_days, note: r.account_note, records: [], total: 0, overdue: 0,
      });
    }
    const account = accounts.get(r.account_id);
    account.records.push(record);
    // Tổng công nợ: mọi khoản chưa tất toán, trừ khoản bị trả lại (chưa được công nhận là nợ).
    if (r.status !== 'rejected') account.total += r.amount;
    if (overdueDays > 0 && r.status !== 'rejected') account.overdue += r.amount;
  }
  const list = [...accounts.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  const all = list.flatMap((a) => a.records);
  return {
    today,
    accounts: list,
    summary: {
      total: list.reduce((s, a) => s + a.total, 0),
      overdue: list.reduce((s, a) => s + a.overdue, 0),
      overdue_count: all.filter((r) => r.overdue_days > 0 && r.status !== 'rejected').length,
      pending_accounting: all.filter((r) => r.status === 'pending_accounting').length,
      pending_final: all.filter((r) => ['pending_final', 'paid_pending_final'].includes(r.status)).length,
      rejected: all.filter((r) => r.status === 'rejected').length,
    },
  };
}

/**
 * Chuyển một đơn nợ sang bước kế tiếp trong transaction có điều kiện "WHERE status = ?", để hai người
 * cùng bấm thì chỉ một lần được ghi. `fields` = các cột ghi thêm (tên cột cố định trong mã nguồn).
 */
export function moveDebt(debtId, from, to, user, { action, comment, fields = {} }) {
  return db.transaction(() => {
    const current = db.prepare('SELECT id, status FROM debt_records WHERE id = ?').get(debtId);
    if (!current) throw new HttpError(404, 'Không tìm thấy đơn nợ.');
    if (!from.includes(current.status)) {
      throw new HttpError(409, `Đơn nợ đang ở bước "${DEBT_STATUS_LABEL[current.status]}", không làm được thao tác này. Vui lòng tải lại trang.`);
    }
    const sets = Object.keys(fields).map((column) => `${column} = ?`);
    const changed = db.prepare(`
      UPDATE debt_records SET status = ?, ${sets.length ? `${sets.join(', ')}, ` : ''}updated_at = datetime('now')
      WHERE id = ? AND status = ?
    `).run(to, ...Object.values(fields), debtId, current.status).changes;
    if (!changed) throw new HttpError(409, 'Đơn nợ vừa được cập nhật ở nơi khác. Vui lòng tải lại trang.');
    logDebtEvent(debtId, user, action, comment);
    return current;
  })();
}
