import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, formatVND, DELIVERY_SLOT_LABEL, deliveryDateLabel, parseServerTime } from '../api';

/**
 * Đầu hoá đơn in, chép đúng theo hoá đơn giấy cửa hàng đang dùng (ảnh mẫu chị Linh gửi 13/11/2026).
 * Đổi thông tin công ty, địa chỉ, số tài khoản, số điện thoại thì sửa ở đây.
 */
export const INVOICE_HEADER = {
  company: 'Công Ty CP Lương Thực Lúa Vàng Châu Á',
  lines: [
    ['CS1: 51A Nguyễn Cao - Kinh Bắc - Bắc Ninh', 'STK Vietcombank: 1204372888'],
    ['CS2: Đ.Triệu Việt Vương - Bồ Sơn 4 - Võ Cường - TP.BN'],
    ['Điện thoại: 02223.813.566 - 0979.848.405'],
  ],
};
const DEFAULT_QR = '/bank-qr.png';

const pad = (n) => String(n).padStart(2, '0');
/** "11/11/2026 10:19:35" theo giờ Việt Nam. */
function vnDateTime(value) {
  const date = parseServerTime(value);
  if (!date) return '';
  const vn = new Date(date.getTime() + 7 * 3600_000);
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}`;
}

function Sheet({ order, qr }) {
  const paid = order.payment_method === 'bank' && !!order.transfer_confirmed_at;
  const discount = order.discount || 0;
  const subtotal = order.subtotal || order.total + discount - (order.shipping_fee || 0);
  return (
    <article className="order-sheet">
      <header className="order-sheet-head">
        <div>
          <h1>{INVOICE_HEADER.company}</h1>
          {INVOICE_HEADER.lines.map((parts) => <p key={parts[0]}>{parts.map((part, i) => <span key={part}>{i > 0 && ' | '}{i > 0 ? <b>{part}</b> : part}</span>)}</p>)}
          <p>Ngày : {vnDateTime(order.confirmed_at || order.created_at)}</p>
        </div>
        <figure className="order-sheet-qr">
          <img src={qr} alt="Mã QR chuyển khoản" />
          <figcaption>{paid ? 'Đã nhận chuyển khoản' : <>Quét để chuyển khoản<br />Nội dung: <b>{order.code}</b></>}</figcaption>
        </figure>
      </header>

      <h2>Hóa đơn bán hàng <small>{order.code}</small></h2>
      <div className="order-sheet-customer">
        <p><span>Tên Khách Hàng:</span> <b>{order.wholesale_company ? `${order.wholesale_company} (${order.receiver_name})` : order.receiver_name}</b></p>
        <p><span>SĐT:</span> <b>{order.phone}</b></p>
        <p className="wide"><span>Địa chỉ:</span> {order.fulfillment === 'pickup' ? 'Khách lấy tại cửa hàng' : order.address}</p>
        {order.delivery_slot && <p><span>Giao:</span> {DELIVERY_SLOT_LABEL[order.delivery_slot]} · ngày {deliveryDateLabel(order.created_at, order.delivery_slot)}</p>}
        {order.shipper_name && <p><span>Người giao:</span> {order.shipper_name}</p>}
      </div>

      <table>
        <thead><tr><th>STT</th><th>Tên sản phẩm</th><th>Số lượng</th><th>Giá tiền</th><th>Thành Tiền</th></tr></thead>
        <tbody>
          {order.items.map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>
              <td className="name">{item.product_name}{item.is_reward ? ' (quà đổi điểm)' : item.promo ? ' (quà khuyến mãi)' : ''} <small>{item.unit}</small></td>
              <td>{item.quantity.toLocaleString('vi-VN')}</td>
              <td>{formatVND(item.price)}</td>
              <td>{formatVND(item.price * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="order-sheet-totals">
        {(discount > 0 || order.shipping_fee > 0) && <p><span>Tiền hàng</span><b>{formatVND(subtotal)}</b></p>}
        {order.shipping_fee > 0 && <p><span>Phí giao hàng</span><b>{formatVND(order.shipping_fee)}</b></p>}
        {discount > 0 && <p><span>Giảm giá</span><b>− {formatVND(discount)}</b></p>}
        <p className="grand"><span>Tổng tiền</span><b>{formatVND(order.total)}</b></p>
        <p className="pay">{paid ? 'Đã thanh toán chuyển khoản' : order.payment_method === 'bank' ? 'Khách chọn chuyển khoản' : `Thu khi giao hàng: ${formatVND(order.total)}`}</p>
      </div>
      {order.note && <p className="order-sheet-note"><b>Ghi chú:</b> {order.note}</p>}
      <footer className="order-sheet-sign"><span>Khách hàng</span><span>Người bán</span></footer>
    </article>
  );
}

/**
 * In một hoặc nhiều đơn (mỗi đơn một trang) theo mẫu hoá đơn bán hàng của cửa hàng, kèm mã QR chuyển
 * khoản. Gắn vào <body> và chỉ phần này được in; in xong (hoặc huỷ) thì gọi onDone.
 */
export default function OrderPrint({ orders, onDone }) {
  const [qr, setQr] = useState(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let alive = true;
    api.storefront().then(({ settings }) => alive && setQr(settings?.bank_qr_url || DEFAULT_QR)).catch(() => alive && setQr(DEFAULT_QR));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!qr) return undefined;
    document.documentElement.classList.add('printing-orders');
    const finish = () => {
      document.documentElement.classList.remove('printing-orders');
      done.current?.();
    };
    window.addEventListener('afterprint', finish, { once: true });
    // Chờ ảnh QR tải xong (tối đa 2 giây) rồi mới mở hộp in, để bản in không thiếu mã QR.
    const images = [...document.querySelectorAll('.order-print-root img')];
    const ready = Promise.race([
      Promise.all(images.map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; })))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    let cancelled = false;
    ready.then(() => { if (!cancelled) window.print(); });
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', finish);
      document.documentElement.classList.remove('printing-orders');
    };
  }, [qr]);

  if (!qr) return null;
  return createPortal(
    <div className="order-print-root" aria-hidden="true">
      {orders.map((order) => <Sheet key={order.id} order={order} qr={qr} />)}
    </div>,
    document.body,
  );
}
