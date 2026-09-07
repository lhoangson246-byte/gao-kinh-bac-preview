import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { isPhone } from '../api';
import AddressBook from '../components/AddressBook.jsx';
import ChangePassword from '../components/ChangePassword.jsx';

export default function Profile() {
  const { user, isAdmin, updateProfile, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: user.full_name,
    phone: user.phone || '',
  });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    setError('');

    const errors = {};
    if (form.full_name.trim().length < 2) errors.full_name = 'Vui lòng nhập họ tên.';
    if (form.phone.trim() && !isPhone(form.phone)) {
      errors.phone = 'Số điện thoại không hợp lệ (ví dụ 0912345678).';
    }
    if (Object.keys(errors).length) return setFieldErrors(errors);

    setFieldErrors({});
    setBusy(true);
    try {
      await updateProfile(form);
      setMsg('Đã lưu thông tin tài khoản.');
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-shell narrow profile-page">
      <div className="page-heading">
        <div><p className="eyebrow dark"><span></span>Hồ sơ</p><h1>Tài khoản của tôi</h1></div>
      </div>

      <section className="form-card flat profile-section">
        <h2>Thông tin tài khoản</h2>
        <p className="muted">
          {user.email || user.phone || 'Chưa có thông tin đăng nhập'}
          {isAdmin && ' · Quản trị viên'}
        </p>

        {msg && <p className="alert success" role="status">{msg}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}

        <form onSubmit={onSubmit} noValidate>
          <label>Họ và tên <b>*</b>
            <input className="input" name="full_name" value={form.full_name} onChange={onChange}
                   autoComplete="name" aria-invalid={!!fieldErrors.full_name} />
            {fieldErrors.full_name && <small className="err">{fieldErrors.full_name}</small>}
          </label>

          <label>Số điện thoại đăng nhập
            <input className="input" name="phone" value={form.phone} onChange={onChange}
                   inputMode="tel" autoComplete="tel" placeholder="0912345678"
                   aria-invalid={!!fieldErrors.phone} />
            {fieldErrors.phone
              ? <small className="err">{fieldErrors.phone}</small>
              : <small className="field-help">Số người nhận của từng địa chỉ được quản lý riêng bên dưới.</small>}
          </label>

          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu thông tin'}
          </button>
        </form>
      </section>

      <section className="form-card flat profile-section address-profile-section">
        <AddressBook />
      </section>

      <ChangePassword />
      <div className="profile-actions">
        {isAdmin && <Link className="btn btn-secondary btn-block" to="/quan-tri">Mở trang quản trị</Link>}
        <button type="button" className="btn btn-secondary btn-block"
                onClick={async () => { try { await logout(); navigate('/', { replace: true }); } catch (err) { setError(err.message); } }}>
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
