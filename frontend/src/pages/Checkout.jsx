import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import AddressBook from '../components/AddressBook.jsx';
import DeliveryHours, { useNow } from '../components/DeliveryHours.jsx';
import {
  api, formatNumber, formatVND, pointsForLines, DELIVERY_AREA_CODE, DELIVERY_SLOTS, deliveryPlan, slotDay,
} from '../api';
import { useI18n } from '../i18n/index.jsx';

export default function Checkout() {
  const { items, total, hasUnavailable, clear } = useCart();
  const navigate = useNavigate();
  const { t, unit } = useI18n();
  const now = useNow();

  const orderable = items.filter((item) => item.stock > 0 && item.quantity > 0);
  // Xem trước ưu đãi đơn đầu tiên; máy chủ vẫn tự quyết khi tạo đơn.
  const [firstOrder, setFirstOrder] = useState(null);
  const discount = firstOrder?.available ? Math.min(firstOrder.amount, total) : 0;

  // Đổi điểm: mỗi 1.000 điểm = 1 voucher giảm 30.000đ hoặc 1 phần quà 1kg.
  const [vouchers, setVouchers] = useState(0);
  const [gifts, setGifts] = useState({});           // { productId: quantity }
  const points = firstOrder?.points ?? 0;
  const perReward = firstOrder?.pointsPerReward ?? 1000;
  const voucherAmount = firstOrder?.voucherAmount ?? 30000;
  const rewardProducts = firstOrder?.rewards ?? [];
  const affordable = Math.floor(points / perReward);
  const giftCount = Object.values(gifts).reduce((sum, q) => sum + q, 0);
  const chosen = vouchers + giftCount;
  const left = affordable - chosen;
  const voucherDiscount = vouchers * voucherAmount;
  // Voucher không được vượt số tiền còn phải trả (máy chủ cũng chặn như vậy).
  const maxVouchers = Math.floor(Math.max(0, total - discount) / voucherAmount);
  const payable = total - discount - voucherDiscount;
  const earnPoints = pointsForLines(orderable, payable);
  const setGift = (id, quantity) => setGifts((current) => {
    const next = { ...current };
    if (quantity > 0) next[id] = quantity; else delete next[id];
    return next;
  });

  const [selectedAddress, setSelectedAddress] = useState(null);
  const [form, setForm] = useState({
    delivery_area: DELIVERY_AREA_CODE,
    // Chọn sẵn khung giao sớm nhất theo giờ hiện tại (đặt giờ nghỉ trưa thì giao chiều).
    delivery_slot: deliveryPlan().slot,
    note: '',
    payment_method: 'cod',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.orderDiscount()
      .then((r) => { if (!cancelled) setFirstOrder(r); })
      .catch(() => { if (!cancelled) setFirstOrder({ available: false, amount: 0 }); });
    return () => { cancelled = true; };
  }, []);

  // Khung giờ chọn sẵn theo giờ hiện tại; tự chỉnh lại khi đồng hồ được đồng bộ với máy chủ
  // hoặc khi qua mốc giờ (ví dụ tới giờ nghỉ trưa), trừ khi khách đã tự chọn.
  const slotTouched = useRef(false);
  const plannedSlot = deliveryPlan(now).slot;
  useEffect(() => {
    if (!slotTouched.current) setForm((current) => ({ ...current, delivery_slot: plannedSlot }));
  }, [plannedSlot]);

  const onChange = (e) => {
    if (e.target.name === 'delivery_slot') slotTouched.current = true;
    setForm({ ...form, [e.target.name]: e.target.value });
  };
  const onSelectAddress = (address) => {
    setSelectedAddress(address);
    if (address) setFieldErrors((current) => ({ ...current, address_id: undefined }));
  };

  /** Kiểm tra ngay tại trình duyệt; máy chủ vẫn kiểm tra lại lần nữa. */
  const validate = () => {
    const errors = {};
    if (!selectedAddress) errors.address_id = t('checkout.addressRequired');
    return errors;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const errors = validate();
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setError(t('common.checkForm'));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const { order } = await api.createOrder({
        ...form,
        address_id: selectedAddress.id,
        items: orderable.map((item) => ({ product_id: item.id, quantity: item.quantity })),
        voucher_count: vouchers > 0 ? vouchers : undefined,
        rewards: giftCount > 0
          ? Object.entries(gifts).map(([id, quantity]) => ({ product_id: Number(id), quantity }))
          : undefined,
      });
      clear();
      navigate('/don-hang', { replace: true, state: { justOrdered: true, code: order?.code } });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  if (orderable.length === 0) {
    return (
      <div className="empty empty-page">
        <h1>{t('checkout.emptyTitle')}</h1>
        <p>{t('checkout.emptyBody')}</p>
        <Link className="btn btn-primary btn-large" to="/">{t('checkout.choose')}</Link>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-heading">
        <div><p className="eyebrow dark"><span></span>{t('checkout.eyebrow')}</p><h1>{t('checkout.title')}</h1></div>
        <Link to="/gio-hang" className="text-link">{t('checkout.back')}</Link>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {hasUnavailable && (
        <div className="alert warning" role="status">
          {t('checkout.unavailable')}
        </div>
      )}

      <div className="checkout">
        <div className="form-card flat checkout-form">
          <div className="form-section-title">
            <span>1</span><div><h2>{t('checkout.addressTitle')}</h2><p>{t('checkout.addressHint')}</p></div>
          </div>

          <AddressBook selectable selectedId={selectedAddress?.id} onSelect={onSelectAddress} />
          {fieldErrors.address_id && <small className="err address-required-error">{fieldErrors.address_id}</small>}

          <div className="form-section-title">
            <span>2</span><div><h2>{t('checkout.timeTitle')}</h2><p>{t('checkout.timeHint')}</p></div>
          </div>

          <DeliveryHours now={now} />

          <fieldset className="slot-group">
            <legend>{t('checkout.slotLegend')} <span className="free-tag">{t('common.free')}</span></legend>
            <div className="payment-options">
              {DELIVERY_SLOTS.map(([code, , time]) => (
                <label key={code} className={form.delivery_slot === code ? 'selected' : ''}>
                  <input type="radio" name="delivery_slot" value={code}
                         checked={form.delivery_slot === code} onChange={onChange} />
                  <span aria-hidden="true">◷</span>
                  <div>
                    <strong>{t(`slot.${code}`)}</strong>
                    <small>{time} · {t(`slot.day.${slotDay(code, now)}`)}</small>
                  </div>
                </label>
              ))}
            </div>
            <small className="field-help">
              {t('checkout.slotHelp')}
            </small>
          </fieldset>

          <label>{t('checkout.note')} <span className="optional">{t('common.optional')}</span>
            <textarea className="input" name="note" rows={2} value={form.note} onChange={onChange}
                      placeholder={t('checkout.notePlaceholder')} />
          </label>

          <div className="form-section-title">
            <span>3</span><div><h2>{t('checkout.payTitle')}</h2><p>{t('checkout.payHint')}</p></div>
          </div>

          <div className="payment-options">
            <label className={form.payment_method === 'cod' ? 'selected' : ''}>
              <input type="radio" name="payment_method" value="cod" checked={form.payment_method === 'cod'} onChange={onChange} />
              <span aria-hidden="true">◫</span><div><strong>{t('checkout.cod')}</strong><small>{t('checkout.codHint')}</small></div>
            </label>
            <label className={form.payment_method === 'bank' ? 'selected' : ''}>
              <input type="radio" name="payment_method" value="bank" checked={form.payment_method === 'bank'} onChange={onChange} />
              <span aria-hidden="true">▤</span><div><strong>{t('checkout.bank')}</strong><small>{t('checkout.bankHint')}</small></div>
            </label>
          </div>

          {form.payment_method === 'bank' && (
            <p className="payment-hint" role="status">
              {t('checkout.bankNotice')}
            </p>
          )}

          {points > 0 && (
            <>
              <div className="form-section-title">
                <span>4</span>
                <div>
                  <h2>{t('rewards.title')}</h2>
                  <p>{t('rewards.have', { points: formatNumber(points), n: affordable })}</p>
                </div>
              </div>
              {affordable === 0 ? (
                <p className="reward-hint">{t('rewards.notEnough', { need: formatNumber(perReward - points) })}</p>
              ) : (
                <div className="reward-options online-rewards" role="group" aria-label={t('rewards.title')}>
                  <RewardRow
                    name={t('rewards.voucher', { amount: formatVND(voucherAmount) })}
                    hint={maxVouchers === 0 ? t('rewards.voucherTooBig') : t('rewards.cost', { points: formatNumber(perReward) })}
                    value={vouchers}
                    max={Math.min(maxVouchers, vouchers + left)}
                    onChange={setVouchers}
                    t={t}
                  />
                  {rewardProducts.map((product) => (
                    <RewardRow
                      key={product.id}
                      name={t('rewards.gift', { name: product.name })}
                      hint={`${unit(product.unit)} · ${t('rewards.cost', { points: formatNumber(perReward) })}`}
                      value={gifts[product.id] || 0}
                      max={Math.min(product.stock, (gifts[product.id] || 0) + left)}
                      onChange={(q) => setGift(product.id, q)}
                      t={t}
                    />
                  ))}
                </div>
              )}
              {chosen > 0 && (
                <p className="reward-summary" role="status">
                  {t('rewards.using', { n: chosen, points: formatNumber(chosen * perReward) })}
                </p>
              )}
            </>
          )}

          <button type="button" className="btn btn-primary btn-block btn-large mobile-submit"
                  disabled={busy} onClick={onSubmit}>
            {busy ? t('checkout.sending') : t('checkout.submitTotal', { total: formatVND(payable) })}
          </button>
        </div>

        <aside className="summary order-summary">
          <p className="eyebrow dark"><span></span>{t('checkout.summaryEyebrow')}</p>
          <h2>{t('checkout.kinds', { n: orderable.length })}</h2>
          <div className="summary-products">
            {orderable.map((item) => (
              <div key={item.id} className="summary-row">
                <span><strong>{item.name}</strong><small>{t('line.qty', { qty: item.quantity, unit: unit(item.unit), price: formatVND(item.price) })}</small></span>
                <span>{formatVND(item.price * item.quantity)}</span>
              </div>
            ))}
          </div>
          {discount > 0 && (
            <div className="summary-row"><span>{t('cart.discount')} <small>{t('cart.discountFirst')}</small></span><strong className="free-tag">− {formatVND(discount)}</strong></div>
          )}
          {voucherDiscount > 0 && (
            <div className="summary-row"><span>{t('rewards.voucherLine', { n: vouchers })}</span><strong className="free-tag">− {formatVND(voucherDiscount)}</strong></div>
          )}
          {rewardProducts.filter((p) => gifts[p.id]).map((p) => (
            <div key={p.id} className="summary-row">
              <span><strong>{p.name}</strong><small>{t('rewards.giftLine', { n: gifts[p.id] })}</small></span>
              <strong className="free-tag">0₫</strong>
            </div>
          ))}
          <div className="summary-row"><span>{t('cart.shipping')}</span><strong className="free-tag">{t('common.free')}</strong></div>
          <div className="summary-row grand-total"><span>{t('cart.total')}</span><strong>{formatVND(payable)}</strong></div>
          <p className="pos-hint">{t('cart.points', { n: earnPoints })}</p>
          <p className="summary-disclaimer">
            {t('checkout.disclaimer')}
          </p>
          <button type="button" className="btn btn-primary btn-block btn-large desktop-submit"
                  disabled={busy} onClick={onSubmit}>
            {busy ? t('checkout.sending') : t('checkout.submit')}
          </button>
        </aside>
      </div>
    </div>
  );
}

/** Một lựa chọn đổi điểm với nút − / +. */
function RewardRow({ name, hint, value, max, onChange, t }) {
  return (
    <div className={`reward-option${value > 0 ? ' picked' : ''}`}>
      <span className="reward-name">{name}<small>{hint}</small></span>
      <div className="qty-stepper">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}
                aria-label={t('rewards.less', { name })}>−</button>
        <input type="number" value={value} readOnly aria-label={t('rewards.count', { name })} />
        <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max}
                aria-label={t('rewards.more', { name })}>+</button>
      </div>
    </div>
  );
}
