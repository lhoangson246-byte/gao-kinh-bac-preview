// Đơn nhân viên nhập tay, xem đơn theo ngày, xuất Excel đơn đã hoàn thành.
// Cách chạy: node test/manual-orders.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng, ghim ngày 10/11/2026.
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture({ PROMO_TODAY: '2026-11-10' });
const { call } = app;
try {
  const owner = (await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } })).data.token;
  const suffix = String(Date.now() % 1e7).padStart(7, '0');
  let n = 0;
  const phone = (p) => `${p}${suffix}${n++ % 10}`;
  const mk = async (perms, title) => {
    const ph = phone('08');
    await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: title, phone: ph, password: 'nhanvien26', permissions: perms } });
    return (await call('/auth/login', { method: 'POST', body: { identifier: ph, password: 'nhanvien26' } })).data.token;
  };
  const sales = await mk(['orders.view', 'orders.manage', 'orders.create'], 'Em Bán Hàng');
  const accountant = await mk(['orders.view', 'orders.export', 'revenue.view'], 'Chị Kế Toán');
  const shipper = await mk(['delivery'], 'Anh Giao');
  const shipperId = (await call('/admin/shippers', { token: sales })).data.shippers[0].id;
  const product = (await call('/admin/products', { method: 'POST', token: owner, body: { name: `Gạo đơn tay ${suffix}`, price: 120000, cost_price: 90000, unit: 'túi 5kg', stock: 40 } })).data.product;
  const create = (token, body) => call('/admin/orders', { method: 'POST', token, body: {
    receiver_name: 'Bác Hùng', phone: customerPhone, home_delivery: true, address: 'Số 15 đường Trần Hưng Đạo, phường Đại Phúc',
    payment_method: 'cod', items: [{ product_id: product.id, quantity: 2 }], ...body,
  } });
  const customerPhone = phone('09');

  /* Tạo đơn bằng tay */
  const first = await create(sales, { delivery_slot: 'chieu', note: 'Khách gọi điện', shipper_id: shipperId });
  const o1 = first.data.order;
  check('Nhân viên tạo đơn giao tận nơi (201)', first.status === 201, JSON.stringify(first.data).slice(0, 200));
  check('Đơn tay: đã xác nhận ngay, ghi nguồn "nhân viên", người tạo, giao tận nơi', o1?.status === 'confirmed' && o1.source === 'staff'
    && o1.fulfillment === 'delivery' && !!o1.created_by && !!o1.confirmed_at && /Bắc Ninh/.test(o1.address), JSON.stringify(o1 && { s: o1.status, src: o1.source }));
  check('Giá và tổng tiền do máy chủ tính; đơn đầu của số này được giảm 20.000đ', o1?.subtotal === 240000 && o1.discount === 20000 && o1.total === 220000);
  check('Đơn tay giao luôn cho nhân viên giao hàng', o1?.shipper_name === 'Anh Giao');
  check('Nhân viên giao hàng thấy đơn ngay', (await call('/delivery/orders', { token: shipper })).data.orders.some((o) => o.id === o1.id));
  check('Trừ tồn kho như đơn online', (await call('/admin/products', { token: owner })).data.products.find((p) => p.id === product.id).stock === 38);
  const pickup = (await create(sales, { home_delivery: false, address: '', discount_code: 'GAOKINHBAC11', items: [{ product_id: product.id, quantity: 1 }] })).data.order;
  check('Khách lấy tại cửa hàng: không cần địa chỉ', pickup?.fulfillment === 'pickup' && pickup.address === 'Khách lấy tại cửa hàng');
  check('Đơn tay thứ hai cùng số dùng được mã GAOKINHBAC11', pickup?.discount_code === 'GAOKINHBAC11' && pickup.total === 110000);

  /* Kiểm tra dữ liệu */
  const err = async (body) => (await create(sales, body)).data.errors || {};
  check('Thiếu số điện thoại: báo lỗi', !!(await err({ phone: '123' })).phone);
  check('Giao tận nơi mà thiếu địa chỉ: báo lỗi', !!(await err({ address: '' })).address);
  check('Địa chỉ ngoài Bắc Ninh: báo lỗi', /Bắc Ninh/.test((await err({ address: 'Số 1 phố Huế, Hà Nội' })).address || ''));
  check('Người giao không phải nhân viên giao hàng: báo lỗi', !!(await err({ shipper_id: 1 })).shipper_id);
  check('Không gửi được giá tự đặt (400)', (await create(sales, { items: [{ product_id: product.id, quantity: 1, price: 1000 }] })).status === 400);
  check('Kế toán không tạo được đơn (403)', (await create(accountant, {})).status === 403);
  check('Giao hàng không tạo được đơn (403)', (await create(shipper, {})).status === 403);

  /* Xem đơn theo ngày */
  const today = (await call('/admin/orders?status=confirmed', { token: owner })).data.orders[0].created_at.slice(0, 10);
  const vnToday = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const byDay = (await call(`/admin/orders?from=${vnToday}&to=${vnToday}&limit=300`, { token: accountant })).data;
  check('Lọc đơn theo ngày hôm nay', byDay.orders.some((o) => o.id === o1.id) && byDay.counts.all === byDay.orders.length, `${today} ${byDay.counts.all}/${byDay.orders.length}`);
  const past = (await call('/admin/orders?from=2020-01-01&to=2020-01-02', { token: owner })).data;
  check('Ngày không có đơn: danh sách và số đếm đều 0', past.orders.length === 0 && past.counts.all === 0);
  check('"Từ ngày" sau "đến ngày" bị từ chối (400)', (await call('/admin/orders?from=2026-11-10&to=2026-11-01', { token: owner })).status === 400);
  check('Ngày sai định dạng bị từ chối (400)', (await call('/admin/orders?from=10-11-2026', { token: owner })).status === 400);

  /* Hoàn thành rồi xuất Excel đơn đã hoàn thành */
  await call(`/delivery/orders/${o1.id}/status`, { method: 'PATCH', token: shipper, body: { status: 'shipping' } });
  const proof = await (await fetch(`${app.base}/api/proofs`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${shipper}` },
    body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('anh-giao-don-tay'.padEnd(40, 'x'))]) })).json();
  await call(`/delivery/orders/${o1.id}/status`, { method: 'PATCH', token: shipper, body: { status: 'completed', photo: proof.id } });
  const exported = await fetch(`${app.base}/api/admin/export/orders?period=range&from=${vnToday}&to=${vnToday}&status=completed`, { headers: { Authorization: `Bearer ${accountant}` } });
  check('Kế toán xuất Excel đơn đã hoàn thành theo ngày', exported.status === 200
    && /spreadsheetml/.test(exported.headers.get('content-type') || '') && /completed/.test(exported.headers.get('content-disposition') || ''));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
  const sheet = workbook.getWorksheet('Đơn hàng');
  const header = sheet.getRow(1).values.slice(1);
  const rows = [];
  sheet.eachRow((row, i) => { if (i > 1) rows.push(Object.fromEntries(header.map((h, j) => [h, row.values[j + 1]]))); });
  check('Excel chỉ có đơn đã hoàn thành, không lẫn hoá đơn quầy', rows.length >= 1 && rows.every((r) => r['Trạng thái'] === 'Hoàn thành' && r['Kênh'] !== 'Tại quầy'),
    JSON.stringify(rows.map((r) => r['Trạng thái'])));
  const row = rows.find((r) => r['Mã'] === o1.code);
  check('Excel có nguồn đơn, cách nhận, người giao, giờ giao xong', /Nhân viên tạo \(Em Bán Hàng\)/.test(row?.['Nguồn đơn'] || '')
    && row['Cách nhận'] === 'Giao tận nơi' && row['Người giao'] === 'Anh Giao' && !!row['Giao xong lúc'], JSON.stringify(row));
  const pickupRow = (await (async () => {
    const all = await fetch(`${app.base}/api/admin/export/orders?period=range&from=${vnToday}&to=${vnToday}`, { headers: { Authorization: `Bearer ${owner}` } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await all.arrayBuffer()));
    const sh = wb.getWorksheet('Đơn hàng');
    const head = sh.getRow(1).values.slice(1);
    let found = null;
    sh.eachRow((r, i) => { if (i > 1 && r.values[1] === pickup.code) found = Object.fromEntries(head.map((h, j) => [h, r.values[j + 1]])); });
    return found;
  })());
  check('Xuất Excel không lọc trạng thái: có mọi đơn, ghi mã giảm giá', pickupRow?.['Mã giảm giá'] === 'GAOKINHBAC11' && pickupRow['Cách nhận'] === 'Lấy tại cửa hàng');
  check('Giao hàng không xuất được Excel (403)', (await call('/admin/export/orders', { token: shipper })).status === 403);
} finally {
  await app.close();
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
assert.equal(failed, 0);
