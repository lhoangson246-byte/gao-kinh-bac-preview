import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requirePermission } from '../permissions.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanText, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import { listDebts, logDebtEvent, moveDebt } from '../debts.js';

/**
 * /api/debts — trang theo dõi công nợ. Xem: quyền debt.view. Kế toán (debt.accounting): duyệt bước 1,
 * ký đã thu tiền, đặt hạn công nợ từng khách, gửi duyệt lại. Mẹ (debt.final): duyệt bước 2 và tất toán.
 * Chủ cửa hàng có mọi quyền. Máy chủ kiểm tra quyền ở từng thao tác.
 */
const router = Router();
router.use(requireAuth, requirePermission('debt.view'));
router.use(validateRoutes('debts'));

const need = (req, permission) => {
  if (!can(req.user, permission)) throw new HttpError(403, 'Tài khoản của bạn chưa được cấp quyền duyệt bước này.');
};
const debtId = (req) => {
  const id = toInteger(req.params.id, { min: 1 });
  if (!id) throw new HttpError(404, 'Không tìm thấy đơn nợ.');
  return id;
};
const comment = (req, required = false) => {
  const text = cleanText(req.body?.comment, 1000);
  if (required && !text) throw new HttpError(400, 'Vui lòng ghi lý do.', { comment: 'Vui lòng ghi lý do.' });
  return text;
};
const reply = (req, res, action, id) => {
  writeAdminAudit(req, { action: `debt.${action}`, entityType: 'debt', entityId: id });
  res.json(listDebts(req.query.scope === 'settled' ? 'settled' : 'open'));
};

router.get('/', (req, res) => res.json(listDebts(req.query.scope === 'settled' ? 'settled' : 'open')));

/** POST /:id/approve — duyệt bước hiện tại: kế toán (bước 1), mẹ (bước 2 và tất toán). */
router.post('/:id/approve', (req, res, next) => {
  try {
    const id = debtId(req);
    const status = db.prepare('SELECT status FROM debt_records WHERE id = ?').get(id)?.status;
    if (!status) throw new HttpError(404, 'Không tìm thấy đơn nợ.');
    if (status === 'pending_accounting') {
      need(req, 'debt.accounting');
      moveDebt(id, ['pending_accounting'], 'pending_final', req.user, {
        action: 'Kế toán duyệt', comment: comment(req), fields: { accounting_by: req.user.id, accounting_at: new Date().toISOString().replace('T', ' ').slice(0, 19) },
      });
    } else if (status === 'pending_final') {
      need(req, 'debt.final');
      moveDebt(id, ['pending_final'], 'open', req.user, {
        action: 'Mẹ duyệt — ghi nhận công nợ', comment: comment(req), fields: { final_by: req.user.id, final_at: new Date().toISOString().replace('T', ' ').slice(0, 19) },
      });
    } else if (status === 'paid_pending_final') {
      need(req, 'debt.final');
      moveDebt(id, ['paid_pending_final'], 'settled', req.user, {
        action: 'Mẹ duyệt tất toán', comment: comment(req), fields: { settled_by: req.user.id, settled_at: new Date().toISOString().replace('T', ' ').slice(0, 19) },
      });
    } else {
      throw new HttpError(409, 'Đơn nợ này không chờ duyệt.');
    }
    reply(req, res, 'approve', id);
  } catch (err) { next(err); }
});

/** POST /:id/paid — kế toán ký đã thu tiền. body: { method: 'cash' | 'transfer', comment? } */
router.post('/:id/paid', (req, res, next) => {
  try {
    need(req, 'debt.accounting');
    const id = debtId(req);
    moveDebt(id, ['open'], 'paid_pending_final', req.user, {
      action: `Kế toán ký đã thu tiền (${req.body.method === 'transfer' ? 'chuyển khoản' : 'tiền mặt'})`,
      comment: comment(req),
      fields: { paid_by: req.user.id, paid_at: new Date().toISOString().replace('T', ' ').slice(0, 19), paid_method: req.body.method },
    });
    reply(req, res, 'paid', id);
  } catch (err) { next(err); }
});

