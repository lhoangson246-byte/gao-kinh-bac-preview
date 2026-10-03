import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api, formatVND, pointsForLines, FIRST_ORDER_DISCOUNT } from '../api';
import { useI18n } from '../i18n/index.jsx';

export default function Cart() {
  const { items, total, count, hasUnavailable, setQuantity, remove, clear, syncWithProducts } = useCart();
  const [syncError, setSyncError] = useState(false);
  const { t, unit } = useI18n();
  const { user } = useAuth();

  // Ưu đãi đơn đầu tiên: hỏi máy chủ xem tài khoản này còn được giảm không.
  // Chỉ để xem trước; máy chủ vẫn tự quyết khi tạo đơn.
  const [firstOrder, setFirstOrder] = useState(null);
  const discount = firstOrder?.available ? Math.min(firstOrder.amount, total) : 0;
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api.orderDiscount()
      .then((r) => { if (!cancelled) setFirstOrder(r); })
      // Chưa đăng nhập hoặc lỗi mạng thì đơn giản là không hiện ưu đãi.
      .catch(() => { if (!cancelled) setFirstOrder({ available: false, amount: 0 }); });
    return () => { cancelled = true; };
  }, []);

  // Lấy giá và tồn kho mới nhất để khách không đặt nhầm hàng đã hết.
  useEffect(() => {
    let cancelled = false;
    api.products()
      .then(({ products }) => { if (!cancelled) syncWithProducts(products); })
      .catch(() => { if (!cancelled) setSyncError(true); });
    return () => { cancelled = true; };
  }, [syncWithProducts]);

  if (items.length === 0) {
    return (
      <div className="empty empty-page">
        <span className="empty-icon" aria-hidden="true">🧺</span>
        <h1>{t('cart.emptyTitle')}</h1>
        <p>{t('cart.emptyBody')}</p>
        <Link className="btn btn-primary btn-large" to="/">{t('cart.browse')}</Link>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-heading">
        <div><p className="eyebrow dark"><span></span>{t('cart.eyebrow')}</p><h1>{t('cart.title')}</h1></div>
        <Link to="/" className="text-link">{t('cart.addMore')}</Link>
      </div>

      {syncError && <div className="alert warning" role="status">{t('cart.syncError')}</div>}
      {hasUnavailable && (
        <div className="alert error" role="alert">
          {t('cart.hasUnavailable')}
        </div>
      )}

      <div className="cart-layout">
        <section className="cart-list" aria-label={t('cart.listAria')}>
          {items.map((item) => {
            const soldOut = item.stock <= 0;
            const atMax = !soldOut && item.quantity >= item.stock;
            return (
              <article className={`cart-item${soldOut ? ' sold-out' : ''}`} key={item.id}>
                <div className="cart-grain" aria-hidden="true">🌾</div>
                <div className="cart-item-main">
                  <h2>{item.name}</h2>
                  <p>{formatVND(item.price)} / {unit(item.unit)}</p>
                  {soldOut
                    ? <p className="cart-warning">{t('cart.itemSoldOut')}</p>
                    : atMax && <p className="cart-warning">{t('cart.onlyLeft', { n: item.stock, unit: unit(item.unit) })}</p>}
                  <button className="link-button danger" onClick={() => remove(item.id)}>
                    {t('cart.remove')}
                  </button>
                </div>
                <div className="cart-item-end">
                  <div className="qty-stepper">
                    <button
                      type="button"
                      onClick={() => setQuantity(item.id, item.quantity - 1)}
                      disabled={soldOut || item.quantity <= 1}
                      aria-label={t('cart.decrease', { name: item.name })}
                    >−</button>
                    <input
                      aria-label={t('cart.quantity', { name: item.name })}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={Math.max(item.stock, 1)}
                      value={soldOut ? 0 : item.quantity}
                      disabled={soldOut}
                      onChange={(e) => setQuantity(item.id, Number(e.target.value) || 1)}
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(item.id, item.quantity + 1)}
                      disabled={soldOut || atMax}
                      aria-label={t('cart.increase', { name: item.name })}
                    >+</button>
                  </div>
                  <strong>{formatVND(soldOut ? 0 : item.price * item.quantity)}</strong>
                </div>
              </article>
            );
          })}
          <button className="link-button danger clear-cart" onClick={clear}>{t('cart.clear')}</button>
        </section>

        <aside className="summary cart-summary">
          <p className="eyebrow dark"><span></span>{t('cart.summaryEyebrow')}</p>
          <h2>{t('cart.summaryTitle')}</h2>
          <div className="summary-row"><span>{t('cart.subtotal')}</span><strong>{formatVND(total)}</strong></div>
          {discount > 0 && (
            <div className="summary-row">
              <span>{t('cart.discount')} <small>{t('cart.discountFirst')}</small></span>
              <strong className="free-tag">− {formatVND(discount)}</strong>
            </div>
          )}
          <div className="summary-row"><span>{t('cart.shipping')}</span><strong className="free-tag">{t('common.free')}</strong></div>
          <div className="summary-note">
            <strong>{t('cart.deliveryTitle')}</strong>
            <p>{t('cart.deliveryBody')}</p>
          </div>
          <div className="summary-row grand-total"><span>{t('cart.total')}</span><strong>{formatVND(total - discount)}</strong></div>
          <p className="pos-hint">{t('cart.points', { n: pointsForLines(items.filter((item) => item.stock > 0), total - discount) })}</p>
          {user ? (
            <button
              className="btn btn-primary btn-block btn-large"
              disabled={hasUnavailable || count === 0}
              onClick={() => navigate('/dat-hang')}
            >
              {t('cart.continue')}
            </button>
          ) : (
            <>
              {/* Chưa đăng nhập: đặt ngay không cần tài khoản là lựa chọn chính. */}
              <p className="quick-promo">🎁 {t('quick.firstOrder', { amount: formatVND(FIRST_ORDER_DISCOUNT) })}</p>
              <button
                className="btn btn-primary btn-block btn-large quick-cta"
                disabled={hasUnavailable || count === 0}
                onClick={() => navigate('/dat-nhanh')}
              >
                {t('quick.cta')}
                <small>{t('quick.ctaHint')}</small>
              </button>
              <p className="quick-login">
                {t('quick.haveAccount')} <Link to="/dang-nhap" state={{ from: '/dat-hang' }}>{t('quick.login')}</Link>
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
