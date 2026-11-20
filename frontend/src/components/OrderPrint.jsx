import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatVND, DELIVERY_SLOT_LABEL, deliveryDateLabel, parseServerTime } from '../api';
import { DEFAULT_QR, INVOICE_HEADER, invoiceHeader, loadShopSettings } from '../shopInfo.js';

export { INVOICE_HEADER };
// Đầu hoá đơn (tên công ty, địa chỉ, số tài khoản, số điện thoại) lấy từ Quản trị → CẬP NHẬT (20/11/2026).

// Khổ A5 nằm ngang trừ lề (xem @page invoice trong styles.css): cao 148 − 2×5 = 138 mm.
const PAGE_HEIGHT_MM = 138;
const BASE_PT = 11;
const MIN_PT = 6.5;

/**
 * Đơn nhiều món: hạ cỡ chữ từng tờ cho vừa một tờ A5 ngang; nhỏ tới MIN_PT mà vẫn dài thì thu nhỏ cả tờ.
 * Đo khi tờ đang ở lớp .measure (ngoài màn hình, đúng bề rộng khổ in).
 */
function fitSheets(root) {
  const probe = document.createElement('div');
  probe.style.height = `${PAGE_HEIGHT_MM}mm`;
  root.appendChild(probe);
  const limit = probe.getBoundingClientRect().height;
  probe.remove();
  for (const sheet of root.querySelectorAll('.order-sheet')) {
    sheet.style.zoom = '';
    let size = BASE_PT;
    sheet.style.fontSize = `${size}pt`;
    while (sheet.scrollHeight > limit && size > MIN_PT) {
      size = Math.max(MIN_PT, size - 0.5);
      sheet.style.fontSize = `${size}pt`;
    }
    if (sheet.scrollHeight > limit) sheet.style.zoom = String(Math.floor((limit / sheet.scrollHeight) * 100) / 100);
    sheet.dataset.fit = String(size);
  }
}

const pad = (n) => String(n).padStart(2, '0');
/** "11/11/2026 10:19:35" theo giờ Việt Nam. */
function vnDateTime(value) {
  const date = parseServerTime(value);
  if (!date) return '';
  const vn = new Date(date.getTime() + 7 * 3600_000);
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}`;
}

function Sheet({ order, qr, header }) {
  const paid = order.payment_method === 'bank' && !!order.transfer_confirmed_at;
  const discount = order.discount || 0;
  const subtotal = order.subtotal || order.total + discount - (order.shipping_fee || 0);
  return (
    <article className="order-sheet">
      <header className="order-sheet-head">
        <div>
          <h1>{header.company}</h1>
          {header.lines.map((parts) => <p key={parts[0]}>{parts.map((part, i) => <span key={part}>{i > 0 && ' | '}{i > 0 ? <b>{part}</b> : part}</span>)}</p>)}
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
        <thead><tr><th>STT</th><th>Tên sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
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

      <div className="order-sheet-bottom">
        <div>{order.note && <p className="order-sheet-note"><b>Ghi chú:</b> {order.note}</p>}</div>
        <div className="order-sheet-totals">
          {(discount > 0 || order.shipping_fee > 0) && <p><span>Tiền hàng</span><b>{formatVND(subtotal)}</b></p>}
          {order.shipping_fee > 0 && <p><span>Phí giao hàng</span><b>{formatVND(order.shipping_fee)}</b></p>}
          {discount > 0 && <p><span>Giảm giá</span><b>− {formatVND(discount)}</b></p>}
          <p className="grand"><span>Tổng tiền</span><b>{formatVND(order.total)}</b></p>
          <p className="pay">{paid ? 'Đã thanh toán chuyển khoản' : order.payment_method === 'bank' ? 'Khách chọn chuyển khoản' : `Thu khi giao hàng: ${formatVND(order.total)}`}</p>
        </div>
      </div>
      <footer className="order-sheet-sign"><span>Khách hàng</span><span>Người bán</span></footer>
    </article>
  );
}

/**
 * In một hoặc nhiều đơn theo mẫu hoá đơn bán hàng của cửa hàng, kèm mã QR chuyển khoản: mỗi đơn một tờ
 * A5 nằm ngang, đơn nhiều món tự co cho vừa tờ. Gắn vào <body> và chỉ phần này được in; in xong (hoặc huỷ)
 * thì gọi onDone.
 */
export default function OrderPrint({ orders, onDone }) {
  const [qr, setQr] = useState(null);
  const [header, setHeader] = useState(INVOICE_HEADER);
  const rootRef = useRef(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let alive = true;
    // Lấy mới mỗi lần in: vừa sửa ở mục CẬP NHẬT thì hoá đơn in ra đúng ngay.
    loadShopSettings({ fresh: true }).then((s) => {
      if (!alive) return;
      setHeader(invoiceHeader(s.invoice));
      setQr(s.bank_qr_url || DEFAULT_QR);
    });
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
    ready.then(() => {
      if (cancelled) return;
      const root = rootRef.current;
      if (root) {
        root.classList.add('measure');
        fitSheets(root);
        root.classList.remove('measure');
      }
      window.print();
    });
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', finish);
      document.documentElement.classList.remove('printing-orders');
    };
  }, [qr]);

  if (!qr) return null;
  return createPortal(
    <div className="order-print-root" aria-hidden="true" ref={rootRef}>
      {orders.map((order) => <Sheet key={order.id} order={order} qr={qr} header={header} />)}
    </div>,
    document.body,
  );
}
