import { useI18n } from '../i18n/index.jsx';
import { useStorefront } from './Footer.jsx';
import { useNow } from './DeliveryHours.jsx';
import { promoGiftKg, promoNextTier, promoStatus, riceKg } from '../api';

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

/** Các loại quà khách được chọn (bản cũ chỉ có một tên quà). */
export const promoGifts = (promotion) => promotion?.gifts?.length
  ? promotion.gifts
  : [{ key: 'nep', name: promotion?.gift_name || '' }];

function usePromoText(promotion) {
  const { t } = useI18n();
  const key = `promo.title.${promotion.code}`;
  const title = t(key) === key ? promotion.title : t(key);
  const giftNames = promoGifts(promotion).map((g) => g.name).join(t('promo.or'));
  const tiers = promotion.tiers || [[promotion.min_kg, 1]];
  const joined = tiers.map(([kg, gift]) => t('promo.tier', { kg, gift })).join(' · ');
  const tierText = joined.charAt(0).toUpperCase() + joined.slice(1);
  return { t, title, giftNames, tiers, tierText };
}

/** Băng rôn trang chủ: báo trước và trong đợt, tự ẩn khi hết đợt. */
export function PromoBanner() {
  const { promotion, status } = usePromotion();
  if (!promotion || !status) return null;
  return <PromoBannerBody promotion={promotion} status={status} />;
}

function PromoBannerBody({ promotion, status }) {
  const { t, title, giftNames, tiers, tierText } = usePromoText(promotion);
  const vars = { min: tiers[0][0], gifts: giftNames, tiers: tierText, start: dayMonth(promotion.start), end: dayMonth(promotion.end) };
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
 * nhiêu kg nữa thì lên bậc tiếp theo. items: [{ category, weight_kg, unit, quantity }].
 */
export function PromoProgress({ items, compact = false }) {
  const { promotion, status } = usePromotion();
  if (!promotion || status !== 'active') return null;
  return <PromoProgressBody promotion={promotion} items={items} compact={compact} />;
}

function PromoProgressBody({ promotion, items, compact }) {
  const { t, title, giftNames } = usePromoText(promotion);
  const kg = riceKg(items);
  const gift = promoGiftKg(kg, promotion);
  const next = promoNextTier(kg, promotion);
  const vars = {
    kg: formatKg(kg), gift, title, name: giftNames,
    need: next ? formatKg(next[0] - kg) : 0, next: next ? next[1] : gift,
  };
  const key = !next ? 'promo.progress.max' : gift > 0 ? 'promo.progress.some' : 'promo.progress.none';
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

/**
 * Chọn loại quà (nếp cái hoa vàng / gạo lứt) khi đơn đã đủ kg. value là key quà; bỏ trống
 * thì máy chủ dùng loại đầu tiên.
 */
export function PromoGiftChoice({ items, value, onChange }) {
  const { promotion, status } = usePromotion();
  if (!promotion || status !== 'active') return null;
  const gifts = promoGifts(promotion);
  const gift = promoGiftKg(riceKg(items), promotion);
  if (!gift || gifts.length < 2) return null;
  return <PromoGiftChoiceBody promotion={promotion} gifts={gifts} gift={gift} value={value || gifts[0].key} onChange={onChange} />;
}

function PromoGiftChoiceBody({ promotion, gifts, gift, value, onChange }) {
  const { t, title } = usePromoText(promotion);
  return (
    <fieldset className="promo-choice">
      <legend>{t('promo.choose', { gift, title })}</legend>
      <div className="promo-choice-options">
        {gifts.map((g) => (
          <button key={g.key} type="button" className={value === g.key ? 'active' : ''}
                  aria-pressed={value === g.key} onClick={() => onChange(g.key)}>
            {g.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Dòng quà trong phần tóm tắt đơn (0₫), khi giỏ hàng đã đủ kg. */
export function PromoGiftRow({ items, choice, className = 'summary-row' }) {
  const { promotion, status } = usePromotion();
  if (!promotion || status !== 'active') return null;
  const gift = promoGiftKg(riceKg(items), promotion);
  if (!gift) return null;
  return <PromoGiftRowBody promotion={promotion} gift={gift} choice={choice} className={className} />;
}

function PromoGiftRowBody({ promotion, gift, choice, className }) {
  const { t, title } = usePromoText(promotion);
  const gifts = promoGifts(promotion);
  const chosen = gifts.find((g) => g.key === choice) || gifts[0];
  return (
    <div className={`${className} promo-gift-row`}>
      <span><strong>{chosen.name}</strong><small>{t('promo.giftLine', { kg: gift, title })}</small></span>
      <strong className="free-tag">0₫</strong>
    </div>
  );
}