/** POST /:id/reject — từ chối ở bước đang duyệt (bắt buộc ghi lý do). */
router.post('/:id/reject', (req, res, next) => {
  try {
    const id = debtId(req);
    const status = db.prepare('SELECT status FROM debt_records WHERE id = ?').get(id)?.status;
    if (!status) throw new HttpError(404, 'Không tìm thấy đơn nợ.');
    const text = comment(req, true);
    if (status === 'pending_accounting') {
      need(req, 'debt.accounting');
      moveDebt(id, ['pending_accounting'], 'rejected', req.user, { action: 'Kế toán trả lại', comment: text });
    } else if (status === 'pending_final') {
      need(req, 'debt.final');
      moveDebt(id, ['pending_final'], 'rejected', req.user, { action: 'Mẹ trả lại', comment: text });
    } else if (status === 'paid_pending_final') {
      // Mẹ chưa đồng ý tất toán: khoản nợ quay lại "đang nợ", xoá chữ ký đã thu.
      need(req, 'debt.final');
      moveDebt(id, ['paid_pending_final'], 'open', req.user, {
        action: 'Mẹ chưa duyệt tất toán', comment: text, fields: { paid_by: null, paid_at: null, paid_method: null },
      });
    } else {
      throw new HttpError(409, 'Đơn nợ này không chờ duyệt.');
    }
    reply(req, res, 'reject', id);
  } catch (err) { next(err); }
});

/** POST /:id/resubmit — kế toán gửi duyệt lại đơn bị trả lại (sau khi bổ sung / giải thích). */
router.post('/:id/resubmit', (req, res, next) => {
  try {
    need(req, 'debt.accounting');
    const id = debtId(req);
    moveDebt(id, ['rejected'], 'pending_accounting', req.user, {
      action: 'Gửi duyệt lại', comment: comment(req), fields: { accounting_by: null, accounting_at: null, final_by: null, final_at: null },
    });
    reply(req, res, 'resubmit', id);
  } catch (err) { next(err); }
});

/** POST /:id/comments — bình luận ở bất kỳ bước nào. body: { comment } */
router.post('/:id/comments', (req, res, next) => {
  try {
    const id = debtId(req);
    if (!db.prepare('SELECT 1 FROM debt_records WHERE id = ?').get(id)) throw new HttpError(404, 'Không tìm thấy đơn nợ.');
    logDebtEvent(id, req.user, 'Bình luận', comment(req, true));
    res.json(listDebts(req.query.scope === 'settled' ? 'settled' : 'open'));
  } catch (err) { next(err); }
});

/** PUT /accounts/:id — hạn công nợ (số ngày), tên, công ty, ghi chú của khách nợ. */
router.put('/accounts/:id', (req, res, next) => {
  try {
    need(req, 'debt.accounting');
    const id = toInteger(req.params.id, { min: 1 });
    const current = id && db.prepare('SELECT * FROM debt_accounts WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Không tìm thấy khách nợ.');
    const next_ = { ...current };
    if (req.body.term_days !== undefined) next_.term_days = req.body.term_days;
    if (req.body.contact_name !== undefined) next_.contact_name = cleanText(req.body.contact_name, 120) || current.contact_name;
    if (req.body.company !== undefined) next_.company = cleanText(req.body.company, 160);
    if (req.body.note !== undefined) next_.note = cleanText(req.body.note, 300);
    db.prepare(`UPDATE debt_accounts SET term_days = ?, contact_name = ?, company = ?, note = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(next_.term_days, next_.contact_name, next_.company, next_.note, id);
    writeAdminAudit(req, { action: 'debt.account_update', entityType: 'debt_account', entityId: id, before: current, after: next_ });
    res.json(listDebts(req.query.scope === 'settled' ? 'settled' : 'open'));
  } catch (err) { next(err); }
});

export default router;
