import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import { api, formatVND, pointsFor } from '../api';

export default function Cart() {
  const { items, total, count, hasUnavailable, setQuantity, remove, clear, syncWithProducts } = useCart();
  const [syncError, setSyncError] = useState('');

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
      .catch(() => { if (!cancelled) setSyncError('Chưa kiểm tra được tồn kho mới nhất. Cửa hàng sẽ xác nhận lại khi gọi cho bạn.'); });
    return () => { cancelled = true; };
  }, [syncWithProducts]);

  if (items.length === 0) {
    return (
      <div className="empty empty-page">
        <span className="empty-icon" aria-hidden="true">🧺</span>
        <h1>Giỏ hàng đang trống</h1>
        <p>Hãy chọn loại gạo phù hợp cho bữa cơm nhà mình.</p>
        <Link className="btn btn-primary btn-large" to="/">Xem các loại gạo</Link>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-heading">
        <div><p className="eyebrow dark"><span></span>Đơn hàng của bạn</p><h1>Giỏ hàng</h1></div>
        <Link to="/" className="text-link">← Chọn thêm gạo</Link>
      </div>

      {syncError && <div className="alert warning" role="status">{syncError}</div>}
      {hasUnavailable && (
        <div className="alert error" role="alert">
          Có loại gạo trong giỏ đã hết hàng. Vui lòng xoá khỏi giỏ trước khi đặt.
        </div>
      )}

      <div className="cart-layout">
        <section className="cart-list" aria-label="Các sản phẩm trong giỏ">
          {items.map((item) => {
            const soldOut = item.stock <= 0;
            const atMax = !soldOut && item.quantity >= item.stock;
            return (
              <article className={`cart-item${soldOut ? ' sold-out' : ''}`} key={item.id}>
                <div className="cart-grain" aria-hidden="true">🌾</div>
                <div className="cart-item-main">
                  <h2>{item.name}</h2>
                  <p>{formatVND(item.price)} / {item.unit}</p>
                  {soldOut
                    ? <p className="cart-warning">Tạm hết hàng — vui lòng xoá khỏi giỏ.</p>
                    : atMax && <p className="cart-warning">Cửa hàng chỉ còn {item.stock} {item.unit}.</p>}
                  <button className="link-button danger" onClick={() => remove(item.id)}>
                    Xoá khỏi giỏ
                  </button>
                </div>
                <div className="cart-item-end">
                  <div className="qty-stepper">
                    <button
                      type="button"
                      onClick={() => setQuantity(item.id, item.quantity - 1)}
                      disabled={soldOut || item.quantity <= 1}
                      aria-label={`Giảm số lượng ${item.name}`}
                    >−</button>
                    <input
                      aria-label={`Số lượng ${item.name}`}
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
                      aria-label={`Tăng số lượng ${item.name}`}
                    >+</button>
                  </div>
                  <strong>{formatVND(soldOut ? 0 : item.price * item.quantity)}</strong>
                </div>
              </article>
            );
          })}
          <button className="link-button danger clear-cart" onClick={clear}>Xoá toàn bộ giỏ hàng</button>
        </section>

        <aside className="summary cart-summary">
          <p className="eyebrow dark"><span></span>Tóm tắt</p>
          <h2>Đơn hàng</h2>
          <div className="summary-row"><span>Tiền hàng</span><strong>{formatVND(total)}</strong></div>
          {discount > 0 && (
            <div className="summary-row">
              <span>Giảm giá <small>ưu đãi đơn đầu tiên</small></span>
              <strong className="free-tag">− {formatVND(discount)}</strong>
            </div>
          )}
          <div className="summary-row"><span>Phí giao hàng</span><strong className="free-tag">Miễn phí</strong></div>
          <div className="summary-note">
            <strong>Giao hàng tại Bắc Ninh</strong>
            <p>Giao hoả tốc trong ngày, miễn phí giao hàng. Cửa hàng gọi xác nhận địa chỉ trước khi giao.</p>
          </div>
          <div className="summary-row grand-total"><span>Tạm tính</span><strong>{formatVND(total - discount)}</strong></div>
          <p className="pos-hint">Đơn này cộng {pointsFor(total - discount)} điểm tích luỹ khi giao xong.</p>
          <button
            className="btn btn-primary btn-block btn-large"
            disabled={hasUnavailable || count === 0}
            onClick={() => navigate('/dat-hang')}
          >
            Tiếp tục đặt hàng
          </button>
        </aside>
      </div>
    </div>
  );
}
