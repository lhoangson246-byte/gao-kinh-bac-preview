import { useState } from 'react';
import { api } from '../api';
import { passwordError } from '../password';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const error = passwordError(password);
    if (error) return setMessage(error);
    setBusy(true);
    try {
      await api.changePassword({ current_password: current, password });
      setCurrent(''); setPassword('');
      setMessage('Đã đổi mật khẩu và đăng xuất các phiên khác.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };
  return <section className="form-card flat profile-section">
    <h2>Đổi mật khẩu</h2>
    <form onSubmit={submit}>
      <label>Mật khẩu hiện tại
        <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>Mật khẩu mới
        <input className="input" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {message && <p role="status">{message}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Đổi mật khẩu'}</button>
    </form>
  </section>;
}
