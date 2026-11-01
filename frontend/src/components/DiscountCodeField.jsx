import { useState } from 'react';
import { api, formatVND } from '../api';
import { useI18n } from '../i18n/index.jsx';

/**
 * Ô nhập mã giảm giá ở trang đặt hàng. Bấm "Áp dụng" thì hỏi máy chủ mã đúng/sai và số tiền giảm;
 * khi đặt hàng máy chủ kiểm tra lại toàn bộ (hạn, lượt dùng, đơn đầu tiên).
 * `value` = { code, amount, min_subtotal } của mã đã áp dụng, hoặc null.
 */
export default function DiscountCodeField({ subtotal, value, onChange, error: serverError }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = async () => {
    const code = text.trim();
    if (!code) { setError(t('code.empty')); return; }
    setBusy(true);
    setError('');
    try {
      const { code: found } = await api.checkDiscountCode(code, subtotal);
      onChange(found);
      setText('');
    } catch (err) {
      setError(err.errors?.discount_code || err.message);
    } finally {
      setBusy(false);
    }
  };

  const shownError = error || serverError;
  const belowMin = value && value.min_subtotal > 0 && subtotal < value.min_subtotal;

  return (
    <div className="discount-code">
      {value ? (
        <div className="discount-code-applied">
          <span>🏷️ {t('code.applied', { code: value.code, amount: formatVND(value.amount) })}</span>
          <button type="button" className="link-button" onClick={() => { onChange(null); setError(''); }}>{t('code.remove')}</button>
        </div>
      ) : (
        <div className="discount-code-row">
          <label className="sr-only" htmlFor="discount-code-input">{t('code.label')}</label>
          <input id="discount-code-input" className="input" value={text} maxLength={40} autoCapitalize="characters"
                 placeholder={t('code.placeholder')} onChange={(e) => setText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
                 aria-invalid={!!shownError} />
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={apply}>
            {busy ? t('code.applying') : t('code.apply')}
          </button>
        </div>
      )}
      {belowMin && <small className="err">{t('code.minSubtotal', { amount: formatVND(value.min_subtotal) })}</small>}
      {shownError && <small className="err" role="alert">{shownError}</small>}
    </div>
  );
}
