import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime, formatVND, vietnamDate } from '../api';
import { useAuth } from '../context/AuthContext.jsx';

const formatDay = (day) => day.split('-').reverse().join('/');
const Row = ({ label, line, minus = false, strong = false }) => (
  <tr className={strong ? 'strong' : ''}>
    <th scope="row">{label}{line?.n ? <small> ({line.n})</small> : null}</th>
    <td className="num">{minus && line?.s ? '− ' : ''}{formatVND(line?.s ?? line ?? 0)}</td>
  </tr>
);

/**
 * /quan-tri/dong-ngay — kế toán đóng ngày: doanh thu trong ngày, chuyển khoản, tiền mặt (kê từng loại
 * tờ tiền, so với sổ sách), công nợ. Lưu phiếu và in ra báo cáo cuối ngày.
 */
export default function DayClosing() {
  const { user } = useAuth();
  const [day, setDay] = useState(vietnamDate());
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    setData(null);
    setMessage('');
    api.closing(day).then((d) => {
      setData(d);
      setCounts(d.saved?.counts || {});
      setNote(d.saved?.note || '');
      setError('');
    }).catch((err) => setError(err.message));
  }, [day]);

  // In: mở hết các mục để không thiếu số liệu trên giấy.
  useEffect(() => {
    const open = () => formRef.current?.querySelectorAll('details').forEach((d) => { d.open = true; });
    window.addEventListener('beforeprint', open);
    return () => window.removeEventListener('beforeprint', open);
  }, []);

  if (error && !data) return <p className="alert error">{error}</p>;
  if (!data) return <div className="loading-state page-loading" role="status"><span></span>Đang tính số liệu…</div>;

  const { lines, totals } = data.figures;
  const counted = data.denominations.reduce((sum, value) => sum + value * (Number(counts[value]) || 0), 0);
  const difference = counted - totals.cash;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.saveClosing({ day, counts: Object.fromEntries(data.denominations.map((v) => [v, Number(counts[v]) || 0])), note: note.trim() || null });
      setData(result);
      setMessage('Đã lưu phiếu đóng ngày.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-app closing-app">
      <header className="admin-topbar no-print">
        <div className="admin-brand"><img src="/logo-mark.png" alt="" width="38" height="38" /><div><strong>Đóng ngày</strong><small>{user?.full_name}</small></div></div>
        <div className="admin-account">
          <Link to="/quan-tri" className="btn btn-secondary">← Đơn hàng</Link>
        </div>
      </header>

      <main className="closing-main" ref={formRef}>
        <div className="closing-head">
          <div>
            <p className="eyebrow dark"><span></span>Báo cáo cuối ngày · Gạo Kinh Bắc</p>
            <h1>Đóng ngày {formatDay(day)}</h1>
            {data.saved && <p className="closing-saved">Đã đóng bởi {data.saved.closer_name} lúc {formatDateTime(data.saved.updated_at)}</p>}
          </div>
          <label className="no-print">Chọn ngày
            <input className="input" type="date" value={day} max={vietnamDate()} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
        </div>

        <div className="closing-summary">
          <div><span>Doanh thu hôm nay</span><strong>{formatVND(totals.revenue)}</strong></div>
          <div><span>Chuyển khoản</span><strong>{formatVND(totals.transfer)}</strong></div>
          <div><span>Tiền mặt (sổ sách)</span><strong>{formatVND(totals.cash)}</strong></div>
          <div><span>Công nợ phát sinh</span><strong>{formatVND(totals.debt_new)}</strong></div>
        </div>

        <details open className="closing-section">
          <summary>Doanh thu hôm nay — {formatVND(totals.revenue)}</summary>
          <table className="closing-table"><tbody>
            <Row label="Đơn online giao xong — tiền mặt" line={lines.online_cash} />
            <Row label="Đơn online giao xong — chuyển khoản" line={lines.online_transfer} />
            <Row label="Đơn online giao xong — công nợ (chưa thu)" line={lines.online_debt} />
            <Row label="Bán tại quầy — tiền mặt" line={lines.retail_cash} />
            <Row label="Bán tại quầy — chuyển khoản" line={lines.retail_transfer} />
            <Row label="Trả hàng hoàn tiền mặt" line={lines.refund_cash} minus />
            <Row label="Trả hàng hoàn chuyển khoản" line={lines.refund_transfer} minus />
            <Row label="Tổng doanh thu" line={totals.revenue} strong />
          </tbody></table>
        </details>

        <details open className="closing-section">
          <summary>Chuyển khoản — {formatVND(totals.transfer)}</summary>
          <table className="closing-table"><tbody>
            <Row label="Đơn online" line={lines.online_transfer} />
            <Row label="Bán tại quầy" line={lines.retail_transfer} />
            <Row label="Thu nợ bằng chuyển khoản" line={lines.debt_collected_transfer} />
            <Row label="Hoàn tiền chuyển khoản" line={lines.refund_transfer} minus />
            <Row label="Tổng chuyển khoản" line={totals.transfer} strong />
          </tbody></table>
        </details>

        <details open className="closing-section">
          <summary>Tiền mặt — sổ sách {formatVND(totals.cash)} · đếm được {formatVND(counted)}</summary>
          <table className="closing-table"><tbody>
            <Row label="Đơn online giao xong" line={lines.online_cash} />
            <Row label="Bán tại quầy" line={lines.retail_cash} />
            <Row label="Thu nợ bằng tiền mặt" line={lines.debt_collected_cash} />
            <Row label="Hoàn tiền mặt" line={lines.refund_cash} minus />
            <Row label="Tổng tiền mặt theo sổ sách" line={totals.cash} strong />
          </tbody></table>
          <h3>Kê loại tiền</h3>
          <table className="closing-table cash-count">
            <thead><tr><th>Mệnh giá</th><th className="num">Số tờ</th><th className="num">Thành tiền</th></tr></thead>
            <tbody>
              {data.denominations.map((value) => (
                <tr key={value}>
                  <th scope="row">{formatVND(value)}</th>
                  <td className="num">
                    <input className="input" type="number" min="0" inputMode="numeric" value={counts[value] ?? ''}
                           onChange={(e) => setCounts((cur) => ({ ...cur, [value]: e.target.value.replace(/\D/g, '') }))} aria-label={`Số tờ ${value}`} />
                  </td>
                  <td className="num">{formatVND(value * (Number(counts[value]) || 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>Tổng tiền mặt đếm được</th><td></td><td className="num">{formatVND(counted)}</td></tr>
              <tr className={difference === 0 ? 'ok' : 'diff'}>
                <th>Chênh lệch so với sổ sách</th><td></td>
                <td className="num">{difference > 0 ? '+' : ''}{formatVND(difference)}{difference === 0 ? ' ✓' : difference > 0 ? ' (thừa)' : ' (thiếu)'}</td>
              </tr>
            </tfoot>
          </table>
        </details>

        <details open className="closing-section">
          <summary>Công nợ</summary>
          <table className="closing-table"><tbody>
            <Row label="Công nợ phát sinh trong ngày" line={lines.online_debt} />
            <Row label="Thu nợ trong ngày" line={{ n: lines.debt_collected_cash.n + lines.debt_collected_transfer.n, s: lines.debt_collected_cash.s + lines.debt_collected_transfer.s }} />
            <Row label="Tổng công nợ đang mở (tất cả các ngày)" line={totals.debt_open} strong />
          </tbody></table>
          <p className="no-print"><Link to="/quan-tri/cong-no">Mở trang theo dõi công nợ →</Link></p>
        </details>

        <label className="closing-note">Ghi chú
          <textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Đã nộp 5.000.000đ cho chị Linh lúc 18h" />
        </label>
        <p className="closing-sign print-only">Người lập: {user?.full_name} &nbsp;&nbsp;&nbsp;&nbsp; Ký tên: ______________________</p>

        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}
        <div className="form-actions no-print">
          <button type="button" className="btn btn-primary btn-large" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : data.saved ? 'Lưu lại phiếu đóng ngày' : 'Lưu phiếu đóng ngày'}</button>
          <button type="button" className="btn btn-secondary btn-large" onClick={() => window.print()}>🖨️ In báo cáo</button>
        </div>
        <p className="field-help no-print">
          Đơn online tính vào ngày giao xong; bán quầy và trả hàng theo ngày lập phiếu; thu nợ theo ngày kế toán ký đã thu.
        </p>
      </main>
    </div>
  );
}
