import { formatDateTime, formatVND, STATUS_LABEL } from '../api';

const time = (value) => formatDateTime(value).split(' ')[0];

/** Đơn hàng dạng bảng (xem theo ngày): một dòng một đơn, tổng tiền ở cuối (không tính đơn huỷ). */
export default function OrdersTable({ orders }) {
  const counted = orders.filter((o) => o.status !== 'cancelled');
  const total = counted.reduce((sum, o) => sum + o.total, 0);
  const cod = counted.filter((o) => o.payment_method === 'cod').reduce((sum, o) => sum + o.total, 0);
  return (
    <div className="table-scroll orders-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>Mã đơn</th><th>Giờ đặt</th><th>Khách</th><th>SĐT</th><th>Nhận hàng</th><th>Hàng</th>
            <th className="num">Khách trả</th><th>Thanh toán</th><th>Trạng thái</th><th>Nguồn</th><th>Người giao</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className={o.status === 'cancelled' ? 'row-muted' : ''}>
              <td><strong>{o.code}</strong></td>
              <td>{time(o.created_at)}<small className="cell-note">{formatDateTime(o.created_at).split(' ')[1]}</small></td>
              <td>{o.receiver_name}{o.wholesale_code && <small className="cell-note">🏢 {o.wholesale_code} · {o.wholesale_company}</small>}</td>
              <td><a href={`tel:${o.phone}`}>{o.phone}</a></td>
              <td>{o.fulfillment === 'pickup' ? 'Lấy tại cửa hàng' : o.address}</td>
              <td>{o.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')}</td>
              <td className="num">{formatVND(o.total)}{o.discount > 0 && <small className="cell-note">giảm {formatVND(o.discount)}</small>}{o.shipping_fee > 0 && <small className="cell-note">gồm ship {formatVND(o.shipping_fee)}</small>}</td>
              <td>{o.payment_method === 'bank' ? 'Chuyển khoản' : 'Tiền mặt'}{o.payment_method === 'bank' && (
                <small className="cell-note">{o.transfer_confirmed_at ? '✓ đã nhận tiền' : o.transfer_reported_at ? '💳 khách báo đã chuyển' : 'chưa báo chuyển'}</small>
              )}</td>
              <td><span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span></td>
              <td>{o.source === 'staff' ? 'Nhân viên tạo' : o.is_guest ? 'Mua nhanh' : 'Tài khoản'}</td>
              <td>{o.shipper_name || '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>{orders.length} đơn · {counted.length} đơn không huỷ</td>
            <td className="num">{formatVND(total)}</td>
            <td colSpan={4}>Tiền mặt cần thu: {formatVND(cod)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
