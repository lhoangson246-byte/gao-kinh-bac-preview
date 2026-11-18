import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import StaffNav from '../components/StaffNav.jsx';
import { ListSkeleton } from '../components/Skeleton.jsx';
import { toast } from '../components/Toasts.jsx';

const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayLabel = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};
const cong = (value) => String(value).replace('.', ',');
const congLabel = (value) => (value === 0 ? 'Nghỉ' : `${cong(value)} công`);
const cellClass = (r) => (!r ? '' : r.open ? 'open' : r.cong === 0 ? 'off' : `c${String(r.cong).replace('.', '')}`);
const cellText = (r) => (!r ? '' : r.open ? '?' : r.cong === 0 ? 'N' : cong(r.cong));
// Các lựa chọn khi quản lý bấm một ô: [số công gửi lên máy chủ, nhãn nút].
const CHOICES = [[1, '1 công'], [0.5, '0,5 công'], [0, 'Nghỉ']];

/**
 * /quan-tri/cham-cong — từ 18/11/2026 chỉ QUẢN LÝ chấm công: tích 1 công, 0,5 công hoặc Nghỉ cho từng nhân
 * viên mỗi ngày, xem bảng công cả tháng. Nhân viên xem công của chính mình (không tự chấm vào / ra nữa).
 */
