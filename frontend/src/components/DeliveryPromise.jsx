import { Link } from 'react-router-dom';
import { deliveryEta, slotInfo } from '../api';
import { useI18n } from '../i18n/index.jsx';

/**
 * Sau khi khách đặt: anh shipper thuyền rồng + lời hẹn giờ giao, và nút theo dõi đơn.
 * Đặt trong giờ làm thì hẹn 1 – 1 tiếng rưỡi; sát giờ nghỉ / ngoài giờ thì hẹn buổi kế tiếp.
 */
export default function DeliveryPromise({ order, phone }) {
  const { t } = useI18n();
  const eta = deliveryEta(order.created_at, order.delivery_slot);
  const slot = slotInfo(eta.slot);
  return (
    <div className="delivery-promise">
      <img src="/shipper.webp" alt={t('eta.shipperAlt')} width="468" height="361" decoding="async" />
      <p className="delivery-promise-text">
        {eta.fast
          ? t('eta.fast')
          : t('eta.slot', { slot: t(`slot.${slot?.session || 'sang'}`).toLowerCase(), time: slot?.time || '', date: eta.date })}
      </p>
      {order.code && (
        <Link className="btn btn-primary btn-block" to={`/tra-cuu-don?ma=${order.code}`} state={{ phone: phone || order.phone }}>
          {t('eta.track')}
        </Link>
      )}
    </div>
  );
}
