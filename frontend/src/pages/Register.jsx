import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { isPhone } from '../api';
import { passwordError } from '../password';

export default function Register() {
  const [form, setForm] = useState({
    full_name: '', phone: '', password: '', confirm: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const errors = {};
    if (form.full_name.trim().length < 2) errors.full_name = 'Vui lòng nhập họ tên.';
    if (!form.phone.trim()) errors.phone = 'Nhập số điện thoại để đăng nhập.';
    else if (!isPhone(form.phone)) errors.phone = 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).';
    if (passwordError(form.password)) errors.password = passwordError(form.password);
    if (form.password !== form.confirm) errors.confirm = 'Mật khẩu nhập lại không khớp.';

    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setError('Vui lòng kiểm tra lại các thông tin được đánh dấu bên dưới.');
      return;
    }

    setFieldErrors({});
    setBusy(true);
    try {
      const { confirm, ...payload } = form;
      await register(payload);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-card">
      <h2>Đăng ký tài khoản</h2>
      <p className="muted">Đăng ký nhanh bằng số điện thoại và mật khẩu.</p>

      {error && <p className="alert error" role="alert">{error}</p>}

      <form onSubmit={onSubmit} noValidate>
        <label>Họ và tên <b>*</b>
          <input className="input" name="full_name" value={form.full_name} onChange={onChange}
                 autoComplete="name" required aria-invalid={!!fieldErrors.full_name} />
          {fieldErrors.full_name && <small className="err">{fieldErrors.full_name}</small>}
        </label>

        <label>Số điện thoại <b>*</b>
          <input className="input" name="phone" value={form.phone} onChange={onChange}
                 inputMode="tel" autoComplete="tel" placeholder="0912345678" required
                 aria-invalid={!!fieldErrors.phone} />
          {fieldErrors.phone
            ? <small className="err">{fieldErrors.phone}</small>
            : <small className="field-help">Dùng số này để đăng nhập và để cửa hàng gọi xác nhận đơn.</small>}
        </label>

        <div className="row">
          <label>Mật khẩu <b>*</b>
            <input className="input" type="password" name="password" value={form.password}
                   onChange={onChange} required minLength={12} autoComplete="new-password"
                   aria-invalid={!!fieldErrors.password} />
            {fieldErrors.password && <small className="err">{fieldErrors.password}</small>}
          </label>

          <label>Nhập lại mật khẩu <b>*</b>
            <input className="input" type="password" name="confirm" value={form.confirm}
                   onChange={onChange} required autoComplete="new-password"
                   aria-invalid={!!fieldErrors.confirm} />
            {fieldErrors.confirm && <small className="err">{fieldErrors.confirm}</small>}
          </label>
        </div>

        <button className="btn btn-primary btn-block btn-large" disabled={busy}>
          {busy ? 'Đang tạo tài khoản…' : 'Đăng ký'}
        </button>
      </form>

      <p className="muted center">Đã có tài khoản? <Link to="/dang-nhap">Đăng nhập</Link></p>
    </div>
  );
}
