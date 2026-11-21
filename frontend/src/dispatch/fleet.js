/**
 * Đội giao hàng trên bản đồ điều phối (21/11/2026): vị trí và trạng thái từng shipper.
 *
 * Cấu trúc một shipper (ShipperState):
 *   {
 *     id, full_name, avatar_url,             // từ máy chủ (GET /api/admin/dispatch)
 *     status: 'delivering' | 'done' | 'idle', // Đang giao (✕ đỏ) / Đã giao xong (✓ xanh) / Chưa bắt đầu
 *     lat, lng,                              // vị trí đang vẽ trên bản đồ
 *     source: 'live' | 'simulated',          // vị trí thật từ điện thoại hay đang mô phỏng
 *     path: [{lat,lng}], leg, progress,      // đường mô phỏng: kho → các đơn → về kho
 *     orderIds: [id…]                        // đơn đang giữ (theo thứ tự lộ trình)
 *   }
 *
 * NỐI DỮ LIỆU THẬT SAU NÀY: khi có vị trí gửi từ điện thoại nhân viên giao (hoặc trạng thái đơn đổi), gọi
 *   applyShipperUpdate(fleet, { shipper_id, lat, lng, status })
 * shipper đó chuyển sang source 'live' và không bị mô phỏng ghi đè nữa. Máy chủ đã chừa sẵn trường
 * `location` ({ lat, lng, at }) trong mỗi shipper; có dữ liệu là bản đồ dùng luôn.
 */

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
export function haversineKm(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Vòng tròn quanh kho (bán kính km) cho shipper chưa có đơn nào để vẫn thấy chuyển động khi thử. */
function demoLoop(center, radiusKm, phase) {
  return Array.from({ length: 9 }, (_, i) => {
    const a = phase + (i / 8) * 2 * Math.PI;
    return { lat: center.lat + (radiusKm / 110.57) * Math.sin(a), lng: center.lng + (radiusKm / (111.32 * Math.cos(rad(center.lat)))) * Math.cos(a) };
  });
}

/** Tạo đội shipper từ dữ liệu máy chủ. Không có ai (chưa tạo tài khoản giao hàng) thì thêm 1 shipper mô phỏng để thử. */
export function createFleet(data) {
  const wh = { lat: data.warehouse.lat, lng: data.warehouse.lng };
  const located = data.orders.filter((o) => o.located);
  const list = data.shippers.length ? data.shippers : [{ id: 'demo', full_name: 'Shipper mô phỏng', avatar_url: null, status: 'delivering', route: { stops: [] }, location: null, demo: true }];
  return list.map((s, index) => {
    const stops = s.route?.stops || [];
    let path;
    if (stops.length) path = [wh, ...stops.map((p) => ({ lat: p.lat, lng: p.lng })), wh];
    else if (located.length && s.demo) path = [wh, ...located.slice(0, 4).map((o) => ({ lat: o.lat, lng: o.lng })), wh];
    else path = demoLoop(wh, 0.8 + index * 0.35, index * 1.3);
    const live = s.location && Number.isFinite(s.location.lat) && Number.isFinite(s.location.lng);
    return {
      id: s.id, full_name: s.full_name, avatar_url: s.avatar_url || null, demo: !!s.demo,
      status: s.status, active_count: s.active_count || 0, done_today: s.done_today || 0,
      orderIds: stops.map((p) => p.id),
      path, leg: 0, progress: 0,
      lat: live ? s.location.lat : path[0].lat, lng: live ? s.location.lng : path[0].lng,
      source: live ? 'live' : 'simulated',
    };
  });
}

/**
 * Một nhịp mô phỏng: shipper "Đang giao" đi tiếp trên đường của mình `seconds` giây với vận tốc
 * `kmh` (đã nhân tốc độ tua). Đi hết đường thì quay về kho và chuyển "Đã giao xong". Trả về mảng mới.
 */
export function tickFleet(fleet, { seconds, kmh }) {
  return fleet.map((s) => {
    if (s.source === 'live' || s.status !== 'delivering' || s.path.length < 2) return s;
    let { leg, progress } = s;
    let remainKm = (kmh * seconds) / 3600;
    let finished = false;
    while (remainKm > 0) {
      const a = s.path[leg];
      const b = s.path[leg + 1];
      if (!b) { finished = true; break; }
      const legKm = Math.max(haversineKm(a, b), 0.001);
      const leftKm = legKm * (1 - progress);
      if (remainKm < leftKm) { progress += remainKm / legKm; remainKm = 0; }
      else { remainKm -= leftKm; leg += 1; progress = 0; }
    }
    if (leg >= s.path.length - 1) finished = true;
    const a = s.path[Math.min(leg, s.path.length - 1)];
    const b = s.path[Math.min(leg + 1, s.path.length - 1)];
    const lat = a.lat + (b.lat - a.lat) * progress;
    const lng = a.lng + (b.lng - a.lng) * progress;
    // Shipper mô phỏng không có đơn thật thì đi vòng mãi; shipper có lộ trình thì về kho là xong.
    if (finished && (s.demo || !s.orderIds.length)) return { ...s, leg: 0, progress: 0, lat: s.path[0].lat, lng: s.path[0].lng };
    if (finished) return { ...s, leg: s.path.length - 1, progress: 0, lat: s.path[s.path.length - 1].lat, lng: s.path[s.path.length - 1].lng, status: 'done' };
    return { ...s, leg, progress, lat, lng };
  });
}

/** Đổi trạng thái để thử (Đang giao / Đã giao). Bấm "Đang giao" lại sau khi đã xong thì đi lại từ kho. */
export function setShipperStatus(fleet, id, status) {
  return fleet.map((s) => {
    if (s.id !== id) return s;
    if (status === 'delivering' && s.status !== 'delivering' && s.leg >= s.path.length - 1) {
      return { ...s, status, manual: true, leg: 0, progress: 0, lat: s.path[0].lat, lng: s.path[0].lng };
    }
    return { ...s, status, manual: true };
  });
}

/** Cập nhật từ nguồn dữ liệu thật (vị trí điện thoại, trạng thái đơn). */
export function applyShipperUpdate(fleet, { shipper_id, lat, lng, status }) {
  return fleet.map((s) => (s.id !== shipper_id ? s : {
    ...s,
    ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, source: 'live' } : {}),
    ...(status ? { status } : {}),
  }));
}

/**
 * Gộp dữ liệu mới tải từ máy chủ vào đội đang chạy (tự làm mới mỗi 30 giây) mà shipper không nhảy về kho:
 * giữ vị trí hiện tại; lộ trình đổi thì đi tiếp từ chỗ đang đứng theo lộ trình mới. Trạng thái người dùng
 * vừa bấm thử (manual) được giữ nguyên.
 */
export function mergeFleet(old, fresh) {
  const byId = new Map(old.map((s) => [s.id, s]));
  return fresh.map((s) => {
    const prev = byId.get(s.id);
    if (!prev || s.source === 'live') return s;
    const samePath = JSON.stringify(prev.path) === JSON.stringify(s.path);
    const here = { lat: prev.lat, lng: prev.lng };
    return {
      ...s,
      status: prev.manual ? prev.status : s.status,
      manual: prev.manual,
      lat: prev.lat, lng: prev.lng,
      ...(samePath ? { leg: prev.leg, progress: prev.progress } : { path: [here, ...s.path.slice(1)], leg: 0, progress: 0 }),
    };
  });
}

/** Shipper gần một điểm nhất (km đường chim bay), xếp tăng dần. */
export function nearestShippers(fleet, point, limit = 3) {
  return fleet
    .map((s) => ({ shipper: s, km: haversineKm(s, point) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
