import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDateTime, formatVND } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import PushSettings from '../components/PushSettings.jsx';

const formatDay = (day) => (day ? day.split('-').reverse().join('/') : '');
const formatPhone = (phone) => String(phone || '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const STEP_LABELS = [
  ['created', 'Nhân viên giao gửi'],
  ['accounting', 'Kế toán duyệt'],
  ['paid', 'Kế toán ký đã thu'],
  ['settled', 'Mẹ duyệt tất toán'],
];

/** Một đơn nợ: các bước duyệt, ảnh, thao tác theo quyền, bình luận. */
function DebtRecord({ record, can, busy, onAction, onView }) {
  const [text, setText] = useState('');
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState('');
  const act = async (action, body = {}, needComment = false) => {
    if (needComment && !text.trim()) { setError('Vui lòng ghi lý do vào ô bình luận.'); return; }
    setError('');
    const ok = await onAction(record.id, action, { ...body, comment: text.trim() || undefined });
    if (ok) setText('');
  };
  const s = record.status;
  const rejectedStep = s === 'rejected';
  return (
    <li className={`debt-record ${s}${record.overdue_days > 0 && s !== 'rejected' ? ' overdue' : ''}`}>
      <div className="debt-record-head">
        <strong>{record.code}</strong>
        <span>Giao {formatDay(record.delivered_on)}</span>
        <b>{formatVND(record.amount)}</b>
        <span className={`debt-status ${s}`}>{record.status_label}</span>
        {s !== 'settled' && s !== 'rejected' && (
          record.overdue_days > 0
            ? <span className="debt-overdue">⚠️ Quá hạn {record.overdue_days} ngày (hạn {formatDay(record.due_on)})</span>
            : <span className="debt-due">Hạn trả {formatDay(record.due_on)}</span>
        )}
      </div>
      <ol className="debt-steps">
        {STEP_LABELS.map(([key, label]) => {
          const step = record.steps[key];
          return (
            <li key={key} className={step ? 'done' : ''}>
              <span>{label}</span>
              <small>{step ? `${step.by || '—'} · ${formatDateTime(step.at)}${step.method ? ` · ${step.method === 'transfer' ? 'chuyển khoản' : 'tiền mặt'}` : ''}` : rejectedStep ? '—' : 'Chờ'}</small>
            </li>
          );
        })}
      </ol>
      <div className="debt-photos">
        <button type="button" onClick={() => onView({ url: record.delivered_photo, title: `${record.code} · Gạo đã giao` })}>
          <img src={record.delivered_photo} alt="Ảnh gạo đã giao" loading="lazy" /><span>Gạo đã giao</span>
        </button>
        <button type="button" onClick={() => onView({ url: record.invoice_photo, title: `${record.code} · Hoá đơn nợ` })}>
          <img src={record.invoice_photo} alt="Ảnh hoá đơn nợ" loading="lazy" /><span>Hoá đơn nợ</span>
        </button>
        <p className="debt-items">{record.items.map((i) => `${i.product_name} × ${i.quantity} ${i.unit}`).join(' · ')}<small>{record.address}</small></p>
      </div>
      {record.events.length > 0 && (
        <ul className="debt-events">
          {record.events.map((e, i) => (
            <li key={i}><b>{e.user_name || 'Hệ thống'}</b> · {e.action}<small>{formatDateTime(e.created_at)}</small>{e.comment && <p>“{e.comment}”</p>}</li>
          ))}
        </ul>
      )}
      <div className="debt-actions">
        <textarea className="input" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Bình luận / lý do (gửi kèm khi bấm nút, hoặc bấm Gửi bình luận)" />
        <div className="debt-buttons">
          {s === 'pending_accounting' && can('debt.accounting') && <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('approve')}>✅ Kế toán duyệt</button>
            <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => act('reject', {}, true)}>Trả lại</button>
          </>}
          {s === 'open' && can('debt.accounting') && <>
            <select className="input debt-method" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Hình thức thu">
              <option value="cash">Thu tiền mặt</option>
              <option value="transfer">Khách chuyển khoản</option>
            </select>
            <button type="button" className="btn btn-primary" disabled={busy}
                    onClick={() => window.confirm(`Ký xác nhận đã thu ${formatVND(record.amount)} của đơn ${record.code}?`) && act('paid', { method })}>
              ✍️ Ký đã thu tiền
            </button>
          </>}
          {s === 'paid_pending_final' && can('debt.final') && <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('approve')}>✅ Mẹ duyệt tất toán</button>
            <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => act('reject', {}, true)}>Chưa duyệt</button>
          </>}
          {s === 'rejected' && can('debt.accounting') && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('resubmit')}>↻ Gửi duyệt lại</button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy || !text.trim()} onClick={() => act('comments')}>💬 Gửi bình luận</button>
        </div>
        {error && <small className="err" role="alert">{error}</small>}
      </div>
    </li>
  );
}

/**
 * /quan-tri/cong-no — theo dõi công nợ: gom theo khách, mỗi khách một sơ đồ các đơn nợ đang tồn đọng
 * kèm ảnh, người duyệt, bình luận và tổng công nợ. Cảnh báo khoản quá hạn theo số ngày công nợ từng khách.
 */
