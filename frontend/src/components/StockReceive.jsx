import { useEffect, useState } from 'react';
import { api, formatDateTime, formatVND } from '../api';

/**
 * Hộp nhập kho cho một loại gạo.
 * Số lượng gõ vào được CỘNG THÊM vào tồn kho, đúng cách nghĩ "hôm nay nhập 20 bao".
 */
export default function StockReceive({ product, onClose, onDone }) {
  const [quantity, setQuantity] = useState('');
  const [costPrice, setCostPrice] = useState(product.cost_price > 0 ? String(product.cost_price) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.adminStockHistory(product.id)
      .then(({ entries }) => { if (!cancelled) setHistory(entries); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [product.id]);

  const added = Number(quantity) || 0;
  const stockAfter = product.stock + (added > 0 ? Math.round(added) : 0);
  const cost = Number(costPrice) || 0;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const errors = {};
    if (!Number.isInteger(added) || added < 1) {
      errors.quantity = 'Nhập số lượng nguyên, lớn hơn 0.';
    }
    if (costPrice !== '' && (!Number.isInteger(cost) || cost < 0)) {
      errors.cost_price = 'Giá nhập phải là số nguyên từ 0 trở lên.';
    }
    if (Object.keys(errors).length) { setFieldErrors(errors); return; }

    setFieldErrors({});
    setBusy(true);
    try {
      const r = await api.adminReceiveStock(product.id, {
        quantity: added,
        cost_price: costPrice === '' ? undefined : cost,
        note: note.trim() || undefined,
      });
      onDone(r.product, `Đã nhập ${added} ${product.unit} vào “${product.name}”.`);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stock-box" onSubmit={submit}>
      <div className="form-header">
        <div>
          <h2>Nhập kho</h2>
          <p><strong>{product.name}</strong> · {product.unit}</p>
        </div>
        <button type="button" className="icon-close" onClick={onClose} aria-label="Đóng">×</button>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="stock-current">
        <div><span>Tồn kho hiện tại</span><strong>{product.stock} {product.unit}</strong></div>
        <div aria-hidden="true" className="stock-arrow">→</div>
        <div className={added > 0 ? 'stock-after' : ''}>
          <span>Sau khi nhập</span><strong>{stockAfter} {product.unit}</strong>
        </div>
      </div>

      <div className="row">
        <label>Nhập thêm <b>*</b>
          <input className="input" type="number" inputMode="numeric" min="1" step="1"
                 value={quantity} onChange={(e) => setQuantity(e.target.value)}
                 placeholder={`Số ${product.unit}`} autoFocus
                 aria-invalid={!!fieldErrors.quantity} />
          {fieldErrors.quantity && <small className="err">{fieldErrors.quantity}</small>}
        </label>

        <label>Giá nhập <span className="optional">Không bắt buộc</span>
          <input className="input" type="number" inputMode="numeric" min="0" step="1"
                 value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
                 placeholder="Ví dụ: 120000" aria-invalid={!!fieldErrors.cost_price} />
          {fieldErrors.cost_price
            ? <small className="err">{fieldErrors.cost_price}</small>
            : <small className="field-help">Điền nếu giá nhập lần này khác lần trước.</small>}
        </label>
      </div>

      {cost > 0 && product.price > 0 && (
        <p className="stock-profit">
          Giá bán {formatVND(product.price)} − giá nhập {formatVND(cost)} ={' '}
          <strong className={product.price - cost >= 0 ? 'free-tag' : 'err'}>
            lãi {formatVND(product.price - cost)}
          </strong> mỗi {product.unit}
          {added > 0 && <> · lô này trị giá <strong>{formatVND(cost * added)}</strong></>}
        </p>
      )}

      <label>Ghi chú <span className="optional">Không bắt buộc</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
               placeholder="Ví dụ: lấy từ kho Hưng Yên" />
      </label>

      <div className="form-actions">
        <button className="btn btn-primary btn-large" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Xác nhận nhập kho'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Bỏ qua</button>
      </div>

      {history.length > 0 && (
        <div className="stock-history">
          <h3>Lịch sử nhập ({history.length})</h3>
          <ul>
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <span>
                  <strong>+{h.quantity} {product.unit}</strong>
                  <small>
                    {formatDateTime(h.created_at)} · còn {h.stock_after}
                    {h.cost_price != null && ` · giá nhập ${formatVND(h.cost_price)}`}
                    {h.note && ` · ${h.note}`}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
