import db from './db.js';
import { localDate, REPORT_TIME_SHIFT } from './constants.js';
import { HttpError } from './validate.js';

const MAX_ROWS = 50000;
const DAY_MS = 86400000;
const statusNames = { pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', shipping: 'Đang giao', completed: 'Hoàn thành', cancelled: 'Đã huỷ' };
const paymentNames = { cod: 'Thanh toán khi nhận hàng', bank: 'Chuyển khoản', cash: 'Tiền mặt', transfer: 'Chuyển khoản' };
const slotNames = { sang: 'Buổi sáng 07:00–11:30', chieu: 'Buổi chiều 14:00–18:00' };

export async function buildOrdersWorkbook(period) {
  const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY_MS) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 366) {
    throw new HttpError(400, 'Chỉ xuất tối đa 366 ngày. Vui lòng chọn khoảng ngày ngắn hơn.');
  }
  const args = [period.from, period.to];
  // Cùng một snapshot, tránh đơn vừa thay đổi làm lệch tổng hoặc vượt giới hạn.
  const data = db.transaction(() => {
    const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM orders WHERE ${localDate('created_at')} BETWEEN ? AND ?) +
      (SELECT COUNT(*) FROM retail_invoices WHERE ${localDate('created_at')} BETWEEN ? AND ?) +
      (SELECT COUNT(*) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${localDate('o.created_at')} BETWEEN ? AND ?) +
      (SELECT COUNT(*) FROM retail_invoice_items i JOIN retail_invoices v ON v.id=i.invoice_id WHERE ${localDate('v.created_at')} BETWEEN ? AND ?) AS n`)
      .get(...args, ...args, ...args, ...args);
    if (counts.n + days + 3 > MAX_ROWS) throw new HttpError(400, 'Báo cáo vượt 50.000 dòng. Vui lòng chọn khoảng ngày ngắn hơn.');
    const online = db.prepare(`SELECT *, ${localDate('created_at')} AS day,
      time(created_at, '${REPORT_TIME_SHIFT}') AS clock FROM orders
      WHERE ${localDate('created_at')} BETWEEN ? AND ? ORDER BY created_at, id`).all(...args);
    const retail = db.prepare(`SELECT *, ${localDate('created_at')} AS day,
      time(created_at, '${REPORT_TIME_SHIFT}') AS clock FROM retail_invoices
      WHERE ${localDate('created_at')} BETWEEN ? AND ? ORDER BY created_at, id`).all(...args);
    const onlineItems = db.prepare(`SELECT i.* FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE ${localDate('o.created_at')} BETWEEN ? AND ? ORDER BY o.created_at, o.id, i.id`).all(...args);
    const retailItems = db.prepare(`SELECT i.* FROM retail_invoice_items i JOIN retail_invoices v ON v.id=i.invoice_id
      WHERE ${localDate('v.created_at')} BETWEEN ? AND ? ORDER BY v.created_at, v.id, i.id`).all(...args);
    return { online, retail, onlineItems, retailItems };
  })();

  // ExcelJS chỉ tải khi xuất, không tăng thời gian khởi động API mua hàng.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gạo Kinh Bắc';
  const sheet = (name, columns, money = []) => {
    const result = workbook.addWorksheet(name);
    result.columns = columns.map(([header, width]) => ({ header, width }));
    result.getRow(1).font = { bold: true };
    result.views = [{ state: 'frozen', ySplit: 1 }];
    result.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    for (const column of money) result.getColumn(column).numFmt = '#,##0';
    return result;
  };
  const orders = sheet('Đơn hàng', [
    ['Mã', 15], ['Ngày', 13], ['Giờ', 11], ['Kênh', 12], ['Trạng thái', 19],
    ['Khách', 26], ['SĐT', 16], ['Địa chỉ', 45], ['Khung giờ giao', 28], ['Thanh toán', 28],
    ['Tiền hàng', 17], ['Giảm giá', 16], ['Khách trả', 17], ['Điểm cộng', 14],
  ], [11, 12, 13, 14]);
  const items = sheet('Chi tiết mặt hàng', [
    ['Mã đơn', 15], ['Ngày', 13], ['Kênh', 12], ['Tên gạo', 38], ['Đơn vị', 16],
    ['Số lượng', 13], ['Đơn giá', 17], ['Thành tiền', 17], ['Giá nhập', 17],
    ['Lãi gộp', 17], ['Quà tặng', 13],
  ], [6, 7, 8, 9, 10]);
  const summary = sheet('Tổng hợp theo ngày', [
    ['Ngày', 13], ['Số đơn online', 17], ['Doanh thu online', 22], ['Số hoá đơn quầy', 21],
    ['Doanh thu quầy', 22], ['Tổng giảm giá', 22], ['Tổng doanh thu', 22], ['Lãi gộp', 22],
  ], [2, 3, 4, 5, 6, 7, 8]);
  const byDay = new Map();
  for (let index = 0; index < days; index++) {
    const day = new Date(Date.parse(period.from) + index * DAY_MS).toISOString().slice(0, 10);
    byDay.set(day, { onlineCount: 0, online: 0, retailCount: 0, retail: 0, discount: 0, cost: 0 });
  }
  for (const [list, channel] of [[data.online, 'Online'], [data.retail, 'Tại quầy']]) {
    for (const order of list) {
      const online = channel === 'Online';
      orders.addRow([
        online ? `DH${order.id}` : order.code, order.day, order.clock, channel,
        online ? statusNames[order.status] : 'Hoàn thành',
        (online ? order.receiver_name : order.customer_name) || 'Khách vãng lai',
        String((online ? order.phone : order.customer_phone) || ''),
        online ? order.address : (order.customer_address || ''),
        online ? (slotNames[order.delivery_slot] || '') : '', paymentNames[order.payment_method] || order.payment_method,
        order.subtotal, order.discount, order.total, order.points_earned,
      ]);
      if (online && order.status !== 'completed') continue;
      const day = byDay.get(order.day);
      day[online ? 'onlineCount' : 'retailCount']++;
      day[online ? 'online' : 'retail'] += order.total;
      day.discount += order.discount;
    }
  }
  const onlineById = new Map(data.online.map(o => [o.id, o]));
  const retailById = new Map(data.retail.map(o => [o.id, o]));
  for (const [list, channel, parents, key] of [
    [data.onlineItems, 'Online', onlineById, 'order_id'],
    [data.retailItems, 'Tại quầy', retailById, 'invoice_id'],
  ]) {
    for (const item of list) {
      const order = parents.get(item[key]);
      const amount = item.price * item.quantity;
      const cost = item.cost_price * item.quantity;
      items.addRow([channel === 'Online' ? `DH${order.id}` : order.code, order.day, channel,
        item.product_name, item.unit, item.quantity, item.price, amount, item.cost_price,
        amount - cost, item.is_reward ? 'Có' : 'Không']);
      // Giá vốn chỉ tính cùng các giao dịch được ghi nhận doanh thu, kể cả quà.
      if (channel !== 'Online' || order.status === 'completed') byDay.get(order.day).cost += cost;
    }
  }
  // Lãi dòng hàng là trước giảm giá; lãi theo ngày đã trừ giảm giá như báo cáo doanh thu.
  items.getCell('J1').note = 'Lãi dòng hàng trước giảm giá của cả đơn. Lãi ở bảng tổng hợp đã trừ giảm giá; đơn online chưa hoàn thành và đơn huỷ không tính vào tổng.';
  for (const [day, value] of byDay) {
    summary.addRow([day, value.onlineCount, value.online, value.retailCount, value.retail,
      value.discount, value.online + value.retail, value.online + value.retail - value.cost]);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  if (buffer.byteLength > 4000000) throw new HttpError(400, 'Tệp Excel quá lớn. Vui lòng chọn khoảng ngày ngắn hơn.');
  return buffer;
}
