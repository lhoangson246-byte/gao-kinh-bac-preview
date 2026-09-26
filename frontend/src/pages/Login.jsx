import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { useI18n } from '../i18n/index.jsx';

export default function Login() {
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

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
