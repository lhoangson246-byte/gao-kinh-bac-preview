import { Link } from 'react-router-dom';
import { formatVND, FREE_SHIPPING_MIN, SHIPPING_FEE } from '../api';
import { useI18n } from '../i18n/index.jsx';

/** Báo phí giao và nhắc khách mua thêm cho đủ mức freeship. `subtotal` là tiền hàng trước giảm giá. */
export default function ShippingNotice({ subtotal }) {
  const { t } = useI18n();
  if (subtotal <= 0) return null;
  if (subtotal >= FREE_SHIPPING_MIN) {
    return <div className="ship-notice free" role="status">🎉 {t('ship.free')}</div>;
  }
  return (
    <div className="ship-notice" role="status">
      <p>
        <strong>🚚 {t('ship.need', { amount: formatVND(FREE_SHIPPING_MIN - subtotal) })}</strong>
        <small>{t('ship.rule', { min: formatVND(FREE_SHIPPING_MIN), fee: formatVND(SHIPPING_FEE) })}</small>
      </p>
      <div className="ship-bar" aria-hidden="true"><span style={{ width: `${Math.round((subtotal / FREE_SHIPPING_MIN) * 100)}%` }}></span></div>
      <Link to="/">{t('ship.add')} →</Link>
    </div>
  );
}
