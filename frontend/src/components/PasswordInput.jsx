import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';

/**
 * Ô nhập mật khẩu kèm nút Hiện/Ẩn nằm ngay trong ô.
 *
 * Mặc định vẫn là ô mật khẩu che kín; bấm "Hiện" để đọc lại những gì vừa gõ,
 * tránh gõ sai mà không biết. Mọi thuộc tính khác được truyền thẳng xuống thẻ
 * input nên nơi dùng vẫn giữ nguyên autoComplete, required, minLength…
 */
export default function PasswordInput({ className = '', ...props }) {
  const [shown, setShown] = useState(false);
  const { t } = useI18n();
  const action = shown ? t('password.hideAria') : t('password.showAria');

  return (
    <div className="password-field">
      <input
        {...props}
        type={shown ? 'text' : 'password'}
        className={`input ${className}`.trim()}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setShown((current) => !current)}
        aria-pressed={shown}
        aria-label={action}
        title={action}
      >
        {shown ? t('password.hide') : t('password.show')}
      </button>
    </div>
  );
}
