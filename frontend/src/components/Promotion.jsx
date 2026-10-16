import { useI18n } from '../i18n/index.jsx';
import { useStorefront } from './Footer.jsx';
import { useNow } from './DeliveryHours.jsx';
import { promoGiftKg, promoStatus, riceKg } from '../api';

const dayMonth = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const formatKg = (kg) => (Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace('.', ','));

/**
 * Đợt khuyến mãi tặng quà theo kg đang/sắp diễn ra (đọc từ cài đặt cửa hàng), cùng trạng thái
 * theo giờ Việt Nam đã đồng bộ với máy chủ. Máy chủ vẫn tự quyết quà khi tạo đơn.
 */
export function usePromotion() {
  const settings = useStorefront();
  const now = useNow();
  const promotion = settings?.promotion || null;
  return { promotion, status: promoStatus(promotion, now) };
}

function usePromoText(promotion) {
  const { t } = useI18n();
  const key = `promo.title.${promotion.code}`;
  const title = t(key) === key ? promotion.title : t(key);
  return { t, title };
}

/** Băng rôn trang chủ: báo trước và trong đợt, tự ẩn khi hết đợt. */
export function PromoBanner() {
  const { promotion, status } = usePromotion();
  if (!promotion || !status) return null;
  return <PromoBannerBody promotion={promotion} status={status} />;
}

function PromoBannerBody({ promotion, status }) {
  const { t, title } = usePromoText(promotion);
  const vars = {
    min: promotion.min_kg, max: promotion.max_gift_kg, gift: promotion.gift_name,
    maxKg: promotion.min_kg * promotion.max_gift_kg, start: dayMonth(promotion.start), end: dayMonth(promotion.end),
  };
  return (
    <aside className={`promo-banner ${status}`} aria-label={title}>
      <span className="promo-flower" aria-hidden="true">🌸</span>
      <div className="promo-copy">
        <p className="promo-when">
          <b>{title}</b> · {t(`promo.when.${status}`, vars)}
        </p>
        <strong>{t('promo.headline', vars)}</strong>
        <span>{t('promo.detail', vars)}</span>
      </div>
      <span className="promo-gift" aria-hidden="true">🎁</span>
    </aside>
  );
}

/**
 * Dòng nhắc ở giỏ hàng / trang đặt hàng trong đợt: đang được tặng bao nhiêu, mua thêm bao
 * nhiêu kg nữa thì được thêm. items: [{ category, weight_kg, unit, quantity }].
 */
export function PromoProgress({ items, compact = false }) {
  const { promotion, status } = usePromotion();
  if (!promotion || status !== 'active') return null;
  return <PromoProgressBody promotion={promotion} items={items} compact={compact} />;
}

function PromoProgressBody({ promotion, items, compact }) {
  const { t, title } = usePromoText(promotion);
  const kg = riceKg(items);
  const gift = promoGiftKg(kg, promotion);
  const max = promotion.max_gift_kg;
  const need = Math.max(0, promotion.min_kg * (gift + 1) - kg);
  const vars = { kg: formatKg(kg), need: formatKg(need), gift, next: gift + 1, name: promotion.gift_name, title };
  const key = gift >= max ? 'promo.progress.max' : gift > 0 ? 'promo.progress.some' : 'promo.progress.none';
  return (
    <div className={`promo-progress${gift > 0 ? ' earned' : ''}${compact ? ' compact' : ''}`} role="status">
      <span aria-hidden="true">{gift > 0 ? '🎁' : '🌸'}</span>
      <p>
        <small>{title}</small>
        {t(key, vars)}
      </p>
    </div>
  );
}

/** Dòng quà trong phần tóm tắt đơn (0₫), khi giỏ hàng đã đủ kg. */
export function PromoGiftRow({ items, className = 'summary-row' }) {
  const { promotion, status } = usePromotion();
  if (!promotion || status !== 'active') return null;
  const gift = promoGiftKg(riceKg(items), promotion);
  if (!gift) return null;
  return <PromoGiftRowBody promotion={promotion} gift={gift} className={className} />;
}

function PromoGiftRowBody({ promotion, gift, className }) {
  const { t, title } = usePromoText(promotion);
  return (
    <div className={`${className} promo-gift-row`}>
      <span><strong>{promotion.gift_name}</strong><small>{t('promo.giftLine', { kg: gift, title })}</small></span>
      <strong className="free-tag">0₫</strong>
    </div>
  );
}
