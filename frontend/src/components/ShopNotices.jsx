import { useI18n } from '../i18n/index.jsx';
import { useShopInfo } from '../shopInfo.js';

const fmt = (day) => (day ? day.split('-').reverse().join('/') : '');

/**
 * Dải thông báo trên đầu các trang khách (20/11/2026): nghỉ lễ / Tết và cập nhật trang web, chủ cửa hàng đặt
 * ở Quản trị → CẬP NHẬT. Máy chủ chỉ trả các thông báo đang trong khoảng ngày hiện.
 */
export default function ShopNotices() {
  const { t } = useI18n();
  const { notices } = useShopInfo();
  if (!notices.length) return null;
  return (
    <div className="shop-notices" role="region" aria-label={t('notice.label')}>
      {notices.map((n, i) => (
        <p key={i} className={`shop-notice ${n.kind}`}>
          <span aria-hidden="true">{n.kind === 'holiday' ? '🏮' : '🛠️'}</span>
          <span>
            {n.kind === 'holiday'
              ? t(n.reopen ? 'notice.holidayReopen' : 'notice.holiday', { title: n.title, from: fmt(n.start), to: fmt(n.end), reopen: fmt(n.reopen) })
              : t('notice.maintenance', { from: fmt(n.start), to: fmt(n.end) })}
            {n.note && <> {n.note}</>}
          </span>
        </p>
      ))}
    </div>
  );
}