export default function Attendance() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const manager = can('attendance.manage');
  const [month, setMonth] = useState('');
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');

  const loadMine = useCallback(async () => {
    try {
      const data = await api.attendanceMe(month);
      setMine(data);
      if (!month) setMonth(data.month);
      setError('');
    } catch (err) { setError(err.message); }
  }, [month]);
  useEffect(() => { loadMine(); }, [loadMine]);

  const monthPicker = (
    <label className="att-month">Tháng
      <input className="input" type="month" value={month} max={mine?.today?.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
    </label>
  );

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
        <p className="alert info att-rule-box">
          {manager
            ? <>Quản lý tích công cho từng người mỗi ngày: <b>1 công</b>, <b>0,5 công</b> hoặc <b>Nghỉ</b>. Bấm vào ô để tích; bấm số ngày ở đầu cột để tích nhanh cho những người chưa có công hôm đó.</>
            : <>Chấm công do <b>quản lý</b> thực hiện (1 công hoặc 0,5 công mỗi ngày). Nếu thấy thiếu công, vui lòng báo quản lý.</>}
        </p>

        {manager && <MonthBoard month={month} monthPicker={monthPicker} selfId={user?.id} isAdmin={isAdmin} onSaved={loadMine} />}

        <section className="att-section">
          <div className="att-section-head">
            <h2>Công của tôi</h2>
            {!manager && monthPicker}
          </div>
          {!mine ? <ListSkeleton rows={2} label="Đang tải công của tôi…" /> : (
            <>
              <p className="att-total">
                Tháng {mine.month.slice(5)}/{mine.month.slice(0, 4)}: <b>{cong(mine.totals.cong)} công</b> · {mine.totals.days} ngày đi làm
                {mine.totals.off > 0 && <> · {mine.totals.off} ngày nghỉ</>}
              </p>
              {mine.days.length === 0 ? <p className="muted">Quản lý chưa chấm công cho bạn trong tháng này.</p> : (
                <ul className="att-mine">
                  {mine.days.map((d) => (
                    <li key={d.work_date} className={cellClass(d)}>
                      <span>{dayLabel(d.work_date)}</span>
                      <b>{d.open ? 'Chưa chấm ra' : congLabel(d.cong)}</b>
                      <small>
                        {d.source === 'mark'
                          ? `${d.marked_by_name ? `${d.marked_by_name} chấm` : 'Quản lý chấm'}${d.note ? ` · ${d.note}` : ''}`
                          : `Tự chấm (cách cũ) ${d.in_time || ''}${d.out_time ? ` – ${d.out_time}` : ''}`}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

/** Bảng công cả tháng: mỗi người một dòng, mỗi ngày một ô; bấm ô để tích 1 / 0,5 / Nghỉ. */
function MonthBoard({ month, monthPicker, selfId, isAdmin, onSaved }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState(null);   // { people: [person], day, bulk }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!month) return;
    try { setData(await api.attendanceMonth(month)); setError(''); } catch (err) { setError(err.message); }
  }, [month]);
  useEffect(() => { load(); setPick(null); }, [load]);

  const days = useMemo(() => Array.from({ length: data?.days_in_month || 0 }, (_, i) => i + 1), [data]);
  const dateOf = (day) => `${data.month}-${String(day).padStart(2, '0')}`;
  const markable = (person) => isAdmin || person.id !== selfId;
  const openCell = (person, day) => { setNote(''); setPick({ people: [person], day, bulk: false }); };
  const openColumn = (day) => {
    const people = data.staff.filter((p) => markable(p) && !p.days[day]);
    if (!people.length) { toast(`Ngày ${day}: mọi người đều đã có công.`); return; }
    setNote('');
    setPick({ people, day, bulk: true });
  };

  const save = async (units) => {
    setBusy(true);
    try {
      const result = await api.attendanceMark({
        user_ids: pick.people.map((p) => p.id), work_date: dateOf(pick.day), units, note: note.trim() || null, only_empty: pick.bulk,
      });
      const who = pick.bulk ? `${result.changed} người` : pick.people[0].full_name;
      toast(units === null ? `Đã bỏ công ngày ${pick.day} của ${who}.` : `Đã chấm ${congLabel(units)} ngày ${pick.day} cho ${who}.`);
      setPick(null);
      await load();
      if (pick.people.some((p) => p.id === selfId)) onSaved();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally { setBusy(false); }
  };

  const current = pick && !pick.bulk ? pick.people[0].days[pick.day] : null;
  return (
    <section className="att-section">
      <div className="att-section-head">
        <h2>Bảng công tháng {month ? `${month.slice(5)}/${month.slice(0, 4)}` : ''}</h2>
        {monthPicker}
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      {!data ? <ListSkeleton rows={4} label="Đang tải bảng công…" /> : (
        <div className="table-scroll att-board-wrap">
          <table className="att-board">
            <thead>
              <tr>
                <th className="att-person">Nhân viên</th>
                {days.map((d) => {
                  const future = dateOf(d) > data.today;
                  return (
                    <th key={d} className={dateOf(d) === data.today ? 'today' : ''}>
                      {future ? d : <button type="button" onClick={() => openColumn(d)} title={`Tích nhanh ngày ${d} cho người chưa có công`} aria-label={`Tích nhanh ngày ${d}`}>{d}</button>}
                    </th>
                  );
                })}
                <th className="att-sum">Tổng công</th>
                <th className="att-sum">Nghỉ</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((p) => (
                <tr key={p.id}>
                  <th className="att-person" scope="row">{p.full_name}{p.staff_title && <small>{p.staff_title}</small>}</th>
                  {days.map((d) => {
                    const r = p.days[d];
                    const locked = dateOf(d) > data.today || !markable(p);
                    const active = pick && !pick.bulk && pick.day === d && pick.people[0].id === p.id;
                    return (
                      <td key={d} className={`${cellClass(r)}${dateOf(d) === data.today ? ' today' : ''}${active ? ' picking' : ''}`}>
                        {locked ? cellText(r) : (
                          <button type="button" onClick={() => openCell(p, d)}
                                  aria-label={`${p.full_name} ngày ${d}: ${r ? (r.open ? 'chưa chấm ra' : congLabel(r.cong)) : 'chưa chấm'}`}>
                            {cellText(r) || '·'}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="att-sum"><b>{cong(p.totals.cong)}</b></td>
                  <td className="att-sum">{p.totals.off || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="att-legend"><span className="c1">1</span> đủ công <span className="c05">0,5</span> nửa công <span className="off">N</span> nghỉ <span className="open">?</span> ngày cũ chưa chấm ra</p>

      {pick && (
        <div className="att-pick" role="dialog" aria-label="Chấm công">
          <h3>
            {pick.bulk ? `Tích nhanh ngày ${pick.day} cho ${pick.people.length} người chưa có công` : `${pick.people[0].full_name} · ${dayLabel(dateOf(pick.day))}`}
          </h3>
          {current && <p className="muted">Đang là: <b>{current.open ? 'chưa chấm ra' : congLabel(current.cong)}</b>{current.marked_by_name ? ` (${current.marked_by_name} chấm)` : ''}</p>}
          {pick.bulk && <p className="muted">{pick.people.map((p) => p.full_name).join(', ')}</p>}
          <div className="att-pick-choices">
            {CHOICES.map(([units, label]) => (
              <button key={label} type="button" className={`btn ${units === 0 ? 'btn-secondary' : 'btn-primary'}${current?.cong === units && current?.source === 'mark' ? ' current' : ''}`}
                      disabled={busy} onClick={() => save(units)}>{label}</button>
            ))}
            {current?.source === 'mark' && <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => save(null)}>Bỏ chấm</button>}
          </div>
          <label>Ghi chú <small className="optional">không bắt buộc</small>
            <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: về sớm buổi chiều" />
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => setPick(null)}>Đóng</button>
        </div>
      )}
    </section>
  );
}
