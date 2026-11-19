import { Fragment, useState } from 'react';
import { formatDateTime, formatVND, STATUS_LABEL } from '../api';
import OrderReturnForm from './OrderReturnForm.jsx';

const time = (value) => formatDateTime(value).split(' ')[0];

/**
 * Đơn hàng dạng bảng (xem theo ngày): một dòng một đơn, tổng tiền ở cuối (không tính đơn huỷ).
 * Đơn đã giao xong có nút "Trả / đổi" (19/11/2026) mở phiếu trả hàng ngay dưới dòng đơn.
 */
export default function OrdersTable({ orders, canReturn = false, onReturned }) {
  const [returning, setReturning] = useState(null);
  const returnable = (o) => canReturn && o.status === 'completed' && o.payment_status !== 'debt' && o.items.some((i) => i.quantity - (i.returned || 0) > 0);
  const counted = orders.filter((o) => o.status !== 'cancelled');
  const total = counted.reduce((sum, o) => sum + o.total, 0);
  const cod = counted.filter((o) => o.payment_method === 'cod').reduce((sum, o) => sum + o.total, 0);
  return (
    <div className="table-scroll orders-table">
      <table className="data-table responsive-table">
        <thead>
          <tr>
            <th>Mã đơn</th><th>Giờ đặt</th><th>Khách</th><th>SĐT</th><th>Nhận hàng</th><th>Hàng</th>
            <th className="num">Khách trả</th><th>Thanh toán</th><th>Trạng thái</th><th>Giờ hoàn thành</th><th>Nguồn</th><th>Người giao</th><th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <Fragment key={o.id}>
            <tr className={o.status === 'cancelled' ? 'row-muted' : ''}>
              <td data-label="Mã đơn"><strong>{o.code}</strong></td>
              <td data-label="Giờ đặt">{time(o.created_at)}<small className="cell-note">{formatDateTime(o.created_at).split(' ')[1]}</small></td>
              <td data-label="Khách">{o.receiver_name}{o.wholesale_code && <small className="cell-note">🏢 {o.wholesale_code} · {o.wholesale_company}</small>}</td>
              <td data-label="SĐT"><a href={`tel:${o.phone}`}>{o.phone}</a></td>
              <td data-label="Nhận hàng">{o.fulfillment === 'pickup' ? 'Lấy tại cửa hàng' : o.address}</td>
              <td data-label="Hàng">{o.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')}</td>
              <td className="num" data-label="Khách trả">{formatVND(o.total)}{o.discount > 0 && <small className="cell-note">giảm {formatVND(o.discount)}</small>}{o.shipping_fee > 0 && <small className="cell-note">gồm ship {formatVND(o.shipping_fee)}</small>}</td>
              <td data-label="Thanh toán">{o.payment_method === 'bank' ? 'Chuyển khoản' : 'Tiền mặt'}{o.payment_method === 'bank' && (
                <small className="cell-note">{o.transfer_confirmed_at ? '✓ đã nhận tiền' : o.transfer_reported_at ? '💳 khách báo đã chuyển' : 'chưa báo chuyển'}</small>
              )}</td>
              <td data-label="Trạng thái"><span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span>
                {o.returns?.length > 0 && <small className="cell-note">↩️ {o.returns.map((r) => (r.return_type === 'return' ? `trả, hoàn ${formatVND(r.refund_amount)}` : 'đổi hàng')).join(' · ')}</small>}</td>
              <td data-label="Giờ hoàn thành">{o.status === 'completed' && o.completed_at
                ? <>{time(o.completed_at)}<small className="cell-note">{formatDateTime(o.completed_at).split(' ')[1]}</small></>
                : '—'}</td>
              <td data-label="Nguồn">{o.source === 'staff' ? 'Nhân viên tạo' : o.is_guest ? 'Mua nhanh' : 'Tài khoản'}</td>
              <td data-label="Người giao">{o.shipper_name || '—'}</td>
              <td data-label="Thao tác">
                {returnable(o) && returning !== o.id
                  ? <button type="button" className="btn btn-secondary btn-small" onClick={() => setReturning(o.id)}>↩️ Trả / đổi</button>
                  : '—'}
              </td>
            </tr>
            {returning === o.id && (
              <tr className="order-return-row">
                <td colSpan={13}>
                  <OrderReturnForm order={o} onCancel={() => setReturning(null)}
                                   onDone={(message) => { setReturning(null); onReturned?.(message); }} />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>{orders.length} đơn · {counted.length} đơn không huỷ</td>
            <td className="num">{formatVND(total)}</td>
            <td colSpan={6}>Tiền mặt cần thu: {formatVND(cod)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
