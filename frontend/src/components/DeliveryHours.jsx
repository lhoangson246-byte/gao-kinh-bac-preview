import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { deliveryPlan, vietnamClock } from '../api';

/** Bốn khoảng thời gian trong ngày của cửa hàng và đơn đặt lúc đó được giao khi nào. */
const ROWS = [
  { phase: 'morning', icon: '☀️', time: '07h00 – 11h30' },
  { phase: 'lunch', icon: '🍚', time: '11h30 – 13h30' },
  { phase: 'afternoon', icon: '🌤️', time: '13h30 – 18h00' },
  { phase: 'closed', icon: '🌙', time: '18h00 – 07h00' },
];

/** Thời điểm hiện tại, cập nhật mỗi phút để khung nhắc luôn đúng khi khách để trang mở lâu. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * Khung nhắc giờ giao gạo ở trang đặt hàng: dòng đầu nói rõ đơn đặt BÂY GIỜ sẽ được
 * giao lúc nào, bên dưới là lịch trong ngày, dòng hiện tại được tô đậm.
 */
export default function DeliveryHours({ now, compact = false }) {
  const { t } = useI18n();
  const plan = deliveryPlan(now);
  const phase = plan.phase === 'early' ? 'closed' : plan.phase;
  const schedule = (
    <ul className="delivery-schedule">
      {ROWS.map((row) => (
        <li key={row.phase} className={row.phase === phase ? 'current' : ''}>
          <span aria-hidden="true">{row.icon}</span>
          <b>{row.time}</b>
          <span>{t(`hours.rule.${row.phase}`)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className={`delivery-hours${compact ? ' compact' : ''}`} aria-label={t('hours.title')}>
      <p className="delivery-now" role="status">
        <span aria-hidden="true">🚚</span>
        <span>
          <small>{t('hours.nowLabel', { time: vietnamClock(now) })}</small>
          <strong>{t(`hours.now.${plan.phase}`)}</strong>
        </span>
      </p>
      {compact ? (
        // Trang đặt nhanh: chỉ hiện dòng "đặt bây giờ", lịch đầy đủ bấm mới mở để trang ngắn gọn.
        <details className="delivery-more">
          <summary>{t('hours.see')}</summary>
          {schedule}
        </details>
      ) : schedule}
    </section>
  );
}
