import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatVND } from '../api';

/** Ngày hôm nay theo giờ máy của người dùng, dạng YYYY-MM-DD. */
function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const monthOf = (day) => day.slice(0, 7);

/** Lùi n ngày kể từ hôm nay. */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayLabel = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

export default function RevenueReport() {
  const today = todayLocal();

  const [mode, setMode] = useState('month');          // day | month | range
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(monthOf(today));
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filters = useMemo(() => {
    if (mode === 'day') return { period: 'day', date };
    if (mode === 'range') return { period: 'range', from, to };
    return { period: 'month', month };
  }, [mode, date, month, from, to]);

  const load = useCallback(async (f) => {
    setLoading(true);
    setError('');
    try {
      setData(await api.adminRevenue(f));
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [load, filters]);

  // Cột cao nhất dùng làm mốc để vẽ biểu đồ.
  const maxDay = useMemo(
    () => (data?.daily?.length ? Math.max(...data.daily.map((d) => d.total)) : 0),
    [data]
  );

  const quick = (nextMode, patch = {}) => {
    setMode(nextMode);
    if (patch.date) setDate(patch.date);
    if (patch.month) setMonth(patch.month);
    if (patch.from) setFrom(patch.from);
    if (patch.to) setTo(patch.to);
  };

  return (
    <section aria-label="Báo cáo doanh thu">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow dark"><span></span>Báo cáo</p>
          <h1>Doanh thu</h1>
          <p>Gộp đơn online đã hoàn thành và hoá đơn bán tại quầy.</p>
        </div>
      </div>

      {/* --- Chọn kỳ --- */}
      <div className="revenue-filter">
        <div className="revenue-quick" role="group" aria-label="Chọn nhanh">
          <button type="button" className={mode === 'day' && date === today ? 'active' : ''}
                  onClick={() => quick('day', { date: today })}>Hôm nay</button>
          <button type="button" className={mode === 'day' && date === daysAgo(1) ? 'active' : ''}
                  onClick={() => quick('day', { date: daysAgo(1) })}>Hôm qua</button>
          <button type="button" className={mode === 'range' && from === daysAgo(6) && to === today ? 'active' : ''}
                  onClick={() => quick('range', { from: daysAgo(6), to: today })}>7 ngày</button>
          <button type="button" className={mode === 'month' && month === monthOf(today) ? 'active' : ''}
                  onClick={() => quick('month', { month: monthOf(today) })}>Tháng này</button>
          <button type="button"
                  className={mode === 'month' && month === monthOf(daysAgo(new Date().getDate())) ? 'active' : ''}
                  onClick={() => quick('month', { month: monthOf(daysAgo(new Date().getDate())) })}>
            Tháng trước
          </button>
        </div>

        <div className="revenue-inputs">
          <label>Xem theo
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="day">Một ngày</option>
              <option value="month">Một tháng</option>
              <option value="range">Khoảng ngày</option>
            </select>
          </label>

          {mode === 'day' && (
            <label>Ngày
              <input className="input" type="date" value={date} max={today}
                     onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          {mode === 'month' && (
            <label>Tháng
              <input className="input" type="month" value={month} max={monthOf(today)}
                     onChange={(e) => setMonth(e.target.value)} />
            </label>
          )}
          {mode === 'range' && (
            <>
              <label>Từ ngày
                <input className="input" type="date" value={from} max={to}
                       onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>Đến ngày
                <input className="input" type="date" value={to} min={from} max={today}
                       onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}{' '}
          <button type="button" className="link-button" onClick={() => load(filters)}>Thử lại</button>
        </div>
      )}

      {loading ? (
        <div className="loading-state" role="status"><span></span>Đang tính doanh thu…</div>
      ) : data && (
        <>
          <p className="revenue-period">Kỳ báo cáo: <strong>{data.period.label}</strong></p>

          <section className="stats" aria-label="Tổng hợp doanh thu">
            <div className="stat urgent">
              <span>Tổng doanh thu</span>
              <strong>{formatVND(data.total.revenue)}</strong>
              <small>{data.total.transactions} giao dịch</small>
            </div>
            <div className="stat">
              <span>Bán online</span>
              <strong>{formatVND(data.online.revenue)}</strong>
              <small>{data.online.orders} đơn đã hoàn thành</small>
            </div>
            <div className="stat">
              <span>Bán tại quầy</span>
              <strong>{formatVND(data.retail.revenue)}</strong>
              <small>{data.retail.invoices} hoá đơn</small>
            </div>
            <div className="stat">
              <span>Đã giảm cho khách</span>
              <strong>{formatVND(data.retail.discount)}</strong>
              <small>Giảm giá tại quầy</small>
            </div>
          </section>

          {data.daily.length === 0 ? (
            <div className="admin-empty">
              <span>—</span>
              <h2>Kỳ này chưa có doanh thu</h2>
              <p>Chưa có đơn online hoàn thành hoặc hoá đơn bán tại quầy nào trong khoảng đã chọn.</p>
            </div>
          ) : (
            <div className="revenue-table-wrap">
              <table className="revenue-table">
                <caption className="sr-only">Doanh thu theo từng ngày</caption>
                <thead>
                  <tr>
                    <th scope="col">Ngày</th>
                    <th scope="col">Online</th>
                    <th scope="col">Tại quầy</th>
                    <th scope="col">Tổng</th>
                    <th scope="col" className="revenue-bar-col">So sánh</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.day}>
                      <th scope="row">{dayLabel(d.day)}</th>
                      <td>{d.online > 0 ? formatVND(d.online) : '—'}</td>
                      <td>{d.retail > 0 ? formatVND(d.retail) : '—'}</td>
                      <td><strong>{formatVND(d.total)}</strong></td>
                      <td className="revenue-bar-col">
                        <span className="revenue-bar" aria-hidden="true">
                          <i style={{ width: `${maxDay ? (d.total / maxDay) * 100 : 0}%` }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Cộng</th>
                    <td>{formatVND(data.online.revenue)}</td>
                    <td>{formatVND(data.retail.revenue)}</td>
                    <td><strong>{formatVND(data.total.revenue)}</strong></td>
                    <td className="revenue-bar-col"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