export default function Debts() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState('open');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState(null);
  const [editingTerm, setEditingTerm] = useState(null);   // { id, term_days, company }

  const load = useCallback(() => {
    api.debts(scope).then((d) => { setData(d); setError(''); }).catch((err) => setError(err.message));
  }, [scope]);
  useEffect(() => { setData(null); load(); }, [load]);

  const onAction = async (id, action, body) => {
    setBusy(true);
    try {
      setData(await api.debtAction(id, action, body, scope));
      setError('');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveTerm = async () => {
    setBusy(true);
    try {
      setData(await api.debtAccount(editingTerm.id, { term_days: Number(editingTerm.term_days), company: editingTerm.company || null }, scope));
      setEditingTerm(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const accounts = (data?.accounts || []).filter((a) => !q
    || [a.contact_name, a.company, a.phone, ...a.records.map((r) => r.code)].some((v) => String(v || '').toLowerCase().includes(q)));
  const overdue = (data?.accounts || []).flatMap((a) => a.records.filter((r) => r.overdue_days > 0 && r.status !== 'rejected').map((r) => ({ ...r, account: a })));

  return (
    <div className="admin-app debts-app">
      <header className="admin-topbar">
        <div className="admin-brand"><img src="/logo-mark.png" alt="" width="38" height="38" /><div><strong>Theo dõi công nợ</strong><small>{user?.full_name}</small></div></div>
        <div className="admin-account">
          <PushSettings />
          <Link to="/quan-tri" className="btn btn-secondary">← Đơn hàng</Link>
          <button className="btn btn-ghost" onClick={() => { logout(); navigate('/'); }}>Đăng xuất</button>
        </div>
      </header>

      <main className="debts-main">
        {data && (
          <section className="stats debt-stats" aria-label="Tổng quan công nợ">
            <div className="stat"><span>Tổng công nợ đang mở</span><strong>{formatVND(data.summary.total)}</strong><small>{data.accounts.length} khách</small></div>
            <div className={`stat${data.summary.overdue_count ? ' urgent' : ''}`}><span>Quá hạn</span><strong>{formatVND(data.summary.overdue)}</strong><small>{data.summary.overdue_count} khoản cần đòi</small></div>
            <div className="stat"><span>Chờ kế toán duyệt</span><strong>{data.summary.pending_accounting}</strong><small>đơn nợ mới</small></div>
            <div className="stat"><span>Chờ mẹ tất toán</span><strong>{data.summary.pending_settle}</strong><small>{data.summary.rejected ? `${data.summary.rejected} khoản bị trả lại` : 'đã thu tiền'}</small></div>
          </section>
        )}

        {scope === 'open' && overdue.length > 0 && (
          <div className="debt-warning" role="alert">
            <strong>⚠️ {overdue.length} khoản công nợ đã quá hạn — cần đòi tiền:</strong>
            <ul>
              {overdue.map((r) => (
                <li key={r.id}>{r.account.contact_name}{r.account.company ? ` — ${r.account.company}` : ''} · {r.code} · {formatVND(r.amount)} · quá {r.overdue_days} ngày (hạn {formatDay(r.due_on)})</li>
              ))}
            </ul>
          </div>
        )}

        <div className="debt-toolbar">
          <div className="view-toggle" role="group" aria-label="Loại công nợ">
            <button type="button" aria-pressed={scope === 'open'} onClick={() => setScope('open')}>Đang nợ</button>
            <button type="button" aria-pressed={scope === 'settled'} onClick={() => setScope('settled')}>Đã tất toán</button>
          </div>
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên khách, công ty, SĐT, mã đơn" />
        </div>
        {error && <p className="alert error" role="alert">{error}</p>}
        {!data && !error && <div className="loading-state" role="status"><span></span>Đang tải công nợ…</div>}
        {data && accounts.length === 0 && (
          <div className="admin-empty"><span>✓</span><h2>{scope === 'open' ? 'Không có công nợ đang tồn đọng' : 'Chưa có khoản nào tất toán'}</h2></div>
        )}

        {accounts.map((a) => (
          <section key={a.id} className={`debt-flow${a.overdue > 0 ? ' overdue' : ''}`}>
            <div className="debt-customer">
              <h2>{a.contact_name}</h2>
              {a.company && <p className="debt-company">{a.company}</p>}
              <a href={`tel:${a.phone}`}>☏ {formatPhone(a.phone)}</a>
              {editingTerm?.id === a.id ? (
                <div className="debt-term-edit">
                  <label>Hạn công nợ (ngày)<input className="input" type="number" min="1" max="365" value={editingTerm.term_days}
                                                 onChange={(e) => setEditingTerm({ ...editingTerm, term_days: e.target.value })} /></label>
                  <label>Công ty<input className="input" value={editingTerm.company || ''} maxLength={160}
                                       onChange={(e) => setEditingTerm({ ...editingTerm, company: e.target.value })} /></label>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveTerm}>Lưu</button>
                  <button type="button" className="link-button" onClick={() => setEditingTerm(null)}>Huỷ</button>
                </div>
              ) : (
                <p className="debt-term">
                  Hạn công nợ tối đa <b>{a.term_days} ngày</b>
                  {can('debt.accounting') && <button type="button" className="link-button" onClick={() => setEditingTerm({ id: a.id, term_days: a.term_days, company: a.company })}>Sửa</button>}
                </p>
              )}
              <div className="debt-total">
                <span>Tổng công nợ</span><strong>{formatVND(a.total)}</strong>
                {a.overdue > 0 && <small>Quá hạn {formatVND(a.overdue)}</small>}
              </div>
            </div>
            <ol className="debt-records">
              {a.records.map((r) => <DebtRecord key={r.id} record={r} can={can} busy={busy} onAction={onAction} onView={setViewing} />)}
            </ol>
          </section>
        ))}
      </main>

      {viewing && (
        <div className="doc-viewer" role="dialog" aria-modal="true" aria-label={viewing.title} onClick={() => setViewing(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={viewing.url} alt={viewing.title} />
            <figcaption>{viewing.title}</figcaption>
          </figure>
          <button type="button" className="icon-close" onClick={() => setViewing(null)} aria-label="Đóng">×</button>
        </div>
      )}
    </div>
  );
}
