import { useEffect, useState } from 'react';
import { api, formatDateTime, formatVND, STATUS_LABEL } from '../api';
import OrderPrint from './OrderPrint.jsx';
import { ListSkeleton } from './Skeleton.jsx';

const PAGE = 10;
const kgText = (kg) => (kg == null ? '—' : `${Number(kg).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} kg`);
const payLabel = (o) => (o.payment_status === 'debt' ? 'Công nợ'
  : o.payment_method === 'bank' ? (o.transfer_confirmed_at ? 'Chuyển khoản ✓' : 'Chuyển khoản (chờ xác nhận)') : 'Tiền mặt');

/**
 * Đơn cũ của một khách buôn (20/11/2026): bảng giá đã mua theo loại gạo, rồi từng hoá đơn theo mẫu hoá đơn
 * bán hàng của cửa hàng, thêm cột số kg và đơn giá 1kg = thành tiền ÷ số kg đã mua. In lại được từng hoá đơn.
 */
export default function WholesaleOrders({ customer }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [printing, setPrinting] = useState(null);
  useEffect(() => {
    let alive = true;
    api.adminWholesaleOrders(customer.id).then((d) => alive && setData(d)).catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, [customer.id]);

  if (error) return <p className="alert error" role="alert">{error}</p>;
  if (!data) return <ListSkeleton rows={2} label="Đang tải đơn của khách…" />;
  if (!data.orders.length) return <p className="muted">Khách {customer.code} chưa có đơn nào.</p>;
  const live = data.orders.filter((o) => o.status !== 'cancelled');
  const bought = live.reduce((s, o) => s + o.total, 0);
  const kg = data.summary.reduce((s, g) => s + (g.kg || 0), 0);

  return (
    <div className="ws-orders">
      <p className="ws-orders-sum">
        <b>{data.total}</b> đơn · {live.length} đơn không huỷ · đã mua <b>{formatVND(bought)}</b>
        {kg > 0 && <> · <b>{kgText(Math.round(kg * 10) / 10)}</b> gạo</>}
      </p>

      <h3>Bảng giá đã mua theo loại gạo</h3>
      <div className="table-scroll">
        <table className="data-table responsive-table ws-price-table">
          <thead><tr><th>Loại gạo</th><th className="num">Số lần mua</th><th className="num">Số lượng</th><th className="num">Tổng kg</th><th className="num">Thành tiền</th><th className="num">Đơn giá 1kg</th></tr></thead>
          <tbody>
            {data.summary.map((g) => (
              <tr key={`${g.product_name}|${g.unit}`}>
                <td data-label="Loại gạo"><strong>{g.product_name}</strong> <small className="muted">{g.unit}</small></td>
                <td data-label="Số lần mua" className="num">{g.orders}</td>
                <td data-label="Số lượng" className="num">{g.quantity.toLocaleString('vi-VN')} {g.unit.split(' ')[0]}</td>
                <td data-label="Tổng kg" className="num">{kgText(g.kg)}</td>
                <td data-label="Thành tiền" className="num">{formatVND(g.amount)}</td>
                <td data-label="Đơn giá 1kg" className="num"><strong>{g.price_per_kg ? `${formatVND(g.price_per_kg)}/kg` : '—'}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="field-help">Đơn giá 1kg = thành tiền loại gạo đó ÷ số kg đã mua (không tính đơn huỷ, quà tặng 0đ).</small>

      <h3>Hoá đơn đã đặt</h3>
      <div className="ws-invoices">
        {data.orders.slice(0, shown).map((o) => {
          const subtotal = o.subtotal || o.items.reduce((s, i) => s + i.amount, 0);
          return (
            <article key={o.id} className={`ws-invoice${o.status === 'cancelled' ? ' cancelled' : ''}`}>
              <header>
                <div>
                  <h4>Hóa đơn bán hàng <small>{o.code}</small></h4>
                  <p>Ngày: {formatDateTime(o.confirmed_at || o.created_at)} · Người nhận: <b>{o.receiver_name}</b> · {o.phone}</p>
                  <p>Địa chỉ: {o.fulfillment === 'pickup' ? 'Khách lấy tại cửa hàng' : o.address}{o.shipper_name ? ` · Người giao: ${o.shipper_name}` : ''}</p>
                </div>
                <div className="ws-invoice-tags">
                  <span className={`status ${o.status}`}>{STATUS_LABEL[o.status] || o.status}</span>
                  <small>{payLabel(o)}</small>
                  {o.status !== 'cancelled' && <button type="button" className="btn btn-secondary btn-small" onClick={() => setPrinting([o])}>🖨️ In hoá đơn</button>}
                </div>
              </header>
              <div className="table-scroll">
                <table className="ws-invoice-table">
                  <thead><tr><th>STT</th><th>Tên sản phẩm</th><th className="num">SL</th><th className="num">Đơn giá</th><th className="num">Thành tiền</th><th className="num">Số kg</th><th className="num">Giá 1kg</th></tr></thead>
                  <tbody>
                    {o.items.map((i, n) => (
                      <tr key={i.id}>
                        <td>{n + 1}</td>
                        <td>{i.product_name} <small>{i.unit}{i.is_reward ? ' · quà đổi điểm' : i.promo ? ' · quà khuyến mãi' : ''}</small></td>
                        <td className="num">{i.quantity.toLocaleString('vi-VN')}</td>
                        <td className="num">{formatVND(i.price)}</td>
                        <td className="num">{formatVND(i.amount)}</td>
                        <td className="num">{kgText(i.kg)}</td>
                        <td className="num"><strong>{i.price_per_kg ? formatVND(i.price_per_kg) : '—'}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ws-invoice-totals">
                {o.note && <p className="ws-invoice-note"><b>Ghi chú:</b> {o.note}</p>}
                <dl>
                  {(o.discount > 0 || o.shipping_fee > 0) && <><dt>Tiền hàng</dt><dd>{formatVND(subtotal)}</dd></>}
                  {o.shipping_fee > 0 && <><dt>Phí giao hàng</dt><dd>{formatVND(o.shipping_fee)}</dd></>}
                  {o.discount > 0 && <><dt>Giảm giá</dt><dd>− {formatVND(o.discount)}</dd></>}
                  <dt className="grand">Tổng tiền</dt><dd className="grand">{formatVND(o.total)}</dd>
                </dl>
              </div>
            </article>
          );
        })}
      </div>
      {data.orders.length > shown && (
        <button type="button" className="btn btn-secondary" onClick={() => setShown(shown + PAGE)}>Xem thêm ({data.orders.length - shown} hoá đơn)</button>
      )}
      {printing && <OrderPrint orders={printing} onDone={() => setPrinting(null)} />}
    </div>
  );
}
