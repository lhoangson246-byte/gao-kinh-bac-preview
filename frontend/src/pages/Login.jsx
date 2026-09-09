import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-card">
      <h2>Đăng nhập</h2>
      {error && <p className="alert error">{error}</p>}

      <form onSubmit={onSubmit}>
        <label>Số điện thoại hoặc email
          <input
            className="input"
            type="text"
            name="identifier"
            value={form.identifier}
            onChange={onChange}
            required
            autoComplete="username"
            placeholder="0912345678 hoặc email"
          />
        </label>

        <label>Mật khẩu
          <input className="input" type="password" name="password" value={form.password}
                 onChange={onChange} required autoComplete="current-password" />
        </label>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Đang xử lý…' : 'Đăng nhập'}
        </button>
      </form>

      <p className="muted center">Chưa có tài khoản? <Link to="/dang-ky">Đăng ký ngay</Link></p>
    </div>
  );
}
