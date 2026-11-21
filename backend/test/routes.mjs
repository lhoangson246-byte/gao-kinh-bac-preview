// Gom đơn và lộ trình giao từ Kho Bồ Sơn (20/11/2026).
// Cách chạy: node test/routes.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng, không gọi ra mạng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const short = (value) => String(JSON.stringify(value)).slice(0, 400);

const KHO = { lat: 21.1639226, lng: 106.0529077 };
const rad = (d) => (d * Math.PI) / 180;
const hv = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};
const tour = (pts) => pts.reduce((s, p, i) => s + hv(i ? pts[i - 1] : KHO, p), 0) + hv(pts[pts.length - 1], KHO);
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

const app = await fixture();
const { call } = app;
const login = async (identifier, password) => (await call('/auth/login', { method: 'POST', body: { identifier, password } })).data.token;
try {
  const owner = await login(app.env.ADMIN_EMAIL, app.env.ADMIN_PASSWORD);
  const suffix = `6${String(Date.now() % 1e5).padStart(5, '0')}`;   // → đầu số di động hợp lệ
  const product = (await call('/products')).data.products.find((p) => p.stock > 10 && p.price > 0);
  const create = async (n, map) => (await call('/admin/orders', { method: 'POST', token: owner, body: {
    receiver_name: `Khách ${n}`, phone: `09${suffix}${n}${n}`.slice(0, 10), home_delivery: true, address: `Số ${n} Lý Thái Tổ, Suối Hoa`,
    payment_method: 'cod', items: [{ product_id: product.id, quantity: 1 }], ...(map ? { map_url: map } : {}),
  } })).data.order;
  const pts = { A: [21.180, 106.060], B: [21.181, 106.0615], C: [21.150, 106.040], D: [21.1795, 106.0625] };
  const orders = {};
  let n = 1;
  for (const [key, [lat, lng]] of Object.entries(pts)) orders[key] = await create(n++, `${lat},${lng}`);
  // Link Google Maps đầy đủ có điểm ghim: đọc được toạ độ mà không cần mạng.
  orders.F = await create(6, 'https://www.google.com/maps/place/Nha/@21.17,106.05,17z/data=!4m6!3m5!8m2!3d21.1781!4d106.0601');
  orders.E = await create(5);   // chỉ có địa chỉ chữ
  check('Tạo 6 đơn thử', Object.values(orders).every((o) => o?.id), short(orders));

  const list = (await call('/admin/orders?limit=50', { token: owner })).data.orders;
  const a = list.find((o) => o.id === orders.A.id);
  check('Danh sách đơn có khoảng cách từ Kho Bồ Sơn', Math.abs(a.distance_km - Math.round(hv(KHO, { lat: 21.18, lng: 106.06 }) * 10) / 10) < 0.01, short(a?.distance_km));
  check('Đơn chưa có định vị: khoảng cách trống', list.find((o) => o.id === orders.E.id).distance_km === null);

  const r = await call('/admin/routes?radius=2&split=0', { token: owner });
  check('Gợi ý gom đơn (200)', r.status === 200, short(r.data));
  const trip = r.data.trips.find((t) => t.stops.some((s) => s.id === orders.A.id));
  const tripIds = trip?.stops.map((s) => s.id).sort() || [];
  check('Gom A, B, D, F (gần nhau) thành một chuyến; C xa thì đi lẻ',
    JSON.stringify(tripIds) === JSON.stringify([orders.A.id, orders.B.id, orders.D.id, orders.F.id].sort())
    && r.data.singles.some((o) => o.id === orders.C.id), short(r.data.trips.map((t) => t.stops.map((s) => s.code))));
  const order = trip.stops.map((s) => ({ lat: s.lat ?? null, id: s.id }));
  const coords = (id) => { const k = Object.keys(orders).find((x) => orders[x].id === id); return k === 'F' ? { lat: 21.1781, lng: 106.0601 } : { lat: pts[k][0], lng: pts[k][1] }; };
  const best = Math.min(...perms(trip.stops.map((s) => s.id)).map((p) => tour(p.map(coords))));
  check('Thứ tự đi rồi về kho là ngắn nhất (so với mọi cách đi)', Math.abs(tour(order.map((o) => coords(o.id))) - best) < 1e-6 && Math.abs(trip.total_km - Math.round(best * 10) / 10) < 0.11,
    `${trip.total_km} vs ${best}`);
  const first = coords(trip.stops[0].id);
  const last = coords(trip.stops[trip.stops.length - 1].id);
  check('Hai chiều dài bằng nhau thì chọn chiều có chặng về kho ngắn hơn', hv(last, KHO) <= hv(first, KHO) + 1e-9);
  check('Chuyến có tổng khứ hồi, so với đi riêng và số km bớt được', trip.total_km < trip.separate_km && trip.saved_km > 0 && trip.return_km > 0, short(trip));
  check('Link Google Maps đi từ kho qua các điểm rồi về kho', /^https:\/\/www\.google\.com\/maps\/dir\/21\.163923,106\.052908\/.*\/21\.163923,106\.052908\//.test(trip.directions_urls[0]), trip.directions_urls[0]);
  check('Đơn chưa có định vị nằm trong mục cần dán định vị', r.data.missing.some((o) => o.id === orders.E.id));
  const tight = (await call('/admin/routes?radius=1&split=0', { token: owner })).data;
  check('Khoảng cách gom 1 km thì nhóm nhỏ lại hoặc tách', !tight.trips.some((t) => t.stops.some((s) => s.id === orders.C.id)));

  // Dán định vị cho đơn chỉ có địa chỉ
  const loc = await call(`/admin/orders/${orders.E.id}/location`, { method: 'PATCH', token: owner, body: { map_url: '21.17, 106.07' } });
  check('Dán toạ độ cho đơn chưa có định vị', loc.status === 200 && loc.data.order.located && loc.data.order.distance_km > 1, short(loc.data));
  check('Link không phải Google Maps (400)', (await call(`/admin/orders/${orders.E.id}/location`, { method: 'PATCH', token: owner, body: { map_url: 'https://evil.example/x' } })).status === 400);

  // Phân quyền
  const shipPhone = `03${suffix}77`;
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Anh Giao', phone: shipPhone, password: 'nhanvien26', permissions: ['delivery'] } });
  const shipper = await login(shipPhone, 'nhanvien26');
  const shippers = (await call('/admin/shippers', { token: owner })).data.shippers;
  const shipperId = shippers.find((s) => s.full_name === 'Anh Giao')?.id;
  check('Nhân viên giao không xem được gợi ý của quản trị (403)', (await call('/admin/routes', { token: shipper })).status === 403);
  check('Chưa đăng nhập (401)', (await call('/admin/routes')).status === 401);
  const accPhone = `03${suffix}88`;
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Chị Kế Toán', phone: accPhone, password: 'nhanvien26', permissions: ['orders.view', 'orders.manage'] } });
  const accountant = await login(accPhone, 'nhanvien26');
  check('Kế toán (quyền quản lý đơn) xem được gợi ý', (await call('/admin/routes', { token: accountant })).status === 200);

  // Giao cả chuyến
  const ids = trip.stops.map((s) => s.id);
  check('Giao cho người không phải nhân viên giao (400)', (await call('/admin/routes/assign', { method: 'POST', token: owner, body: { order_ids: ids, shipper_id: 1 } })).status === 400);
  const assigned = await call('/admin/routes/assign', { method: 'POST', token: accountant, body: { order_ids: ids, shipper_id: shipperId } });
  check('Kế toán giao cả chuyến cho một nhân viên giao', assigned.status === 200 && assigned.data.assigned.length === ids.length, short(assigned.data));
  const after = (await call('/admin/routes?radius=2&split=0', { token: owner })).data;
  check('Đơn đã giao không còn trong gợi ý; hiện ở lộ trình nhân viên', !after.trips.some((t) => t.stops.some((s) => ids.includes(s.id)))
    && after.drivers.some((d) => d.shipper_id === shipperId && d.stops.length === ids.length), short(after.drivers));

  // Trang nhân viên giao: lộ trình
  const mine = (await call('/delivery/orders', { token: shipper })).data;
  check('Nhân viên giao thấy lộ trình đủ điểm, đúng thứ tự gợi ý', mine.route?.stops.length === ids.length
    && JSON.stringify(mine.route.stops.map((s) => s.id)) === JSON.stringify(trip.stops.map((s) => s.id)) && mine.route.total_km === trip.total_km, short(mine.route));
  check('Đơn của nhân viên có khoảng cách từ kho', mine.orders.every((o) => typeof o.distance_km === 'number'));
  check('Không lộ cột nội bộ geo_checked_at', !JSON.stringify(mine.orders).includes('geo_checked_at'));
  check('Lộ trình xuất phát từ kho khi chưa giao đơn nào', mine.route.started_from === 'warehouse' && !mine.route.from_code);
  // Bản đồ điều phối (21/11/2026)
  const disp = await call('/admin/dispatch', { token: accountant });
  const dOrder = disp.data.orders?.find((o) => o.id === orders.A.id);
  const dShip = disp.data.shippers?.find((s) => s.id === shipperId);
  check('Bản đồ điều phối: kế toán xem được đơn đã xác nhận kèm toạ độ, tên, hàng hoá, khoảng cách', disp.status === 200 && dOrder?.located
    && dOrder.lat === 21.18 && dOrder.customer_label === dOrder.receiver_name && dOrder.items.length === 1 && typeof dOrder.distance_km === 'number', short(dOrder));
  check('Bản đồ điều phối: shipper có trạng thái, lộ trình và chỗ chờ vị trí thật (location)', dShip && ['delivering', 'idle', 'done'].includes(dShip.status)
    && dShip.route.stops.length === ids.length && 'location' in dShip && dShip.location === null, short(dShip));
  check('Bản đồ điều phối không lộ giá vốn', !/cost_price/.test(JSON.stringify(disp.data)));
  check('Nhân viên giao không mở được bản đồ điều phối (403); chưa đăng nhập (401)', (await call('/admin/dispatch', { token: shipper })).status === 403
    && (await call('/admin/dispatch')).status === 401);
  const firstId = mine.route.stops[0].id;
  const go = await call(`/delivery/orders/${firstId}/status`, { method: 'PATCH', token: shipper, body: { status: 'shipping' } });
  const still = (await call('/delivery/orders', { token: shipper })).data;
  check('Bắt đầu giao một đơn: lộ trình vẫn đủ điểm', go.status === 200 && still.route.stops.length === ids.length, short(go.data));
  // Vị trí thật từ điện thoại nhân viên giao (21/11/2026)
  const sent = await call('/delivery/location', { method: 'POST', token: shipper, body: { latitude: 21.1712345, longitude: 106.0654321, accuracy: 12.4 } });
  const withLive = (await call('/admin/dispatch', { token: accountant })).data.shippers.find((s) => s.id === shipperId);
  check('Nhân viên giao gửi vị trí GPS → bản đồ điều phối có vị trí thật', sent.status === 200 && withLive?.location?.lat === 21.171235
    && withLive.location.lng === 106.065432 && withLive.location.accuracy === 12 && !!withLive.location.at, JSON.stringify(withLive?.location));
  check('Toạ độ sai bị từ chối (400)', (await call('/delivery/location', { method: 'POST', token: shipper, body: { latitude: 200, longitude: 106 } })).status === 400
    && (await call('/delivery/location', { method: 'POST', token: shipper, body: { latitude: '21.1', longitude: 106 } })).status === 400);
  check('Kế toán / khách không gửi vị trí giao hàng được (403)', (await call('/delivery/location', { method: 'POST', token: accountant, body: { latitude: 21.1, longitude: 106 } })).status === 403);
  const stopped = await call('/delivery/location', { method: 'DELETE', token: shipper });
  check('Tắt chia sẻ vị trí → bản đồ quay về mô phỏng (location null)', stopped.status === 200
    && (await call('/admin/dispatch', { token: accountant })).data.shippers.find((s) => s.id === shipperId)?.location === null);
  const disp2 = (await call('/admin/dispatch', { token: owner })).data;
  check('Shipper bấm "Bắt đầu giao" → bản đồ điều phối báo đang giao', disp2.shippers.find((s) => s.id === shipperId)?.status === 'delivering'
    && disp2.orders.find((o) => o.id === firstId)?.status === 'shipping');
  check('Đơn chờ xác nhận / đã huỷ không hiện trên bản đồ điều phối', disp2.orders.every((o) => ['confirmed', 'shipping'].includes(o.status)));
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
