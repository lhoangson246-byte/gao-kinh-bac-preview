import { ListSkeleton } from '../components/Skeleton.jsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime, formatVND, vietnamDate } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { COMPANY_SHORT } from '../shopInfo.js';

const formatDay = (day) => day.split('-').reverse().join('/');
const shortDay = (day) => formatDay(day).slice(0, 5);
const money = (n) => (n ? Number(n).toLocaleString('vi-VN') : '');
const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 11);

/** Một dòng kê: tên khách (đậm), địa chỉ + mã đơn (nhỏ), số tiền. */
function ItemRow({ row }) {
  return (
    <tr>
      <th scope="row">
        {row.name}
        {(row.address || row.code) && <small>{[row.address, row.code].filter(Boolean).join(' · ')}</small>}
      </th>
      <td className="num">{money(row.amount) || '0'}</td>
    </tr>
  );
}

/** Bảng "TỔNG …" giống bảng tính của kế toán: tiêu đề xanh, dòng TỔNG đỏ ngay dưới, rồi từng dòng. */
function Sheet({ title, total, rows, empty }) {
  return (
    <section className="closing-sheet">
      <h2>{title}</h2>
      <table className="closing-grid">
        <tbody>
          <tr className="total"><th scope="row">TỔNG</th><td className="num">{money(total) || '0'}</td></tr>
          {rows.map((row, i) => <ItemRow key={`${row.code}-${i}`} row={row} />)}
          {!rows.length && <tr><td colSpan={2} className="muted">{empty}</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

/**
 * /quan-tri/dong-ngay — kế toán đóng ngày theo mẫu bảng tính cửa hàng đang dùng (19/11/2026):
 *  - TỔNG NHÀ NỢ NGÀY, TỔNG CHUYỂN KHOẢN: máy tự tổng hợp từ đơn hàng, hoá đơn quầy, thu nợ.
 *  - TỔNG TIỀN MẶT (thu / chi): phần thu máy tự tính, kế toán ghi thêm khoản thu / chi khác (đổ xăng…).
 *  - TỔNG TIỀN MẶT (kê loại tiền): kế toán đếm số tờ; phải khớp "Còn lại", lệch thì ghi giải trình.
 * Lưu phiếu, in một trang A4 và tải tệp Excel.
 */
export default function DayClosing() {
  const { user } = useAuth();
  const [day, setDay] = useState(vietnamDate());
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [extras, setExtras] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const loadHistory = () => api.closingHistory().then((d) => setHistory(d.closings)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    setData(null);
    setMessage('');
    api.closing(day).then((d) => {
      setData(d);
      setCounts(d.saved?.counts || {});
      setExtras((d.saved?.extras || []).map((e) => ({ ...e, amount: String(e.amount) })));
      setNote(d.saved?.note || '');
      setError('');
    }).catch((err) => setError(err.message));
  }, [day]);

  if (error && !data) return <p className="alert error">{error}</p>;
  if (!data) return <ListSkeleton rows={5} label="Đang tính số liệu…" />;

  const { lines, totals } = data.figures;
  const details = data.figures.details || { debts: [], transfers: [], cash_in: [], cash_out: [] };
  const counted = data.denominations.reduce((sum, value) => sum + value * (Number(counts[value]) || 0), 0);
  const filledExtras = extras.filter((e) => e.label.trim() && Number(e.amount) > 0);
  const extraIn = filledExtras.filter((e) => e.type === 'in').reduce((s, e) => s + Number(e.amount), 0);
  const extraOut = filledExtras.filter((e) => e.type === 'out').reduce((s, e) => s + Number(e.amount), 0);
  const cashIn = details.cash_in.reduce((s, r) => s + r.amount, 0) + extraIn;
  const cashOut = details.cash_out.reduce((s, r) => s + r.amount, 0) + extraOut;
  const expected = totals.cash + extraIn - extraOut;    // = cashIn − cashOut
  const difference = counted - expected;
  const pending = data.pending_debts || [];
  const canClose = data.can_close;
  const halfFilled = extras.some((e) => (e.label.trim() === '') !== !(Number(e.amount) > 0));
  // Đóng được khi: duyệt hết công nợ, ghi đủ các khoản thu / chi thêm, và tiền đếm khớp "Còn lại" (lệch thì ghi giải trình).
  const needsNote = difference !== 0 && note.trim().length < 10;
  const ready = canClose && pending.length === 0 && !needsNote && !halfFilled;
  // Đã đóng rồi mà sau đó phát sinh thêm (đơn giao muộn, đơn nợ mới…): phiếu đã lưu không còn khớp.
  const stale = !!data.saved && JSON.stringify(data.saved.figures?.totals) !== JSON.stringify(totals);
  const printable = !!data.saved && !stale;

  const setExtra = (i, patch) => setExtras((cur) => cur.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const addExtra = (type) => setExtras((cur) => [...cur, { type, label: '', amount: '' }]);
  const removeExtra = (i) => setExtras((cur) => cur.filter((_, j) => j !== i));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.saveClosing({
        day,
        counts: Object.fromEntries(data.denominations.map((v) => [v, Number(counts[v]) || 0])),
        extras: filledExtras.map((e) => ({ type: e.type, label: e.label.trim(), amount: Number(e.amount) })),
        note: note.trim() || null,
      });
      setData(result);
      setExtras((result.saved?.extras || []).map((e) => ({ ...e, amount: String(e.amount) })));
      setMessage('Đã đóng ngày. Có thể in báo cáo và tải tệp Excel lưu trữ.');
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const extraRow = (e, i) => (
    <tr key={`x${i}`} className="extra">
      <th scope="row">
        <span className="extra-line">
          <input className="input" value={e.label} maxLength={120} disabled={!canClose} onChange={(ev) => setExtra(i, { label: ev.target.value })}
                 placeholder={e.type === 'in' ? 'VD: Thu tiền khác' : 'VD: Đổ xăng'} aria-label={`Diễn giải khoản ${e.type === 'in' ? 'thu' : 'chi'}`} />
          {canClose && <button type="button" className="link-button danger no-print" onClick={() => removeExtra(i)} aria-label="Xoá khoản này">✕</button>}
        </span>
      </th>
      {['in', 'out'].map((col) => (
        <td key={col} className="num">
          {e.type === col && (
            <input className="input money" inputMode="numeric" value={money(e.amount)} disabled={!canClose}
                   onChange={(ev) => setExtra(i, { amount: digits(ev.target.value) })} aria-label={`Số tiền ${col === 'in' ? 'thu' : 'chi'}`} />
          )}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="admin-app closing-app">
      <header className="admin-topbar no-print">
        <div className="admin-brand"><img src="/logo-mark.png" alt="" width="38" height="38" /><div><strong>Đóng ngày</strong><small>{user?.full_name}</small></div></div>
        <div className="admin-account">
          <Link to="/quan-tri" className="btn btn-secondary">← Đơn hàng</Link>
        </div>
      </header>

      <main className="closing-main">
        <div className="closing-head">
          <div>
            <p className="closing-company">{COMPANY_SHORT}</p>
            <h1>Đóng ngày {formatDay(day)}</h1>
            {data.saved && <p className={`closing-saved${stale ? ' stale' : ''}`}>Đã đóng bởi {data.saved.closer_name} lúc {formatDateTime(data.saved.updated_at)}</p>}
          </div>
          <label className="no-print">Chọn ngày
            <input className="input" type="date" value={day} max={vietnamDate()} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
        </div>

        {stale && (
          <p className="alert warning" role="alert">
            ⚠️ Số liệu đã thay đổi sau khi đóng ngày (doanh thu trên phiếu {formatVND(data.saved.figures.totals.revenue)}, hiện tại {formatVND(totals.revenue)}).
            Kế toán cần kiểm lại và đóng lại ngày trước khi in / tải tệp.
          </p>
        )}
        <div className="closing-summary">
          <div><span>Doanh thu</span><strong>{formatVND(totals.revenue)}</strong></div>
          <div><span>Nợ trong ngày</span><strong>{formatVND(lines.online_debt.s)}</strong></div>
          <div><span>Chuyển khoản</span><strong>{formatVND(totals.transfer)}</strong></div>
          <div><span>Tiền mặt còn lại</span><strong>{formatVND(expected)}</strong></div>
        </div>

        {pending.length > 0 && (
          <div className="closing-pending" role="alert">
            <strong>Phải duyệt hết công nợ mới đóng được ngày:</strong>
            <ul>{pending.map((p) => <li key={p.id}>{p.code} · {p.contact_name}{p.company ? ` – ${p.company}` : ''} · {formatVND(p.amount)} · {p.status_label}</li>)}</ul>
            <Link className="no-print" to="/quan-tri/cong-no">Mở trang công nợ để duyệt →</Link>
          </div>
        )}

        <div className="closing-sheets">
          <Sheet title={`TỔNG NHÀ NỢ NGÀY ${shortDay(day)}`} total={lines.online_debt.s} rows={details.debts} empty="Không có khách nợ trong ngày." />
          <Sheet title="TỔNG CHUYỂN KHOẢN" total={totals.transfer} rows={details.transfers} empty="Chưa có khoản chuyển khoản nào." />

          <section className="closing-sheet">
            <h2>TỔNG TIỀN MẶT</h2>
            <table className="closing-grid cash-book">
              <thead><tr><th>Diễn giải</th><th className="num">Thu</th><th className="num">Chi</th></tr></thead>
              <tbody>
                {details.cash_in.map((row, i) => (
                  <tr key={`i${i}`}>
                    <th scope="row">{row.name}{(row.address || row.code) && <small>{[row.address, row.code].filter(Boolean).join(' · ')}</small>}</th>
                    <td className="num">{money(row.amount)}</td><td />
                  </tr>
                ))}
                {details.cash_out.map((row, i) => (
                  <tr key={`o${i}`}><th scope="row">{row.name}</th><td /><td className="num">{money(row.amount)}</td></tr>
                ))}
                {extras.map(extraRow)}
                {!details.cash_in.length && !details.cash_out.length && !extras.length && <tr><td colSpan={3} className="muted">Chưa có khoản thu tiền mặt nào.</td></tr>}
                {canClose && (
                  <tr className="no-print add-extra">
                    <td colSpan={3}>
                      <button type="button" className="link-button" onClick={() => addExtra('out')}>+ Thêm khoản chi</button>
                      <button type="button" className="link-button" onClick={() => addExtra('in')}>+ Thêm khoản thu khác</button>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="total"><th>TỔNG</th><td className="num">{money(cashIn) || '0'}</td><td className="num">{money(cashOut) || '0'}</td></tr>
                <tr className="remain"><th>CÒN LẠI</th><td className="num" colSpan={2}>{formatVND(expected)}</td></tr>
              </tfoot>
            </table>
            {halfFilled && <small className="err">Khoản thu / chi thêm cần ghi đủ diễn giải và số tiền.</small>}
          </section>

          <section className="closing-sheet">
            <h2 className="cash-title">TỔNG TIỀN MẶT <small>kê loại tiền</small></h2>
            <table className="closing-grid cash-count">
              <thead><tr><th>Loại tiền</th><th className="num">Số tờ</th><th className="num">Tổng tiền</th></tr></thead>
              <tbody>
                {data.denominations.map((value) => (
                  <tr key={value}>
                    <th scope="row" className="num">{money(value)}</th>
                    <td className="num">
                      <input className="input" type="number" min="0" inputMode="numeric" value={counts[value] ?? ''} disabled={!canClose}
                             onChange={(e) => setCounts((cur) => ({ ...cur, [value]: e.target.value.replace(/\D/g, '') }))} aria-label={`Số tờ ${value}`} />
                    </td>
                    <td className="num">{Number(counts[value]) ? money(value * Number(counts[value])) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="grand"><th>TỔNG</th><td /><td className="num">{money(counted) || '0'}</td></tr>
                <tr className={difference === 0 ? 'ok' : 'diff'}>
                  <th colSpan={2}>So với còn lại</th>
                  <td className="num">{difference === 0 ? 'Khớp ✓' : `${difference > 0 ? 'Thừa' : 'Thiếu'} ${money(Math.abs(difference))}`}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        </div>

        <p className="closing-debt-open">
          Tổng công nợ đang mở (tất cả các ngày): <strong>{formatVND(totals.debt_open)}</strong>
          {(lines.debt_collected_cash.n + lines.debt_collected_transfer.n) > 0 && <> · Thu nợ hôm nay: <strong>{formatVND(lines.debt_collected_cash.s + lines.debt_collected_transfer.s)}</strong></>}
          <Link className="no-print" to="/quan-tri/cong-no"> · Mở trang công nợ →</Link>
        </p>

        <label className={`closing-note${note.trim() ? '' : ' no-print'}`}>Ghi chú
          <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canClose}
                    placeholder="VD: Đã nộp 5.000.000đ cho chị Linh lúc 18h" aria-invalid={needsNote} />
          {needsNote && canClose && <small className="err">Tiền đếm {difference > 0 ? 'thừa' : 'thiếu'} {formatVND(Math.abs(difference))} so với còn lại: đếm lại, hoặc ghi giải trình (ít nhất 10 ký tự).</small>}
        </label>
        <div className="closing-sign print-only">
          <span>Người lập: {data.saved?.closer_name || user?.full_name}<br />Ký tên</span>
          <span>Chủ cửa hàng<br />Ký tên</span>
        </div>

        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}
        <div className="form-actions no-print">
          {canClose && (
            <button type="button" className="btn btn-primary btn-large" disabled={busy || !ready} onClick={save}>
              {busy ? 'Đang lưu…' : data.saved ? 'Đóng lại ngày (cập nhật phiếu)' : '✅ Đóng ngày'}
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-large" disabled={!printable} onClick={() => window.print()}>🖨️ In báo cáo</button>
          <button type="button" className="btn btn-secondary btn-large" disabled={!printable}
                  onClick={() => api.downloadClosing(day).catch((err) => setError(err.message))}>📥 Tải tệp Excel</button>
        </div>
        {!canClose && <p className="field-help no-print">Tài khoản của bạn chỉ xem báo cáo; kế toán là người đóng ngày.</p>}
        {canClose && !data.saved && !ready && (
          <p className="field-help no-print">
            {pending.length ? 'Chưa đóng được: còn công nợ chờ duyệt. ' : ''}{needsNote ? 'Chưa đóng được: tiền đếm chưa khớp còn lại. ' : ''}
            In và tải tệp sau khi đóng ngày.
          </p>
        )}
        {history.length > 0 && (
          <details className="closing-section no-print">
            <summary>Các ngày đã đóng ({history.length})</summary>
            <table className="closing-table"><tbody>
              {history.map((h) => (
                <tr key={h.day}>
                  <th scope="row"><button type="button" className="link-button" onClick={() => setDay(h.day)}>{formatDay(h.day)}</button><small> · {h.closer_name}</small></th>
                  <td className="num">{formatVND(h.revenue)}</td>
                  <td className="num">{h.difference === 0 ? 'Khớp ✓' : `Lệch ${formatVND(h.difference)}`}</td>
                  <td className="num"><button type="button" className="link-button" onClick={() => api.downloadClosing(h.day).catch((err) => setError(err.message))}>Excel</button></td>
                </tr>
              ))}
            </tbody></table>
          </details>
        )}
        <p className="field-help no-print">
          Nợ, chuyển khoản và tiền mặt máy tự tổng hợp: đơn online tính vào ngày giao xong; bán quầy và trả hàng theo ngày lập phiếu;
          thu nợ theo ngày kế toán ký đã thu. Khoản chi (đổ xăng…) và số tờ tiền do kế toán ghi.
        </p>
      </main>
    </div>
  );
}
