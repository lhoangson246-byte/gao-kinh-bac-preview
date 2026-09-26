import { useState } from 'react';
import { api } from '../api';
import { passwordErrorKey } from '../password';
import { useI18n } from '../i18n/index.jsx';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const submit = async (event) => {
    event.preventDefault();
    const errorKey = passwordErrorKey(password);
    if (errorKey) return setMessage(t(errorKey));
    setBusy(true);
    try {
      await api.changePassword({ current_password: current, password });
      setCurrent(''); setPassword('');
      setMessage(t('changePassword.done'));
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };
  return <section className="form-card flat profile-section">
    <h2>{t('changePassword.title')}</h2>
    <form onSubmit={submit}>
      <label>{t('changePassword.current')}
        <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>{t('changePassword.new')}
        <input className="input" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {message && <p role="status">{message}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('changePassword.submit')}</button>
    </form>
  </section>;
}
