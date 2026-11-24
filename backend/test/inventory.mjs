// Hai kho: Cửa hàng Nguyễn Cao (KH_NC) và Kho Bồ Sơn (KH_BS) — phiếu nhập, điều chuyển, kiểm kê,
// nhật ký kho, và việc đơn hàng / bán tại quầy trừ đúng kho.
// Cách chạy: node test/inventory.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const short = (value) => JSON.stringify(value).slice(0, 300);

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = `6${String(Date.now() % 1e6).padStart(6, '0')}`;   // chữ số thứ ba luôn là 6 → đầu số di động hợp lệ
  const phone = (p, n) => `${p}${suffix}${n}`;
  const make = async (name, unit, stock, price = 450000) => (await call('/admin/products', {
    method: 'POST', token: owner, body: { name: `${name} ${suffix}`, price, cost_price: 1000, unit, stock },
  })).data.product;
  const staff = async (name, n, permissions) => {
    const p = phone('03', n);
    await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: name, phone: p, password: 'nhanvien26', permissions } });
    return login(p, 'nhanvien26');
  };
  const inv = (path = '', options = {}) => call(`/admin/inventory${path}`, { token: owner, ...options });
  const row = async (id, token = owner) => (await inv('', { token })).data.products.find((p) => p.id === id);
  /** Tổng nhật ký kho của một sản phẩm ở một kho — phải bằng đúng số tồn đang ghi. */
  const ledgerSum = async (productId, warehouse) => {
    const list = (await inv(`/movements?product_id=${productId}&warehouse=${warehouse}&limit=100`)).data;
    return { sum: list.movements.reduce((s, m) => s + m.quantity, 0), last: list.movements[0], list: list.movements };
  };

  const gao = await make('Gạo Bắc Hương kho', 'bao 25kg', 0);
  const tui = await make('Gạo Bóng Đỏ kho', 'túi 5kg', 0);
  const mien = await make('Miến dong kho', 'gói', 0, 30000);
  // Tồn đầu kỳ Nguyễn Cao (cửa hàng bán tại quầy).
  await inv('/count', { method: 'POST', body: { warehouse: 'KH_NC', kind: 'opening', items: [{ product_id: gao.id, counted: 100 }, { product_id: tui.id, counted: 5 }] } });

  /* ---------- Kho bán online là Bồ Sơn (18/11/2026) ---------- */
  const webp = await make('Gạo Tám web', 'túi 5kg', 7);
  let r = await row(webp.id);
  check('Ô tồn kho khi thêm sản phẩm là tồn Bồ Sơn (kho bán online)', r.stock_bs === 7 && r.stock_nc === 0 && r.status.code === 'low', short(r));
  let led = await ledgerSum(webp.id, 'KH_BS');
  check('Thêm sản phẩm có tồn: ghi dòng "Tồn đầu kỳ" ở Bồ Sơn', led.sum === 7 && led.last?.kind === 'opening' && !!led.last?.actor_name, short(led.last));
  check('Khách trên web thấy tồn (tổng hai nơi)', (await call(`/products/${webp.id}`)).data.product.stock === 7);
  // 24/11/2026: web bán theo TỔNG cửa hàng + kho; đơn trừ ở kho của sản phẩm (Bồ Sơn), kho thiếu thì vẫn nhận đơn.
  r = await row(gao.id);
  check('Bồ Sơn hết mà cửa hàng còn: web vẫn thấy tổng (100), bảng tồn nhắc điều chuyển (vàng)', (await call(`/products/${gao.id}`)).data.product.stock === 100
    && r.status.code === 'web_out' && r.status.level === 'yellow', short(r));
  const webOut = await call('/orders/guest', { method: 'POST', body: {
    receiver_name: 'Khách Web', phone: phone('07', 1), address: 'Số 1, đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh',
    payment_method: 'cod', items: [{ product_id: gao.id, quantity: 1 }] } });
  const afterWeb = await row(gao.id);
  check('Kho Bồ Sơn hết vẫn nhận đơn web: trừ ở Bồ Sơn (âm 1), cửa hàng giữ nguyên', webOut.status === 201 && afterWeb.stock_bs === -1 && afterWeb.stock_nc === 100
    && afterWeb.status.code === 'negative', short({ s: webOut.status, r: afterWeb }));
  const warnOrder = (await call('/admin/orders?status=pending&limit=50', { token: owner })).data.orders.find((o) => o.id === webOut.data.order?.id);
  check('Thẻ đơn báo kế toán: Kho Bồ Sơn thiếu 1 bao (25 kg), cửa hàng còn 100 bao (2.500 kg)', warnOrder?.stock_warnings?.length === 1
    && warnOrder.stock_warnings[0].warehouse === 'KH_BS' && warnOrder.stock_warnings[0].short === 1 && warnOrder.stock_warnings[0].short_kg === 25
    && warnOrder.stock_warnings[0].other_warehouse === 'KH_NC' && warnOrder.stock_warnings[0].other_kg === 2500, short(warnOrder?.stock_warnings));
  const overTotal = await call('/admin/orders', { method: 'POST', token: owner, body: {
    receiver_name: 'Khách Web', phone: phone('07', 2), home_delivery: true, address: 'Số 1, đường Ngô Gia Tự, phường Tiền An',
    payment_method: 'cod', warehouse: 'KH_BS', items: [{ product_id: gao.id, quantity: 100 }] } });
  check('Vượt TỔNG hai nơi thì không nhận (400)', overTotal.status === 400 && /chỉ còn 99/.test(overTotal.data.message || ''), short(overTotal.data));
  await call(`/admin/orders/${webOut.data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  check('Huỷ đơn: trả hàng về đúng Bồ Sơn (về 0)', (await row(gao.id)).stock_bs === 0);

  /* ---------- Bắt đầu: tồn Nguyễn Cao ---------- */
  r = await row(gao.id);
  check('Tồn đang có thuộc Cửa hàng Nguyễn Cao, Kho Bồ Sơn bắt đầu từ 0', r.stock_nc === 100 && r.stock_bs === 0 && r.total === 100, short(r));
  led = await ledgerSum(gao.id, 'KH_NC');
  check('Tồn đầu kỳ Nguyễn Cao ghi dòng "Tồn đầu kỳ" vào nhật ký kho', led.sum === 100 && led.last?.kind === 'opening' && !!led.last?.actor_name, short(led.last));
  const first = (await inv()).data;
  check('Có đúng hai kho KH_NC và KH_BS', first.warehouses.map((w) => w.code).join() === 'KH_NC,KH_BS');

  /* ---------- Phiếu nhập ---------- */
  const receipt = await inv('/receipts', { method: 'POST', body: {
    kind: 'cong-gao', source: 'Nhà máy An Giang', vehicle: '99C-123.45', note: 'Công đầu tháng',
    items: [{ product_id: gao.id, quantity_bs: 500, quantity_nc: 20, cost_price: 380000 }, { product_id: tui.id, quantity_bs: 50 }, { product_id: mien.id, quantity_bs: '', quantity_nc: '' }],
  } });
  r = await row(gao.id);
  check('Nhập công gạo chia hai nơi trên một phiếu: Bồ Sơn +500, Nguyễn Cao +20', receipt.status === 201 && /^NK\d{6}$/.test(receipt.data.receipt?.code || '')
    && r.stock_bs === 500 && r.stock_nc === 120 && (await row(tui.id)).stock_bs === 50, short(receipt.data));
  check('Phiếu ghi đủ dòng (dòng không có số lượng bị bỏ qua)', receipt.data.receipt?.items.length === 3 && receipt.data.receipt.vehicle === '99C-123.45');
  led = await ledgerSum(gao.id, 'KH_BS');
  check('Nhật ký kho ghi phiếu nhập: kho, số lượng, tồn sau, mã phiếu, người nhập', led.last?.kind === 'receipt' && led.last.quantity === 500
    && led.last.balance_after === 500 && led.last.ref_code === receipt.data.receipt.code && !!led.last.actor_name && /99C-123\.45/.test(led.last.note || ''), short(led.last));
  check('Khai giá nhập trên phiếu thì cập nhật giá nhập sản phẩm', (await call('/admin/products', { token: owner })).data.products.find((p) => p.id === gao.id)?.cost_price === 380000);
  check('Phiếu không có số lượng nào bị từ chối (400)', (await inv('/receipts', { method: 'POST', body: { kind: 'cua-hang', items: [{ product_id: gao.id, quantity_bs: 0 }] } })).status === 400);
  check('Loại phiếu lạ bị từ chối (400)', (await inv('/receipts', { method: 'POST', body: { kind: 'khac', items: [{ product_id: gao.id, quantity_bs: 1 }] } })).status === 400);
  check('Sản phẩm không tồn tại: từ chối và không lưu dở phiếu', (await inv('/receipts', { method: 'POST', body: { kind: 'cua-hang', items: [{ product_id: gao.id, quantity_nc: 7 }, { product_id: 99999999, quantity_nc: 1 }] } })).status === 400
    && (await row(gao.id)).stock_nc === 120);
  const shopIn = await inv('/receipts', { method: 'POST', body: { kind: 'cua-hang', source: 'NCC miến', items: [{ product_id: mien.id, quantity_nc: 40 }] } });
  check('Nhập hàng cửa hàng: vào thẳng Nguyễn Cao', shopIn.status === 201 && (await row(mien.id)).stock_nc === 40);

  /* ---------- Điều chuyển ---------- */
  check('Chuyển quá số đang có ở kho xuất bị từ chối (400)', (await inv('/transfers', { method: 'POST', body: { from: 'KH_BS', to: 'KH_NC', items: [{ product_id: gao.id, quantity: 501 }] } })).status === 400
    && (await row(gao.id)).stock_bs === 500);
  check('Kho xuất trùng kho nhận bị từ chối (400)', (await inv('/transfers', { method: 'POST', body: { from: 'KH_BS', to: 'KH_BS', items: [{ product_id: gao.id, quantity: 1 }] } })).status === 400);
  const moved = await inv('/transfers', { method: 'POST', body: { from: 'KH_BS', to: 'KH_NC', note: 'Cửa hàng sắp hết', items: [{ product_id: gao.id, quantity: 100 }, { product_id: tui.id, quantity: 30 }] } });
  const transfer = moved.data.transfer;
  r = await row(gao.id);
  check('Tạo lệnh chuyển: kho xuất trừ ngay, kho nhận chưa cộng, hiện "đang chuyển"', moved.status === 201 && /^DC\d{6}$/.test(transfer?.code || '')
    && transfer.status === 'in_transit' && r.stock_bs === 400 && r.stock_nc === 120 && r.moving_to_nc === 100 && moved.data.in_transit === 1, short(r));
  const item = (id) => transfer.items.find((i) => i.product_id === id);
  check('Xác nhận nhận nhiều hơn số đã chuyển bị từ chối (400)', (await inv(`/transfers/${transfer.id}/receive`, { method: 'POST', body: { items: [{ item_id: item(gao.id).id, received: 101 }] } })).status === 400
    && (await row(gao.id)).stock_nc === 120);
  // Hai người bấm xác nhận cùng lúc: chỉ một lần được cộng kho.
  const both = await Promise.all([1, 2].map(() => inv(`/transfers/${transfer.id}/receive`, { method: 'POST', body: { items: [{ item_id: item(gao.id).id, received: 97 }] } })));
  r = await row(gao.id);
  check('Bấm xác nhận hai lần cùng lúc: chỉ cộng kho một lần', both.filter((b) => b.status === 200).length === 1 && both.filter((b) => b.status === 409).length === 1 && r.stock_nc === 217, short(both.map((b) => b.status)));
  const done = both.find((b) => b.status === 200).data;
  check('Nhận thiếu: kho nhận cộng đúng số thực nhận, lệnh ghi lại số thiếu và người nhận', done.transfer.status === 'received' && !!done.transfer.receiver_name
    && done.transfer.items.find((i) => i.product_id === gao.id).received_quantity === 97 && /Thiếu 3/.test(done.message) && r.moving_to_nc === 0 && (await row(tui.id)).stock_nc === 35, short(done.transfer));
  led = await ledgerSum(gao.id, 'KH_NC');
  check('Nhật ký kho ghi "nhận 97/100, thiếu 3"', led.last?.kind === 'transfer_in' && led.last.quantity === 97 && /thiếu 3/.test(led.last.note || ''), short(led.last));
  check('Lệnh đã nhận không huỷ được (409)', (await inv(`/transfers/${transfer.id}/cancel`, { method: 'POST', body: {} })).status === 409);
  const back = (await inv('/transfers', { method: 'POST', body: { from: 'KH_NC', to: 'KH_BS', items: [{ product_id: gao.id, quantity: 17 }] } })).data.transfer;
  const cancelled = await inv(`/transfers/${back.id}/cancel`, { method: 'POST', body: { note: 'Xe hỏng' } });
  r = await row(gao.id);
  check('Huỷ lệnh đang chuyển: hàng trả về kho xuất, đúng một lần', cancelled.status === 200 && r.stock_nc === 217 && r.stock_bs === 400
    && (await inv(`/transfers/${back.id}/cancel`, { method: 'POST', body: {} })).status === 409 && (await row(gao.id)).stock_nc === 217, short(r));
  check('Lệnh đã huỷ không xác nhận nhận được (409)', (await inv(`/transfers/${back.id}/receive`, { method: 'POST', body: {} })).status === 409 && (await row(gao.id)).stock_bs === 400);

  /* ---------- Kiểm kê, tồn đầu kỳ ---------- */
  const counted = await inv('/count', { method: 'POST', body: { warehouse: 'KH_NC', kind: 'count', note: 'Kiểm cuối ngày', items: [{ product_id: gao.id, counted: 215 }, { product_id: mien.id, counted: 40 }] } });
  led = await ledgerSum(gao.id, 'KH_NC');
  check('Kiểm kê: gõ số đếm được, máy ghi chênh lệch (−2), dòng khớp không ghi', counted.status === 200 && counted.data.changed === 1
    && (await row(gao.id)).stock_nc === 215 && led.last.kind === 'count' && led.last.quantity === -2, short(led.last));
  const opening = await inv('/count', { method: 'POST', body: { warehouse: 'KH_BS', kind: 'opening', items: [{ product_id: mien.id, counted: 300 }] } });
  check('Đặt tồn đầu kỳ Kho Bồ Sơn', opening.status === 200 && (await row(mien.id)).stock_bs === 300 && (await ledgerSum(mien.id, 'KH_BS')).last.kind === 'opening');
  check('Số đếm âm bị từ chối (400)', (await inv('/count', { method: 'POST', body: { warehouse: 'KH_NC', items: [{ product_id: gao.id, counted: -1 }] } })).status === 400);

  /* ---------- Đơn hàng trừ đúng kho ---------- */
  const order = (body) => call('/admin/orders', { method: 'POST', token: owner, body: {
    receiver_name: 'Chị Hoa', phone: phone('09', 1), home_delivery: true, address: 'Số 12 đường Nguyễn Trãi, phường Võ Cường', payment_method: 'cod',
    items: [{ product_id: gao.id, quantity: 5 }], ...body,
  } });
  const retail = await order({ warehouse: 'KH_NC' });
  r = await row(gao.id);
  check('Đơn nhân viên chọn Cửa hàng: trừ tồn Nguyễn Cao, không đụng Bồ Sơn', retail.status === 201 && retail.data.order.warehouse === 'KH_NC' && r.stock_nc === 210 && r.stock_bs === 400, short(r));
  led = await ledgerSum(gao.id, 'KH_NC');
  check('Nhật ký kho ghi đơn hàng kèm mã đơn và người tạo', led.last.kind === 'order' && led.last.quantity === -5 && led.last.ref_code === retail.data.order.code && !!led.last.actor_name, short(led.last));
  // Nhân viên tạo đơn khách lẻ cũng chọn được Kho Bồ Sơn (mặc định ở form từ 13/11/2026); huỷ thì trả về đúng kho.
  const retailBs = await order({ phone: phone('09', 2), warehouse: 'KH_BS' });
  const bsAfterRetail = (await row(gao.id)).stock_bs;
  await call(`/admin/orders/${retailBs.data.order?.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  check('Đơn khách lẻ nhân viên tạo xuất được từ Kho Bồ Sơn, huỷ trả về Bồ Sơn', retailBs.status === 201 && retailBs.data.order.warehouse === 'KH_BS'
    && bsAfterRetail === 395 && (await row(gao.id)).stock_bs === 400 && (await row(gao.id)).stock_nc === 210, short(retailBs.data).slice(0, 200));
  check('Kho lạ bị từ chối (400)', (await order({ phone: phone('09', 2), warehouse: 'KH_XX' })).status === 400);
  const ws = (await call('/admin/wholesale', { method: 'POST', token: owner, body: { company: 'Bếp ăn Kho', contact_name: 'Cô Lan', phone: phone('08', 3) } })).data.customer;
  const wsOrder = (body) => order({ phone: phone('08', 3), receiver_name: 'Cô Lan', customer_type: 'wholesale', wholesale_customer_id: ws.id, ...body });
  const sỉ = await wsOrder({ warehouse: 'KH_BS', items: [{ product_id: gao.id, quantity: 40 }] });
  r = await row(gao.id);
  check('Đơn khách buôn xuất từ Kho Bồ Sơn: trừ Bồ Sơn, Nguyễn Cao giữ nguyên', sỉ.status === 201 && sỉ.data.order.warehouse === 'KH_BS' && r.stock_bs === 360 && r.stock_nc === 210, short(r));
  check('Nhật ký kho ghi "Đơn khách buôn" ở Kho Bồ Sơn', (await ledgerSum(gao.id, 'KH_BS')).last.kind === 'order_wholesale');
  // 24/11/2026: kho xuất thiếu nhưng TỔNG hai nơi còn đủ thì vẫn nhận đơn (kho âm, thẻ đơn báo điều chuyển).
  const over = await wsOrder({ warehouse: 'KH_BS', items: [{ product_id: gao.id, quantity: 361 }] });
  check('Kho Bồ Sơn thiếu nhưng tổng còn đủ: vẫn nhận đơn, Bồ Sơn âm 1', over.status === 201 && (await row(gao.id)).stock_bs === -1, short(over.data).slice(0, 200));
  await call(`/admin/orders/${over.data.order?.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  const overAll = await wsOrder({ warehouse: 'KH_BS', items: [{ product_id: gao.id, quantity: 571 }] });
  check('Vượt tổng hai nơi (570): từ chối, không trừ gì', overAll.status === 400 && (await row(gao.id)).stock_bs === 360, short(overAll.data));
  const wsDefault = await wsOrder({ items: [{ product_id: gao.id, quantity: 1 }] });
  r = await row(gao.id);
  check('Đơn nhân viên không chọn kho: xuất từ Bồ Sơn (kho bán online)', wsDefault.status === 201 && wsDefault.data.order.warehouse === 'KH_BS' && r.stock_bs === 359 && r.stock_nc === 210, short(r));
  await call(`/admin/orders/${wsDefault.data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  const web = await call('/orders/guest', { method: 'POST', body: {
    receiver_name: 'Khách Web', phone: phone('07', 2), address: 'Số 1, đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh',
    delivery_slot: 'chieu2', payment_method: 'cod', items: [{ product_id: gao.id, quantity: 2 }] } });
  r = await row(gao.id);
  led = await ledgerSum(gao.id, 'KH_BS');
  check('Đơn khách đặt trên web trừ Kho Bồ Sơn, cửa hàng giữ nguyên', web.status === 201 && r.stock_bs === 358 && r.stock_nc === 210
    && led.last.kind === 'order' && led.last.quantity === -2 && web.data.order?.delivery_slot === 'chieu2', short(web.data).slice(0, 200));
  await call(`/admin/orders/${web.data.order?.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  check('Huỷ đơn web: hoàn về Bồ Sơn', (await row(gao.id)).stock_bs === 360 && (await row(gao.id)).stock_nc === 210);
  const cancel = () => call(`/admin/orders/${sỉ.data.order.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  const c1 = await cancel();
  const c2 = await cancel();
  r = await row(gao.id);
  check('Huỷ đơn khách buôn: hoàn về đúng Kho Bồ Sơn, chỉ một lần', c1.status === 200 && c2.status !== 200 && r.stock_bs === 400 && r.stock_nc === 210, `${c1.status} ${c2.status} ${short(r)}`);
  check('Nhật ký kho ghi "Huỷ đơn, hoàn kho" kèm người huỷ', (await ledgerSum(gao.id, 'KH_BS')).last.kind === 'order_cancel' && !!(await ledgerSum(gao.id, 'KH_BS')).last.actor_name);

  /* ---------- Bán tại quầy trừ tồn Nguyễn Cao ---------- */
  const sale = await call('/retail/invoices', { method: 'POST', token: owner, body: { items: [{ product_id: gao.id, quantity: 9 }] } });
  led = await ledgerSum(gao.id, 'KH_NC');
  check('Bán tại quầy trừ tồn Nguyễn Cao và ghi nhật ký kho kèm mã hoá đơn', sale.status === 201 && (await row(gao.id)).stock_nc === 201 && (await row(gao.id)).stock_bs === 400
    && led.last.kind === 'counter' && led.last.quantity === -9 && led.last.ref_code === sale.data.invoice.code, short(led.last));
  const overSale = await call('/retail/invoices', { method: 'POST', token: owner, body: { items: [{ product_id: tui.id, quantity: 40 }] } });
  r = await row(tui.id);
  check('Quầy vẫn bán được khi số trên máy không đủ: tồn âm, bảng tồn kho báo đỏ', overSale.status === 201 && r.stock_nc === -5 && r.status.code === 'negative', short(r));
  check('Web thấy tổng hai nơi (Bồ Sơn 20 + cửa hàng −5 = 15)', (await call(`/products/${tui.id}`)).data.product.stock === Math.max(Math.floor(r.stock_nc + r.stock_bs), 0) && r.stock_bs === 20);
  const zeroBs = await inv('/count', { method: 'POST', body: { warehouse: 'KH_BS', kind: 'count', items: [{ product_id: webp.id, counted: 0 }] } });
  check('Bồ Sơn về 0: khách trên web thấy hết hàng (0)', zeroBs.status === 200 && (await call(`/products/${webp.id}`)).data.product.stock === 0);

  /* ---------- Sửa tồn ở trang Sản phẩm, nhập kho nhanh, mã sản phẩm ---------- */
  await call(`/admin/products/${gao.id}`, { method: 'PUT', token: owner, body: { stock: 390, price: 455000 } });
  led = await ledgerSum(gao.id, 'KH_BS');
  check('Sửa ô tồn kho ở trang Sản phẩm: sửa tồn Bồ Sơn, ghi nhật ký kho (−10)', (await row(gao.id)).stock_bs === 390 && (await row(gao.id)).stock_nc === 201
    && led.last.kind === 'edit' && led.last.quantity === -10, short(led.last));
  await call(`/admin/products/${gao.id}`, { method: 'PUT', token: owner, body: { price: 456000 } });
  check('Sửa giá không đụng tới tồn và không ghi nhật ký kho', (await row(gao.id)).stock_bs === 390 && (await ledgerSum(gao.id, 'KH_BS')).last.id === led.last.id);
  await call(`/admin/products/${gao.id}/stock`, { method: 'POST', token: owner, body: { quantity: 10 } });
  check('Nút Nhập kho ở trang Sản phẩm: cộng Bồ Sơn, có ghi nhật ký kho', (await row(gao.id)).stock_bs === 400 && (await ledgerSum(gao.id, 'KH_BS')).last.kind === 'receipt');
  const sku = await call(`/admin/products/${gao.id}`, { method: 'PUT', token: owner, body: { sku: 'SP014' } });
  check('Đặt mã sản phẩm SP014, hiện ở bảng tồn kho', sku.status === 200 && (await row(gao.id)).sku === 'SP014');
  check('Mã sản phẩm trùng bị từ chối (400)', (await call(`/admin/products/${tui.id}`, { method: 'PUT', token: owner, body: { sku: 'sp014' } })).status === 400);

  /* ---------- Sổ khớp: tồn = tổng nhật ký kho ---------- */
  for (const [name, p] of [['bao 25kg', gao], ['túi 5kg', tui], ['miến', mien]]) {
    const now = await row(p.id);
    const nc = await ledgerSum(p.id, 'KH_NC');
    const bs = await ledgerSum(p.id, 'KH_BS');
    check(`Tồn = tổng nhật ký kho (${name}): Nguyễn Cao ${now.stock_nc}, Bồ Sơn ${now.stock_bs}`, nc.sum === now.stock_nc && bs.sum === now.stock_bs
      && (nc.last?.balance_after ?? 0) === now.stock_nc && (bs.last?.balance_after ?? 0) === now.stock_bs, `${nc.sum}/${now.stock_nc} ${bs.sum}/${now.stock_bs}`);
  }
  const all = (await inv()).data;
  const mine = all.products.filter((p) => [gao.id, tui.id, mien.id].includes(p.id));
  check('Tổng theo kho tính ra kg cho gạo, hàng không có khối lượng đếm theo đơn vị', all.totals.KH_BS.kg >= 400 * 25 + 20 * 5 && all.totals.KH_BS.other_units >= 300
    && all.totals.all.units === all.totals.KH_NC.units + all.totals.KH_BS.units && mine.every((p) => p.total === p.stock_nc + p.stock_bs), short(all.totals));
  const onlyTransfers = (await inv(`/movements?product_id=${gao.id}&group=transfer`)).data.movements;
  check('Lọc nhật ký kho theo nhóm Điều chuyển', onlyTransfers.length === 4 && onlyTransfers.every((m) => m.kind.startsWith('transfer_')), short(onlyTransfers.map((m) => m.kind)));

  /* ---------- Số lẻ: nhập theo kg (đổi ra bao), chuyển, kiểm kê (18/11/2026) ---------- */
  const bulk = await make('Gạo Bắc Hương bao to', 'bao 10kg', 0);
  const kgIn = await inv('/receipts', { method: 'POST', body: { kind: 'cong-gao', items: [{ product_id: bulk.id, quantity_bs: '58,2' }] } });
  r = await row(bulk.id);
  check('Nhập 582 kg (gửi 58,2 bao): Bồ Sơn có 58,2 bao = 582 kg', kgIn.status === 201 && r.stock_bs === 58.2 && Math.round(r.stock_bs * r.weight_kg) === 582, short(r));
  const partial = await inv('/transfers', { method: 'POST', body: { from: 'KH_BS', to: 'KH_NC', items: [{ product_id: bulk.id, quantity: 12.5 }] } });
  await inv(`/transfers/${partial.data.transfer.id}/receive`, { method: 'POST', body: {} });
  r = await row(bulk.id);
  check('Chuyển 12,5 bao: Bồ Sơn còn 45,7, Nguyễn Cao 12,5 (không lệch số lẻ)', r.stock_bs === 45.7 && r.stock_nc === 12.5, short(r));
  check('Khách trên web thấy số nguyên của tổng hai nơi (45,7 + 12,5 = 58 bao)', (await call(`/products/${bulk.id}`)).data.product.stock === 58);
  const sellBulk = await call('/admin/orders', { method: 'POST', token: owner, body: { receiver_name: 'Chị Hoa', phone: phone('09', 7), home_delivery: true, address: 'Số 12 đường Nguyễn Trãi, phường Võ Cường', payment_method: 'cod', warehouse: 'KH_NC', items: [{ product_id: bulk.id, quantity: 12 }] } });
  r = await row(bulk.id);
  check('Bán 12 bao từ 12,5: còn 0,5 bao (5 kg)', sellBulk.status === 201 && r.stock_nc === 0.5, short(r));
  const over13 = await call('/admin/orders', { method: 'POST', token: owner, body: { receiver_name: 'Chị Hoa', phone: phone('09', 8), home_delivery: true, address: 'Số 12 đường Nguyễn Trãi, phường Võ Cường', payment_method: 'cod', warehouse: 'KH_NC', items: [{ product_id: bulk.id, quantity: 1 }] } });
  check('Cửa hàng còn 0,5 bao, kho còn 45,7: vẫn bán 1 bao từ cửa hàng (âm 0,5), huỷ thì trả lại', over13.status === 201 && (await row(bulk.id)).stock_nc === -0.5, short(over13.data).slice(0, 200));
  await call(`/admin/orders/${over13.data.order?.id}/status`, { method: 'PATCH', token: owner, body: { status: 'cancelled' } });
  check('Huỷ: cửa hàng về 0,5 bao', (await row(bulk.id)).stock_nc === 0.5);
  const countDec = await inv('/count', { method: 'POST', body: { warehouse: 'KH_BS', kind: 'count', items: [{ product_id: bulk.id, counted: '45,25' }] } });
  check('Kiểm kê số lẻ 45,25: chênh lệch −0,45 ghi đúng', countDec.status === 200 && (await row(bulk.id)).stock_bs === 45.25 && (await ledgerSum(bulk.id, 'KH_BS')).last.quantity === -0.45, short((await ledgerSum(bulk.id, 'KH_BS')).last));
  const bulkNc = await ledgerSum(bulk.id, 'KH_NC');
  const bulkBs = await ledgerSum(bulk.id, 'KH_BS');
  check('Số lẻ vẫn khớp sổ: tồn = tổng nhật ký kho', Math.abs(bulkNc.sum - 0.5) < 1e-9 && Math.abs(bulkBs.sum - 45.25) < 1e-9, `${bulkNc.sum} ${bulkBs.sum}`);
  check('Số âm / chữ bị từ chối (400)', (await inv('/receipts', { method: 'POST', body: { kind: 'cong-gao', items: [{ product_id: bulk.id, quantity_bs: '-1' }] } })).status === 400
    && (await inv('/transfers', { method: 'POST', body: { from: 'KH_BS', to: 'KH_NC', items: [{ product_id: bulk.id, quantity: 'abc' }] } })).status === 400);

  /* ---------- Phân quyền (kiểm tra ở máy chủ) ---------- */
  const viewer = await staff('Em Xem Kho', 1, ['inventory.view']);
  const keeper = await staff('Em Thủ Kho', 2, ['inventory.receive', 'inventory.transfer']);
  const sales = await staff('Em Bán Hàng', 3, ['orders.view', 'orders.create']);
  const shipper = await staff('Anh Giao', 4, ['delivery']);
  check('Quyền xem kho: xem được bảng tồn và nhật ký', (await inv('', { token: viewer })).status === 200 && (await inv('/movements', { token: viewer })).status === 200);
  check('Quyền xem kho: không nhập, không chuyển, không kiểm kê (403)', (await inv('/receipts', { method: 'POST', token: viewer, body: { kind: 'cua-hang', items: [{ product_id: gao.id, quantity_nc: 1 }] } })).status === 403
    && (await inv('/transfers', { method: 'POST', token: viewer, body: { from: 'KH_BS', to: 'KH_NC', items: [{ product_id: gao.id, quantity: 1 }] } })).status === 403
    && (await inv('/count', { method: 'POST', token: viewer, body: { warehouse: 'KH_NC', items: [{ product_id: gao.id, counted: 1 }] } })).status === 403
    && (await row(gao.id)).stock_nc === 201);
  const keeperIn = await inv('/receipts', { method: 'POST', token: keeper, body: { kind: 'cua-hang', items: [{ product_id: gao.id, quantity_nc: 3 }] } });
  check('Thủ kho nhập được hàng; tên thủ kho nằm trong nhật ký', keeperIn.status === 201 && (await ledgerSum(gao.id, 'KH_NC')).last.actor_name === 'Em Thủ Kho');
  check('Thủ kho không được ghi giá nhập (403), không kiểm kê (403)', (await inv('/receipts', { method: 'POST', token: keeper, body: { kind: 'cua-hang', items: [{ product_id: gao.id, quantity_nc: 3, cost_price: 1 }] } })).status === 403
    && (await inv('/count', { method: 'POST', token: keeper, body: { warehouse: 'KH_NC', items: [{ product_id: gao.id, counted: 1 }] } })).status === 403);
  const seen = (await inv('/receipts', { token: keeper })).data.receipts;
  check('Người không quản lý sản phẩm không thấy giá nhập trên phiếu', seen.length > 0 && seen.every((x) => x.items.every((i) => !('cost_price' in i)))
    && (await inv('/receipts')).data.receipts.some((x) => x.items.some((i) => i.cost_price === 380000)));
  check('Nhân viên bán hàng: chỉ xem tồn để chọn kho khi tạo đơn, không vào trang kho (403)', (await inv('/stock', { token: sales })).status === 200 && (await inv('', { token: sales })).status === 403
    && (await inv('/movements', { token: sales })).status === 403);
  check('Nhân viên giao hàng không xem được kho (403)', (await inv('', { token: shipper })).status === 403 && (await inv('/stock', { token: shipper })).status === 403);
  check('Chưa đăng nhập không xem được kho (401)', (await call('/admin/inventory')).status === 401);

  /* ---------- Thêm mặt hàng mới ngay trong phiếu nhập (24/11/2026) ---------- */
  const fresh = await inv('/products', { method: 'POST', token: keeper, body: { name: `Gạo Nếp Cái Hoa Vàng ${suffix}`, unit: 'bao 25kg', weight_kg: 25, category: 'gao' } });
  const freshRow = fresh.data.products?.find((p) => p.id === fresh.data.product_id);
  check('Thủ kho thêm được mặt hàng mới (chưa có trên web): đang ẩn, có trong bảng tồn', fresh.status === 201 && freshRow?.is_active === 0 && freshRow.weight_kg === 25 && freshRow.total === 0,
    JSON.stringify(freshRow));
  check('Mặt hàng mới không hiện trên web', !(await call('/products')).data.products.some((p) => p.id === fresh.data.product_id));
  const freshIn = await inv('/receipts', { method: 'POST', token: keeper, body: { kind: 'cong-gao', items: [{ product_id: fresh.data.product_id, quantity_bs: 4 }] } });
  check('Nhập kho ngay mặt hàng vừa thêm', freshIn.status === 201 && (await row(fresh.data.product_id)).stock_bs === 4);
  check('Trùng tên + quy cách thì báo đã có (409)', (await inv('/products', { method: 'POST', token: keeper, body: { name: `Gạo Nếp Cái Hoa Vàng ${suffix}`, unit: 'bao 25kg' } })).status === 409);
  check('Thiếu tên / quy cách (400)', (await inv('/products', { method: 'POST', token: keeper, body: { name: 'G', unit: 'bao' } })).status === 400);
  check('Người chỉ được xem kho / bán hàng không thêm được mặt hàng (403)', (await inv('/products', { method: 'POST', token: viewer, body: { name: 'Gạo Lạ', unit: 'bao 10kg' } })).status === 403
    && (await inv('/products', { method: 'POST', token: sales, body: { name: 'Gạo Lạ', unit: 'bao 10kg' } })).status === 403);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
