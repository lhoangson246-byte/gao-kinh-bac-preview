import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import AddressBook from '../components/AddressBook.jsx';
import {
  api, formatVND, orderDiscountFor, DELIVERY_AREA_CODE, DELIVERY_AREA_LABEL, DELIVERY_SLOTS,
} from '../api';

export default function Checkout() {
  const { items, total, hasUnavailable, clear } = useCart();
  const navigate = useNavigate();

  const orderable = items.filter((item) => item.stock > 0 && item.quantity > 0);
  // Xem trước mức giảm; máy chủ vẫn tự tính lại khi tạo đơn.
  const discount = orderDiscountFor(total);

  const [selectedAddress, setSelectedAddress] = useState(null);
  const [form, setForm] = useState({
    delivery_area: DELIVERY_AREA_CODE,
    delivery_slot: 'sang',
    note: '',
    payment_method: 'cod',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const onSelectAddress = (address) => {
    setSelectedAddress(address);
    if (address) setFieldErrors((current) => ({ ...current, address_id: undefined }));
  };

  /** Kiểm tra ngay tại trình duyệt; máy chủ vẫn kiểm tra lại lần nữa. */
  const validate = () => {
    const errors = {};
    if (!selectedAddress) errors.address_id = 'Hãy thêm hoặc chọn một địa chỉ nhận hàng.';
    return errors;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const errors = validate();
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setError('Vui lòng kiểm tra lại các thông tin được đánh dấu bên dưới.');
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await api.createOrder({
        ...form,
        address_id: selectedAddress.id,
        items: orderable.map((item) => ({ product_id: item.id, quantity: item.quantity })),
      });
      clear();
      navigate('/don-hang', { replace: true, state: { justOrdered: true } });
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
        <h1>Chưa có sản phẩm để đặt</h1>
        <p>Giỏ hàng đang trống hoặc các loại gạo đã chọn tạm hết hàng.</p>
        <Link className="btn btn-primary btn-large" to="/">Chọn gạo</Link>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-heading">
        <div><p className="eyebrow dark"><span></span>Bước cuối cùng</p><h1>Thông tin nhận hàng</h1></div>
        <Link to="/gio-hang" className="text-link">← Quay lại giỏ hàng</Link>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {hasUnavailable && (
        <div className="alert warning" role="status">
          Những loại gạo đã hết hàng trong giỏ sẽ không được đưa vào đơn này.
        </div>
      )}

      <div className="checkout">
        <div className="form-card flat checkout-form">
          <div className="form-section-title">
            <span>1</span><div><h2>Địa chỉ nhận hàng</h2><p>Chọn địa chỉ đã lưu hoặc thêm địa chỉ mới.</p></div>
          </div>

          <AddressBook selectable selectedId={selectedAddress?.id} onSelect={onSelectAddress} />
          {fieldErrors.address_id && <small className="err address-required-error">{fieldErrors.address_id}</small>}

          <div className="form-section-title">
            <span>2</span><div><h2>Thời gian giao hàng</h2><p>Giao miễn phí trong tỉnh {DELIVERY_AREA_LABEL}.</p></div>
          </div>

          <fieldset className="slot-group">
            <legend>Khung giờ giao trong ngày <span className="free-tag">Miễn phí</span></legend>
            <div className="payment-options">
              {DELIVERY_SLOTS.map(([code, name, time]) => (
                <label key={code} className={form.delivery_slot === code ? 'selected' : ''}>
                  <input type="radio" name="delivery_slot" value={code}
                         checked={form.delivery_slot === code} onChange={onChange} />
                  <span aria-hidden="true">◷</span>
                  <div><strong>{name}</strong><small>{time}</small></div>
                </label>
              ))}
            </div>
            <small className="field-help">
              Cửa hàng giao hoả tốc trong ngày và không thu phí giao hàng.
            </small>
          </fieldset>

          <label>Ghi chú cho cửa hàng <span className="optional">Không bắt buộc</span>
            <textarea className="input" name="note" rows={2} value={form.note} onChange={onChange}
                      placeholder="Ví dụ: gọi trước khi tới, nhà trong ngõ…" />
          </label>

          <div className="form-section-title">
            <span>3</span><div><h2>Thanh toán</h2><p>Chọn cách thuận tiện nhất cho gia đình.</p></div>
          </div>

          <div className="payment-options">
            <label className={form.payment_method === 'cod' ? 'selected' : ''}>
              <input type="radio" name="payment_method" value="cod" checked={form.payment_method === 'cod'} onChange={onChange} />
              <span aria-hidden="true">◫</span><div><strong>Thanh toán khi nhận hàng</strong><small>Trả tiền khi gạo được giao tới nhà</small></div>
            </label>
            <label className={form.payment_method === 'bank' ? 'selected' : ''}>
              <input type="radio" name="payment_method" value="bank" checked={form.payment_method === 'bank'} onChange={onChange} />
              <span aria-hidden="true">▤</span><div><strong>Chuyển khoản ngân hàng</strong><small>Cửa hàng gửi thông tin khi xác nhận đơn</small></div>
            </label>
          </div>

          {form.payment_method === 'bank' && (
            <p className="payment-hint" role="status">
              Bạn chưa cần chuyển tiền lúc này. Cửa hàng sẽ gọi xác nhận đơn rồi gửi thông tin
              tài khoản và số tiền cần chuyển. Cửa hàng không thu phí giao hàng.
            </p>
          )}

          <button type="button" className="btn btn-primary btn-block btn-large mobile-submit"
                  disabled={busy} onClick={onSubmit}>
            {busy ? 'Đang gửi đơn…' : `Xác nhận đặt hàng · ${formatVND(total - discount)}`}
          </button>
        </div>

        <aside className="summary order-summary">
          <p className="eyebrow dark"><span></span>Đơn của bạn</p>
          <h2>{orderable.length} loại gạo</h2>
          <div className="summary-products">
            {orderable.map((item) => (
              <div key={item.id} className="summary-row">
                <span><strong>{item.name}</strong><small>{item.quantity} {item.unit} × {formatVND(item.price)}</small></span>
                <span>{formatVND(item.price * item.quantity)}</span>
              </div>
            ))}
          </div>
          {discount > 0 && (
            <div className="summary-row"><span>Giảm giá</span><strong className="free-tag">− {formatVND(discount)}</strong></div>
          )}
          <div className="summary-row"><span>Phí giao hàng</span><strong className="free-tag">Miễn phí</strong></div>
          <div className="summary-row grand-total"><span>Tạm tính</span><strong>{formatVND(total - discount)}</strong></div>
          <p className="summary-disclaimer">
            Bằng việc đặt hàng, bạn xác nhận đây là đơn mua lẻ và địa chỉ nhận thuộc tỉnh {DELIVERY_AREA_LABEL}.
          </p>
          <button type="button" className="btn btn-primary btn-block btn-large desktop-submit"
                  disabled={busy} onClick={onSubmit}>
            {busy ? 'Đang gửi đơn…' : 'Xác nhận đặt hàng'}
          </button>
        </aside>
      </div>
    </div>
  );
}
