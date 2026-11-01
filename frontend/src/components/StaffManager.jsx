import { useEffect, useState } from 'react';
import { api, formatDateTime } from '../api';
import { generatePassword, passwordError } from '../password';

const EMPTY = { full_name: '', phone: '', email: '', password: '', staff_title: '', permissions: [] };

/**
 * Chủ cửa hàng tạo tài khoản nhân viên và cấp quyền. Nhân viên đăng nhập ở trang đăng nhập chung
 * (số điện thoại hoặc email); máy chủ kiểm tra quyền ở mọi thao tác, đổi quyền có hiệu lực ngay.
 */
export default function StaffManager() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resetFor, setResetFor] = useState(null);   // { id, name, password }

  useEffect(() => { api.adminStaff().then(setData).catch((err) => setErrors({ load: err.message })); }, []);

  const run = async (action, done) => {
    setBusy(true); setErrors({}); setMessage('');
    try {
      const result = await action();
      if (result?.staff) setData((cur) => ({ ...cur, staff: result.staff }));
      setMessage(done);
      return true;
    } catch (err) {
      setErrors({ form: err.message, ...(err.errors || {}) });
      return false;
    } finally { setBusy(false); }
  };

  const toggle = (code) => setForm((cur) => ({
    ...cur, permissions: cur.permissions.includes(code) ? cur.permissions.filter((p) => p !== code) : [...cur.permissions, code],
  }));
  const applyPreset = (key) => {
    const preset = data.presets[key];
    setForm((cur) => ({ ...cur, permissions: [...preset.permissions], staff_title: cur.staff_title || preset.title }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (!editing) {
      const pwError = passwordError(form.password);
      if (pwError) { setErrors({ password: pwError }); return; }
    }
    const body = {
      full_name: form.full_name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null,
      staff_title: form.staff_title.trim() || null, permissions: form.permissions,
      ...(editing ? {} : { password: form.password }),
    };
    const ok = await run(() => (editing ? api.adminUpdateStaff(editing, body) : api.adminCreateStaff(body)),
      editing ? 'Đã lưu tài khoản nhân viên.' : `Đã tạo tài khoản cho ${body.full_name}. Gửi số điện thoại và mật khẩu cho nhân viên để đăng nhập.`);
    if (ok) { setForm(EMPTY); setEditing(null); }
  };

  const startEdit = (s) => {
    setEditing(s.id);
    setForm({ full_name: s.full_name, phone: s.phone || '', email: s.email || '', password: '', staff_title: s.staff_title || '', permissions: s.permissions });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetPassword = async () => {
    const pwError = passwordError(resetFor.password);
    if (pwError) { setErrors({ reset: pwError }); return; }
    if (await run(() => api.adminResetStaffPassword(resetFor.id, resetFor.password), `Đã đặt mật khẩu mới cho ${resetFor.name}.`)) setResetFor(null);
  };

  if (errors.load) return <p className="alert error">{errors.load}</p>;
  if (!data) return <div className="loading-state" role="status"><span></span>Đang mở…</div>;

  return (
    <div className="about-manager">
      {message && <p className="alert success" role="status">{message}</p>}

      <section className="form-card flat">
        <h2>{editing ? 'Sửa tài khoản nhân viên' : 'Tạo tài khoản nhân viên'}</h2>
        <p className="field-help">
          Nhân viên đăng nhập ở trang Đăng nhập bằng số điện thoại (hoặc email) và mật khẩu chị đặt. Chỉ tick những quyền
          nhân viên cần; đổi quyền hay khoá tài khoản có hiệu lực ngay.
        </p>
        <form className="about-admin-form" onSubmit={save} noValidate>
          <div className="about-admin-row">
            <label>Họ tên
              <input className="input" value={form.full_name} maxLength={120} onChange={(e) => setForm({ ...form, full_name: e.target.value })} aria-invalid={!!errors.full_name} />
              {errors.full_name && <small className="err">{errors.full_name}</small>}
            </label>
            <label>Số điện thoại (để đăng nhập)
              <input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0912345678" aria-invalid={!!errors.phone} />
              {errors.phone && <small className="err">{errors.phone}</small>}
            </label>
            <label>Email (không bắt buộc)
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={!!errors.email} />
              {errors.email && <small className="err">{errors.email}</small>}
            </label>
            <label>Chức vụ
              <input className="input" value={form.staff_title} maxLength={60} onChange={(e) => setForm({ ...form, staff_title: e.target.value })} placeholder="VD: Kế toán" />
            </label>
          </div>
          {!editing && (
            <label>Mật khẩu (tối thiểu 8 ký tự)
              <span className="staff-password">
                <input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" aria-invalid={!!errors.password} />
                <button type="button" className="btn btn-secondary" onClick={() => setForm({ ...form, password: generatePassword().slice(0, 10) })}>Tạo ngẫu nhiên</button>
              </span>
              {errors.password && <small className="err">{errors.password}</small>}
            </label>
          )}
          <fieldset className="staff-permissions">
            <legend>Quyền truy cập</legend>
            <div className="staff-presets">
              <span>Chọn nhanh:</span>
              {Object.entries(data.presets).map(([key, preset]) => (
                <button key={key} type="button" className="btn btn-secondary" onClick={() => applyPreset(key)}>{preset.title}</button>
              ))}
            </div>
            {Object.entries(data.permissions).map(([code, label]) => (
              <label key={code} className="checkbox-label">
                <input type="checkbox" checked={form.permissions.includes(code)} onChange={() => toggle(code)} />
                {label}
              </label>
            ))}
            {errors.permissions && <small className="err">{errors.permissions}</small>}
            <small className="field-help">
              Chỉ chủ cửa hàng có: cài đặt cửa hàng, mã giảm giá, trang Về chúng tôi, nhật ký và quản lý nhân viên.
            </small>
          </fieldset>
          {errors.form && <p className="alert error">{errors.form}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{editing ? 'Lưu' : 'Tạo tài khoản'}</button>
            {editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setForm(EMPTY); setErrors({}); }}>Huỷ</button>}
          </div>
        </form>
      </section>

      <section className="form-card flat">
        <h2>Nhân viên ({data.staff.length})</h2>
        {data.staff.length === 0 ? <p className="muted">Chưa có tài khoản nhân viên nào.</p> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Nhân viên</th><th>Đăng nhập</th><th>Quyền</th><th>Lần đăng nhập cuối</th><th></th></tr></thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s.id} className={s.is_locked ? 'row-muted' : ''}>
                    <td><strong>{s.full_name}</strong><small className="cell-note">{s.staff_title || 'Nhân viên'}{s.is_locked ? ' · đã khoá' : ''}</small></td>
                    <td>{s.phone || ''}{s.email && <small className="cell-note">{s.email}</small>}</td>
                    <td><ul className="staff-perm-list">{s.permissions.map((p) => <li key={p}>{data.permissions[p]}</li>)}</ul></td>
                    <td>{s.last_login ? formatDateTime(s.last_login) : 'Chưa đăng nhập'}</td>
                    <td className="cell-actions">
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => startEdit(s)}>Sửa quyền</button>
                      <button type="button" className="btn btn-secondary" disabled={busy}
                              onClick={() => setResetFor({ id: s.id, name: s.full_name, password: generatePassword().slice(0, 10) })}>Đặt lại mật khẩu</button>
                      <button type="button" className={`btn ${s.is_locked ? 'btn-secondary' : 'btn-danger'}`} disabled={busy}
                              onClick={() => (s.is_locked || window.confirm(`Khoá tài khoản ${s.full_name}? Nhân viên sẽ bị đăng xuất ngay.`))
                                && run(() => api.adminLockStaff(s.id, !s.is_locked), s.is_locked ? `Đã mở khoá ${s.full_name}.` : `Đã khoá ${s.full_name}.`)}>
                        {s.is_locked ? 'Mở khoá' : 'Khoá'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {resetFor && (
          <div className="about-admin-form staff-reset">
            <h3>Mật khẩu mới cho {resetFor.name}</h3>
            <span className="staff-password">
              <input className="input" value={resetFor.password} onChange={(e) => setResetFor({ ...resetFor, password: e.target.value })} />
              <button type="button" className="btn btn-primary" disabled={busy} onClick={resetPassword}>Lưu mật khẩu</button>
              <button type="button" className="btn btn-secondary" onClick={() => setResetFor(null)}>Huỷ</button>
            </span>
            {errors.reset && <small className="err">{errors.reset}</small>}
            <small className="field-help">Nhân viên sẽ bị đăng xuất và phải đăng nhập lại bằng mật khẩu này.</small>
          </div>
        )}
      </section>
    </div>
  );
}
