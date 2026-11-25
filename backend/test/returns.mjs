// Trả / đổi hàng đơn online đã giao, kho bán online của từng sản phẩm, thứ tự bảng tồn kho (19/11/2026).
// Cách chạy: node test/returns.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const short = (value) => String(JSON.stringify(value)).slice(0, 300);

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = `6${String(Date.now() % 1e6).padStart(6, '0')}`;   // chữ số thứ ba luôn là 6 → đầu số di động hợp lệ
  const phone = (p, n) => `${p}${suffix}${n}`;
  const make = async (name, stock, price = 100000) => (await call('/admin/products', {
    method: 'POST', token: owner, body: { name: `${name} ${suffix}`, price, cost_price: 70000, unit: 'túi 5kg', stock },
  })).data.product;
  const inv = (path = '', options = {}) => call(`/admin/inventory${path}`, { token: owner, ...options });
  const row = async (id) => (await inv()).data.products.find((p) => p.id === id);
  const pub = async (id) => (await call(`/products/${id}`)).data.product;
  const staff = async (name, n, permissions) => {
    const p = phone('03', n);
    await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: p, password: 'nhanvien26', permissions } });
    return login(p, 'nhanvien26');
  };
  const guestOrder = (items, n, extra = {}) => call('/orders/guest', { method: 'POST', body: {
    receiver_name: `Khách Trả ${n}`, phone: phone('09', n), address: 'Số 1, đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh',
    payment_method: 'cod', items, ...extra } });
  const complete = async (id) => { for (const status of ['confirmed', 'shipping', 'completed']) await call(`/admin/orders/${id}/status`, { method: 'PATCH', token: owner, body: { status } }); };
  const adminOrder = async (id) => (await call('/admin/orders?limit=300', { token: owner })).data.orders.find((o) => o.id === id);

  /* ---------- Đơn web luôn trừ Kho Bồ Sơn; kho hết → lệnh lấy hàng ở Cửa hàng Nguyễn Cao (25/11/2026) ---------- */
  const a = await make('Gạo bán ở cửa hàng', 0);
  const b = await make('Gạo bán ở kho', 50);
  await inv('/count', { method: 'POST', body: { warehouse: 'KH_NC', kind: 'opening', items: [{ product_id: a.id, counted: 30 }, { product_id: b.id, counted: 5 }] } });
  let r = await row(a.id);
  check('Bồ Sơn hết, cửa hàng còn 30: web vẫn thấy tổng 30, cảnh báo theo tổng (đủ hàng)', (await pub(a.id)).stock === 30 && r.status.code === 'ok', short(r));
  const viewer = await staff('Em Xem Kho', 1, ['inventory.view']);
  const seller = await staff('Em Bán Quầy', 2, ['retail.sell']);
  const accountant = await staff('Chị Kế Toán', 3, ['orders.view', 'orders.manage']);

  const mixed = await guestOrder([{ product_id: a.id, quantity: 2 }, { product_id: b.id, quantity: 3 }], 1);
  const ra = await row(a.id); const rb = await row(b.id);
  check('Đơn web luôn trừ Kho Bồ Sơn (kể cả món kho đã hết: âm 2), cửa hàng giữ nguyên', mixed.status === 201 && ra.stock_bs === -2 && ra.stock_nc === 30
    && rb.stock_bs === 47 && rb.stock_nc === 5, short({ s: mixed.status, m: mixed.data.message, ra, rb }));
  let o = await adminOrder(mixed.data.order?.id);
  check('Từng dòng của đơn web ghi kho Bồ Sơn', o?.warehouse === 'KH_BS' && o.items.every((i) => i.warehouse === 'KH_BS'), short(o?.items));
  check('Thẻ đơn báo đúng món thiếu: thiếu 2 túi (10 kg), cửa hàng còn 150 kg; món đủ hàng không báo', o?.stock_warnings?.length === 1
    && o.stock_warnings[0].product_name === a.name && o.stock_warnings[0].short === 2 && o.stock_warnings[0].short_kg === 10 && o.stock_warnings[0].other_kg === 150, short(o?.stock_warnings));

  const pickup = (token, body) => call('/admin/inventory/pickups', { method: 'POST', token, body });
  check('Chỉ xem kho / bán quầy không tạo được lệnh lấy hàng (403)', (await pickup(viewer, { order_id: o.id, items: [{ product_id: a.id, quantity: 2 }] })).status === 403
    && (await pickup(seller, { order_id: o.id, items: [{ product_id: a.id, quantity: 2 }] })).status === 403);
  check('Lấy quá số trong đơn / món không có trong đơn bị từ chối (400)', (await pickup(accountant, { order_id: o.id, items: [{ product_id: a.id, quantity: 3 }] })).status === 400
    && (await pickup(accountant, { order_id: o.id, items: [{ product_id: 999999, quantity: 1 }] })).status === 400);
  const created = await pickup(accountant, { order_id: o.id, items: [{ product_id: a.id, quantity: 2 }], note: 'Anh Diệu qua lấy' });
  check('Kế toán gửi lệnh lấy hàng ở cửa hàng (LH…): chưa trừ kho nào', created.status === 201 && /^LH\d{6}$/.test(created.data.pickup?.code || '')
    && (await row(a.id)).stock_nc === 30 && (await row(a.id)).stock_bs === -2, short(created.data));
  check('Lệnh đã đủ số trong đơn thì không gửi thêm (400)', (await pickup(accountant, { order_id: o.id, items: [{ product_id: a.id, quantity: 1 }] })).status === 400);
  o = await adminOrder(o.id);
  check('Thẻ đơn hiện lệnh đang chờ cửa hàng nhận', o.pickups?.[0]?.status === 'requested' && o.pickups[0].items[0].quantity === 2);
  const inbox = (await call('/admin/inventory/pickups', { token: seller })).data.pickups;
  check('Nhân viên bán tại quầy thấy lệnh đang chờ (kèm mã đơn, món, ghi chú)', inbox?.some((x) => x.id === created.data.pickup.id && x.order_code === o.code && x.note === 'Anh Diệu qua lấy'), short(inbox));
  const accepted = await call(`/admin/inventory/pickups/${created.data.pickup.id}/accept`, { method: 'POST', token: seller, body: {} });
  {
    const x = await row(a.id);
    check('Cửa hàng nhận lệnh: Nguyễn Cao trừ 2 (28), Kho Bồ Sơn được bù về 0', accepted.status === 200 && x.stock_nc === 28 && x.stock_bs === 0, short({ s: accepted.status, x }));
  }
  check('Nhận lệnh hai lần bị chặn (409)', (await call(`/admin/inventory/pickups/${created.data.pickup.id}/accept`, { method: 'POST', token: seller, body: {} })).status === 409);
  o = await adminOrder(o.id);
  check('Thẻ đơn hết cảnh báo, lệnh ghi "đã nhận" kèm người nhận', !o.stock_warnings?.length && o.pickups[0].status === 'accepted' && !!o.pickups[0].handler_name, short(o.pickups));
  const ledger = (await inv(`/movements?product_id=${a.id}&group=transfer`)).data.movements;
  check('Nhật ký kho ghi xuất ở cửa hàng và bù ở Bồ Sơn kèm mã lệnh', ledger.some((m) => m.kind === 'pickup_out' && m.warehouse === 'KH_NC' && m.quantity === -2 && m.ref_code === created.data.pickup.code)
    && ledger.some((m) => m.kind === 'pickup_cover' && m.warehouse === 'KH_BS' && m.quantity === 2), short(ledger));
  // Từ chối: không đổi kho
  const second = await guestOrder([{ product_id: a.id, quantity: 1 }], 2);
  const req2 = await pickup(accountant, { order_id: second.data.order.id, items: [{ product_id: a.id, quantity: 1 }] });
  const rejected = await call(`/admin/inventory/pickups/${req2.data.pickup.id}/reject`, { method: 'POST', token: seller, body: { note: 'Cửa hàng cũng hết' } });
  check('Cửa hàng từ chối lệnh: không đổi kho, ghi lý do', rejected.status === 200 && rejected.data.pickup.status === 'rejected' && rejected.data.pickup.handle_note === 'Cửa hàng cũng hết'
    && (await row(a.id)).stock_nc === 28 && (await row(a.id)).stock_bs === -1);
  await call(`/admin/orders/${second.data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  await call(`/admin/orders/${mixed.data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  check('Huỷ đơn: hàng trả về Kho Bồ Sơn', (await row(b.id)).stock_bs === 50 && (await row(a.id)).stock_bs === 2);
  const over = await guestOrder([{ product_id: a.id, quantity: 31 }], 3);
  check('Vượt tổng hai nơi (30): đơn web bị từ chối', over.status === 400, short(over.data));

  /* ---------- Thứ tự bảng tồn kho ---------- */
  const before = (await inv()).data.products.map((p) => p.id);
  const webBefore = (await call('/products')).data.products.map((p) => p.id);
  const wanted = [b.id, a.id, ...before.filter((id) => id !== a.id && id !== b.id)];
  const sorted = await inv('/order', { method: 'PUT', body: { ids: wanted } });
  check('Kéo thả thứ tự bảng tồn: lưu đúng thứ tự mới', sorted.status === 200 && JSON.stringify(sorted.data.products.map((p) => p.id)) === JSON.stringify(wanted));
  check('Thứ tự trên web không đổi', JSON.stringify((await call('/products')).data.products.map((p) => p.id)) === JSON.stringify(webBefore));
  check('Quyền xem kho không xếp thứ tự được (403)', (await call('/admin/inventory/order', { method: 'PUT', token: viewer, body: { ids: wanted } })).status === 403);

  /* ---------- Trả / đổi hàng đơn đã giao ---------- */
  const sale = await guestOrder([{ product_id: b.id, quantity: 4 }], 4);
  const saleId = sale.data.order.id;
  const early = await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner, body: { return_type: 'return', reason: 'Khách đổi ý', items: [{ order_item_id: 1, quantity: 1 }] } });
  check('Đơn chưa giao xong không trả hàng được (400)', early.status === 400, short(early.data));
  await complete(saleId);
  o = await adminOrder(saleId);
  const item = o.items[0];
  const stockBefore = (await row(b.id)).stock_bs;
  const closingBefore = (await call('/admin/closing?location=KH_BS', { token: owner })).data.figures.totals;
  const revBefore = (await call('/admin/revenue', { token: owner })).data;
  const sales = await staff('Em Bán Hàng', 2, ['orders.view', 'orders.create']);
  check('Nhân viên chỉ xem đơn không trả hàng được (403)', (await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: sales,
    body: { return_type: 'return', reason: 'Khách đổi ý', items: [{ order_item_id: item.id, quantity: 1 }] } })).status === 403);
  check('Thiếu lý do (400)', (await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner,
    body: { return_type: 'return', reason: '', items: [{ order_item_id: item.id, quantity: 1 }] } })).status === 400);
  check('Trả nhiều hơn đã mua (400)', (await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner,
    body: { return_type: 'return', reason: 'Khách đổi ý', items: [{ order_item_id: item.id, quantity: 5 }] } })).status === 400);
  const ret = await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner,
    body: { return_type: 'return', reason: 'Gạo bị ẩm', refund_method: 'cash', items: [{ order_item_id: item.id, quantity: 1 }] } });
  check('Trả 1 túi, hoàn tiền mặt: mã phiếu TD, tiền hoàn = giá 1 túi', ret.status === 201 && /^TD\d{6}$/.test(ret.data.return?.code || '')
    && ret.data.return.refund_amount === item.price && ret.data.return.restock === true, short(ret.data));
  r = await row(b.id);
  const led = (await inv(`/movements?product_id=${b.id}&warehouse=KH_BS&limit=5`)).data.movements[0];
  check('Nhập lại kho đã xuất (Bồ Sơn) +1, nhật ký ghi "Khách trả hàng"', r.stock_bs === stockBefore + 1 && led.kind === 'order_return' && led.quantity === 1
    && led.ref_code === ret.data.return.code, short(led));
  o = await adminOrder(saleId);
  check('Thẻ đơn có phiếu trả và số đã trả của từng món', o.returns?.length === 1 && o.returns[0].code === ret.data.return.code && o.items[0].returned === 1);
  const closingAfter = (await call('/admin/closing?location=KH_BS', { token: owner })).data;
  check('Đóng ngày (kho): tiền mặt và doanh thu giảm đúng tiền hoàn, có dòng chi "Trả hàng đơn …"', closingAfter.figures.totals.cash === closingBefore.cash - item.price
    && closingAfter.figures.totals.revenue === closingBefore.revenue - item.price && closingAfter.figures.details.cash_out.some((x) => x.code === ret.data.return.code),
    short(closingAfter.figures.details.cash_out));
  const revAfter = (await call('/admin/revenue', { token: owner })).data;
  check('Doanh thu trừ tiền hoàn', revAfter.refunds === revBefore.refunds + item.price && revAfter.total.revenue === revBefore.total.revenue - item.price, short({ a: revAfter.refunds, b: revBefore.refunds }));
  const tooMuch = await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner,
    body: { return_type: 'return', reason: 'Khách đổi ý', refund_method: 'transfer', refund_amount: o.total, items: [{ order_item_id: item.id, quantity: 1 }] } });
  check('Tổng tiền hoàn vượt tiền khách đã trả (400)', tooMuch.status === 400 && !!tooMuch.data.errors?.refund_amount, short(tooMuch.data));
  const stockMid = (await row(b.id)).stock_bs;
  const swap = await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner,
    body: { return_type: 'exchange', reason: 'Đổi bao bị rách', restock: false, items: [{ order_item_id: item.id, quantity: 1 }] } });
  check('Đổi hàng cùng loại, không nhập lại kho: không hoàn tiền, tồn giữ nguyên', swap.status === 201 && swap.data.return.refund_amount === 0
    && swap.data.return.refund_method === 'none' && (await row(b.id)).stock_bs === stockMid, short(swap.data));
  const toStore = await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner,
    body: { return_type: 'return', reason: 'Khách trả bớt', refund_method: 'transfer', warehouse: 'KH_NC', items: [{ order_item_id: item.id, quantity: 2 }] } });
  check('Trả nốt 2 túi, hoàn chuyển khoản, nhập về cửa hàng', toStore.status === 201 && (await row(b.id)).stock_nc === 7, short(toStore.data));
  check('Đã trả / đổi hết 4 túi: không trả thêm được (400)', (await call(`/admin/orders/${saleId}/returns`, { method: 'POST', token: owner,
    body: { return_type: 'return', reason: 'Khách đổi ý', items: [{ order_item_id: item.id, quantity: 1 }] } })).status === 400);
  const transferRows = (await call('/admin/closing?location=KH_BS', { token: owner })).data.figures.details.transfers;
  check('Đóng ngày: hoàn chuyển khoản trừ ở bảng chuyển khoản', transferRows.some((x) => x.code === toStore.data.return.code && x.amount < 0), short(transferRows));
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
