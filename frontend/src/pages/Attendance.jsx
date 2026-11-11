import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import StaffNav from '../components/StaffNav.jsx';

const TZ = 'Asia/Ho_Chi_Minh';
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayLabel = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};
const hours = (minutes) => (minutes == null ? '—' : `${Math.floor(minutes / 60)}g${String(minutes % 60).padStart(2, '0')}`);
const cong = (value) => String(value).replace('.', ',');
const nowClock = () => new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const todayTitle = () => new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

/**
 * /quan-tri/cham-cong — chấm công cho nhân viên giao hàng, kế toán, quản lý: chấm vào / ra trong ngày,
 * xem lịch sử của mình theo tháng. Người có quyền chấm công (kế toán, chủ cửa hàng) xem thêm bảng
 * công cả tháng của mọi người và sửa giờ cho người quên chấm.
 */
export default function Attendance() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const manager = can('attendance.manage');
  const [month, setMonth] = useState('');
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(nowClock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(nowClock()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadMine = useCallback(async () => {
    try {
      const data = await api.attendanceMe(month);
      setMine(data);
      if (!month) setMonth(data.month);
      setError('');
    } catch (err) { setError(err.message); }
  }, [month]);
  useEffect(() => { loadMine(); }, [loadMine]);

  const punch = async (kind) => {
    if (kind === 'out' && !window.confirm('Chấm công ra và kết thúc ca hôm nay?')) return;
    setBusy(true);
    try {
      const data = kind === 'in' ? await api.attendanceClockIn() : await api.attendanceClockOut();
      setMine(month && month !== data.month ? { ...mine, record: data.record } : data);
      setError('');
    } catch (err) {
      setError(err.message);
      loadMine();
    } finally { setBusy(false); }
  };

  const record = mine?.record;
  return (
    <div className="admin-app attendance-app">
      <header className="admin-topbar">
        <div className="admin-brand"><img src="/logo-mark.png" alt="" width="38" height="38" /><div><strong>Chấm công</strong><small>{user?.full_name}</small></div></div>
        <div className="admin-account">
          <button className="btn btn-ghost" onClick={() => { logout(); navigate('/'); }}>Đăng xuất</button>
        </div>
      </header>
      <StaffNav />

      <main className="attendance-main">
        {error && <p className="alert error" role="alert">{error}</p>}

        <section className={`att-clock${record?.open ? ' working' : record ? ' done' : ''}`} aria-live="polite">
          <p className="att-date">{todayTitle()}</p>
          <strong className="att-now">{clock}</strong>
          {!mine ? <p className="att-status">Đang tải…</p> : !record ? (
            <>
              <p className="att-status">Hôm nay bạn chưa chấm công.</p>
              <button type="button" className="btn btn-primary att-punch" disabled={busy} onClick={() => punch('in')}>
                {busy ? 'Đang chấm…' : '☀️ Chấm công vào'}
              </button>
            </>
          ) : record.open ? (
            <>
              <p className="att-status">Đã vào ca lúc <b>{record.in_time}</b>. Hết ca nhớ chấm ra nhé.</p>
              <button type="button" className="btn att-punch att-out" disabled={busy} onClick={() => punch('out')}>
                {busy ? 'Đang chấm…' : '🌙 Chấm công ra'}
              </button>
            </>
          ) : (
            <p className="att-status">
              Hôm nay: vào <b>{record.in_time}</b> · ra <b>{record.out_time}</b> · {hours(record.minutes)} ·{' '}
              <b className="att-cong">{cong(record.cong)} công</b>
            </p>
          )}
          <small className="att-rule">Từ {mine?.full_day_hours || 7} tiếng trở lên = 1 công · dưới {mine?.full_day_hours || 7} tiếng = 0,5 công · chưa chấm ra thì chưa tính công. Giờ lấy theo máy chủ của cửa hàng.</small>
        </section>

        <section className="att-section">
          <div className="att-section-head">
            <h2>Lịch sử chấm công của tôi</h2>
            <label className="att-month">Tháng
              <input className="input" type="month" value={month} max={mine?.today?.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>
          {mine && (
            <>
              <p className="att-total">
                Tháng này: <b>{cong(mine.totals.cong)} công</b> · {mine.totals.days} ngày · {hours(mine.totals.minutes)}
                {mine.totals.open > 0 && <span className="att-warn"> · {mine.totals.open} ngày chưa chấm ra</span>}
              </p>
              {mine.days.length === 0 ? <p className="muted">Chưa có ngày công nào trong tháng này.</p> : (
                <div className="table-scroll">
                  <table className="att-table">
                    <thead><tr><th>Ngày</th><th>Vào</th><th>Ra</th><th className="num">Số giờ</th><th className="num">Số công</th><th>Ghi chú</th></tr></thead>
                    <tbody>
                      {mine.days.map((d) => (
                        <tr key={d.id} className={d.open ? 'att-open' : ''}>
                          <td>{dayLabel(d.work_date)}</td>
                          <td>{d.in_time}</td>
                          <td>{d.out_time || <span className="att-warn">Chưa chấm ra</span>}</td>
                          <td className="num">{hours(d.minutes)}</td>
                          <td className="num"><b>{cong(d.cong)}</b></td>
                          <td className="att-note">{d.note ? `${d.note}${d.edited_by_name ? ` (${d.edited_by_name} sửa)` : ''}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        {manager && <MonthBoard month={month} selfId={user?.id} isAdmin={isAdmin} onSaved={loadMine} />}
      </main>
    </div>
  );
}

/** Bảng công cả tháng: mỗi người một dòng, mỗi ngày một ô; bấm ô để sửa / bổ sung giờ. */
function MonthBoard({ month, selfId, isAdmin, onSaved }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null);   // { person, day, in_time, out_time, note, errors }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!month) return;
    try { setData(await api.attendanceMonth(month)); setError(''); } catch (err) { setError(err.message); }
  }, [month]);
  useEffect(() => { load(); setEdit(null); }, [load]);

  const days = useMemo(() => Array.from({ length: data?.days_in_month || 0 }, (_, i) => i + 1), [data]);
  const dateOf = (day) => `${data.month}-${String(day).padStart(2, '0')}`;
  const open = (person, day) => {
    const r = person.days[day];
    setEdit({ person, day, in_time: r?.in_time || '', out_time: r?.out_time || '', note: '', errors: {}, exists: !!r });
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.attendanceSaveEntry({ user_id: edit.person.id, work_date: dateOf(edit.day), in_time: edit.in_time, out_time: edit.out_time, note: edit.note });
      setEdit(null);
      await load();
      if (edit.person.id === selfId) onSaved();
    } catch (err) {
      setEdit((cur) => ({ ...cur, errors: err.errors || { form: err.message } }));
    } finally { setBusy(false); }
  };

  return (
    <section className="att-section">
      <div className="att-section-head">
        <h2>Bảng công tháng {month ? `${month.slice(5)}/${month.slice(0, 4)}` : ''}</h2>
        <small className="muted">Bấm vào một ô để sửa hoặc bổ sung giờ cho người quên chấm.</small>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      {data && (
        <div className="table-scroll att-board-wrap">
          <table className="att-board">
            <thead>
              <tr>
                <th className="att-person">Nhân viên</th>
                {days.map((d) => <th key={d} className={dateOf(d) === data.today ? 'today' : ''}>{d}</th>)}
                <th className="att-sum">Tổng công</th>
                <th className="att-sum">Số giờ</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((p) => (
                <tr key={p.id}>
                  <th className="att-person" scope="row">{p.full_name}{p.staff_title && <small>{p.staff_title}</small>}</th>
                  {days.map((d) => {
                    const r = p.days[d];
                    const future = dateOf(d) > data.today;
                    const locked = future || (!isAdmin && p.id === selfId);
                    const label = r ? (r.open ? '?' : cong(r.cong)) : '';
                    return (
                      <td key={d} className={`${r?.open ? 'open' : r ? `c${String(r.cong).replace('.', '')}` : ''}${dateOf(d) === data.today ? ' today' : ''}`}>
                        {locked ? label : (
                          <button type="button" onClick={() => open(p, d)}
                                  title={r ? `${r.in_time} – ${r.out_time || 'chưa chấm ra'}` : 'Chưa chấm'}
                                  aria-label={`${p.full_name} ngày ${d}: ${r ? `${r.in_time} đến ${r.out_time || 'chưa chấm ra'}` : 'chưa chấm'}`}>
                            {label || '·'}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="att-sum"><b>{cong(p.totals.cong)}</b>{p.totals.open > 0 && <small className="att-warn">{p.totals.open} chưa ra</small>}</td>
                  <td className="att-sum">{hours(p.totals.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="att-legend"><span className="c1">1</span> đủ công <span className="c05">0,5</span> nửa công <span className="open">?</span> chưa chấm ra</p>

      {edit && (
        <form className="att-edit" onSubmit={save}>
          <h3>{edit.person.full_name} · {dayLabel(dateOf(edit.day))}</h3>
          <div className="att-edit-row">
            <label>Giờ vào<input className="input" type="time" value={edit.in_time} onChange={(e) => setEdit({ ...edit, in_time: e.target.value })} /></label>
            <label>Giờ ra<input className="input" type="time" value={edit.out_time} onChange={(e) => setEdit({ ...edit, out_time: e.target.value })} /></label>
          </div>
          {(edit.errors.in_time || edit.errors.out_time) && <small className="err">{edit.errors.in_time || edit.errors.out_time}</small>}
          <label>Lý do sửa<input className="input" value={edit.note} maxLength={300} placeholder="Ví dụ: quên chấm ra, điện thoại hết pin"
                                 onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
          {edit.errors.note && <small className="err">{edit.errors.note}</small>}
          {edit.errors.form && <p className="alert error" role="alert">{edit.errors.form}</p>}
          <p className="muted">Bỏ trống giờ vào rồi lưu để xoá ngày công chấm nhầm.</p>
          <div className="att-edit-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : edit.in_time || !edit.exists ? 'Lưu giờ công' : 'Xoá ngày công'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>Đóng</button>
          </div>
        </form>
      )}
    </section>
  );
}
