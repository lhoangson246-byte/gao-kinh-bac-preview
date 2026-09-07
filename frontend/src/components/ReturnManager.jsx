import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDateTime, formatVND } from '../api';

const TYPE_LABEL = { return: 'Trả hàng', exchange: 'Đổi hàng' };
const REFUND_LABEL = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', none: 'Không hoàn tiền' };

export default function ReturnManager({ notify }) {
  const [code, setCode] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [type, setType] = useState('exchange');
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadRecent = useCallback(async () => {
    try {
      const result = await api.retailReturns();
      setRecent(result.returns);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const selectedValue = useMemo(() => {
    if (!invoice) return 0;
    return invoice.items.reduce(
      (sum, item) => sum + item.price * (Number(quantities[item.id]) || 0), 0
    );
  }, [invoice, quantities]);

  const findInvoice = async (event) => {
    event?.preventDefault();
    setError('');
    if (!code.trim()) { setError('Nhập mã hoá đơn cần đổi/trả.'); return; }
    setLoading(true);
    try {
      const result = await api.retailInvoice(code.trim());
      setInvoice(result.invoice);
      setQuantities(Object.fromEntries(result.invoice.items.map((item) => [item.id, 0])));
      setRefundAmount('');
    } catch (err) {
      setInvoice(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const setQty = (item, value) => {
    const quantity = Math.max(0, Math.min(item.quantity, Math.round(Number(value)) || 0));
    setQuantities((current) => ({ ...current, [item.id]: quantity }));
  };

  const reset = () => {
    setInvoice(null); setCode(''); setQuantities({}); setType('exchange');
    setReason(''); setRefundAmount(''); setRefundMethod('cash'); setNote(''); setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    const items = Object.entries(quantities)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([invoiceItemId, quantity]) => ({
        invoice_item_id: Number(invoiceItemId), quantity: Number(quantity),
      }));
    if (!items.length) { setError('Chọn số lượng cho ít nhất một sản phẩm.'); return; }
    if (reason.trim().length < 3) { setError('Vui lòng nhập lý do đổi/trả.'); return; }

    setBusy(true);
    try {
      const result = await api.retailCreateReturn({
        invoice_id: invoice.id,
        return_type: type,
        reason: reason.trim(),
        refund_amount: type === 'return' && refundAmount !== '' ? Number(refundAmount) : undefined,
        refund_method: type === 'return' ? refundMethod : 'none',
        note: note.trim() || undefined,
        items,
      });
      notify?.(`Đã lưu phiếu ${result.return.code}.`);
      reset();
      await loadRecent();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow dark"><span></span>Tại quầy</p>
          <h1>Đổi trả hàng</h1>
          <p>Tìm hoá đơn, chọn đúng sản phẩm và lưu lại cách đã xử lý cho khách.</p>
        </div>
      </div>

      <form className="return-lookup" onSubmit={findInvoice}>
        <label>Mã hoá đơn
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)}
                 placeholder="Ví dụ: HD000012" />
        </label>
        <button className="btn btn-primary" disabled={loading}>
          {loading ? 'Đang tìm…' : 'Tìm hoá đơn'}
        </button>
      </form>

      {error && <div className="alert error" role="alert">{error}</div>}

      {invoice && (
        <form className="card return-form" onSubmit={submit}>
          <div className="return-invoice-summary">
            <div><small>Hoá đơn</small><strong>{invoice.code}</strong></div>
            <div><small>Khách hàng</small><strong>{invoice.customer_name || invoice.customer_phone || 'Khách vãng lai'}</strong></div>
            <div><small>Ngày mua</small><strong>{formatDateTime(invoice.created_at)}</strong></div>
            <div><small>Đã thanh toán</small><strong>{formatVND(invoice.total)}</strong></div>
          </div>

          <fieldset className="return-type">
            <legend>Hình thức xử lý</legend>
            <label className={type === 'exchange' ? 'selected' : ''}>
              <input type="radio" name="return-type" value="exchange" checked={type === 'exchange'}
                     onChange={(e) => setType(e.target.value)} />
              <span><strong>Đổi hàng</strong><small>Đổi sang sản phẩm khác, ghi rõ ở phần ghi chú.</small></span>
            </label>
            <label className={type === 'return' ? 'selected' : ''}>
              <input type="radio" name="return-type" value="return" checked={type === 'return'}
                     onChange={(e) => setType(e.target.value)} />
              <span><strong>Trả hàng</strong><small>Nhận lại hàng và hoàn tiền cho khách.</small></span>
            </label>
          </fieldset>

          <div className="return-items">
            <div className="return-items-head"><strong>Sản phẩm đổi/trả</strong><small>Nhập số lượng cần xử lý</small></div>
            {invoice.items.map((item) => (
              <div className="return-item" key={item.id}>
                <span><strong>{item.product_name}</strong><small>{formatVND(item.price)} / {item.unit} · đã mua {item.quantity}</small></span>
                <input className="input" type="number" min="0" max={item.quantity}
                       value={quantities[item.id] ?? 0} onChange={(e) => setQty(item, e.target.value)}
                       aria-label={`Số lượng ${item.product_name} cần đổi trả`} />
              </div>
            ))}
            <div className="summary-row"><span>Giá trị sản phẩm đã chọn</span><strong>{formatVND(selectedValue)}</strong></div>
          </div>

          <div className="form-grid return-details">
            <label>Lý do đổi/trả
              <textarea className="input" rows="3" value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="Ví dụ: túi bị rách khi giao, khách muốn đổi loại khác…" required />
            </label>
            <label>Ghi chú xử lý <span className="optional">Không bắt buộc</span>
              <textarea className="input" rows="3" value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="Ví dụ: đổi sang 1 túi ST25 LVS, khách bù thêm 20.000đ" />
            </label>
          </div>

          {type === 'return' && (
            <div className="return-refund">
              <label>Số tiền hoàn <span className="optional">Để trống để hệ thống tính theo hàng đã chọn</span>
                <input className="input" type="number" min="0" max={invoice.total}
                       value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)}
                       placeholder={String(Math.min(selectedValue, invoice.total))} />
              </label>
              <label>Hoàn bằng
                <select className="input" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                  <option value="cash">Tiền mặt</option>
                  <option value="transfer">Chuyển khoản</option>
                </select>
              </label>
            </div>
          )}

          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu phiếu đổi/trả'}</button>
            <button type="button" className="btn btn-ghost" onClick={reset}>Huỷ</button>
          </div>
        </form>
      )}

      <section className="return-history">
        <h2>Phiếu đổi trả gần đây</h2>
        {recent.length === 0 ? (
          <div className="admin-empty"><span>✓</span><h2>Chưa có phiếu đổi trả</h2><p>Các phiếu đã lưu sẽ xuất hiện tại đây.</p></div>
        ) : (
          <div className="pos-invoice-list">
            {recent.map((item) => (
              <article className="return-history-card" key={item.id}>
                <div><strong>{item.code}</strong><small>{TYPE_LABEL[item.return_type]} từ {item.invoice_code}</small></div>
                <div><strong>{item.customer_name || item.customer_phone || 'Khách vãng lai'}</strong><small>{item.reason}</small></div>
                <div><strong>{item.refund_amount ? formatVND(item.refund_amount) : 'Không hoàn tiền'}</strong><small>{REFUND_LABEL[item.refund_method]}</small></div>
                <time>{formatDateTime(item.created_at)}</time>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
