import { useState } from 'react';
import { api } from '../api';
import { generatePassword, passwordError } from '../password';

/**
 * Đăng ký tài khoản đặt hàng online cho khách, làm ngay tại quầy.
 * Số điện thoại của tài khoản chính là số tích điểm, nên khách mua tại quầy
 * hay đặt online đều cộng vào cùng một hồ sơ.
 */
export default function AccountSignup({ phone, defaultName = '', onCreated }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(defaultName);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  /** Mật khẩu dễ đọc cho khách qua điện thoại. */
  const suggest = () => {
    setPassword(generatePassword());
    setFieldErrors((e) => ({ ...e, password: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    const errors = {};
    if (fullName.trim().length < 2) errors.full_name = 'Nhập họ tên khách.';
    if (passwordError(password)) errors.password = passwordError(password);
    if (Object.keys(errors).length) { setFieldErrors(errors); return; }

    setFieldErrors({});
    setBusy(true);
    try {
      const r = await api.retailCreateAccount({
        phone, full_name: fullName.trim(), password,
      });
      setOpen(false);
      setPassword('');
      onCreated(
        r.account,
        `Đã tạo tài khoản cho ${fullName.trim()}.`
      );
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="signup-prompt">
        <div>
          <strong>Chưa có tài khoản đặt hàng online</strong>
          <small>Tạo giúp khách để lần sau khách tự đặt gạo giao tận nhà — điểm vẫn cộng vào số này.</small>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          Tạo tài khoản
        </button>
      </div>
    );
  }

  return (
    <form className="signup-box" onSubmit={submit}>
      <div className="form-header">
        <div>
          <h3>Tạo tài khoản đặt hàng</h3>
          <p>Số điện thoại: <strong>{phone}</strong></p>
        </div>
        <button type="button" className="icon-close" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}

      <label>Họ tên khách <b>*</b>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)}
               placeholder="Ví dụ: Cô Lan" aria-invalid={!!fieldErrors.full_name} />
        {fieldErrors.full_name && <small className="err">{fieldErrors.full_name}</small>}
      </label>

      <label>Mật khẩu <b>*</b>
        <div className="pos-phone-row">
          <input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                 placeholder="Tối thiểu 12 ký tự" autoComplete="new-password"
                 aria-invalid={!!fieldErrors.password} />
          <button type="button" className="btn btn-secondary" onClick={suggest}>Gợi ý</button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ẩn' : 'Hiện'}</button>
        </div>
        {fieldErrors.password
          ? <small className="err">{fieldErrors.password}</small>
          : <small className="field-help">Hiện mật khẩu để đọc cho khách trước khi lưu. Nhắc khách tự đổi sau khi đăng nhập.</small>}
      </label>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Bỏ qua</button>
      </div>
    </form>
  );
}
