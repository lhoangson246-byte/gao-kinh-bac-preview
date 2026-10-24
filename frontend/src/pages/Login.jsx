import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { useI18n } from '../i18n/index.jsx';

export default function Login() {
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { count } = useCart();
  // Khách lạc vào trang này không nghĩ phải có tài khoản mới mua được: nhắc mua nhanh ngay đầu trang.
  // Trang quản trị chuyển về đây khi hết phiên thì không cần lời nhắc này.
  const showGuest = !String(location.state?.from || '').startsWith('/quan-tri');

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
      <h2>{t('login.title')}</h2>
      {showGuest && (
        <section className="login-guest" aria-labelledby="login-guest-title">
          <p className="login-guest-title" id="login-guest-title">
            <span aria-hidden="true">🛒</span> {t('login.guestTitle')}
          </p>
          <p className="login-guest-body">{t('login.guestBody')}</p>
          <Link className="btn btn-primary btn-large btn-block" to={count > 0 ? '/dat-nhanh' : '/'}>
            {count > 0 ? t('login.guestCheckout', { count }) : t('login.guestBrowse')}
          </Link>
          <p className="login-guest-perk"><span aria-hidden="true">🎁</span> {t('login.guestPerk')}</p>
        </section>
      )}
      {sessionExpired && !error && <p className="alert warning" role="status">{t('login.expired')}</p>}
      {error && <p className="alert error">{error}</p>}

      <form onSubmit={onSubmit}>
        <label>{t('login.identifier')}
          <input
            className="input"
            type="text"
            name="identifier"
            value={form.identifier}
            onChange={onChange}
            required
            autoComplete="username"
            placeholder={t('login.identifierPlaceholder')}
          />
        </label>

        <label>{t('login.password')}
          <PasswordInput name="password" value={form.password}
                         onChange={onChange} required autoComplete="current-password" />
        </label>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t('login.busy') : t('login.submit')}
        </button>
      </form>

      <p className="muted center">{t('login.noAccount')} <Link to="/dang-ky">{t('login.registerNow')}</Link></p>
    </div>
  );
}
