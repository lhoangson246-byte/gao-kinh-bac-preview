import db from './db.js';

/**
 * Tính khoảng cách và lộ trình giao hàng từ Kho Bồ Sơn (20/11/2026).
 *
 *  - Mỗi đơn lấy toạ độ theo thứ tự: vị trí khách ghim lúc đặt (delivery_lat/lng) → toạ độ nằm trong link
 *    Google Maps → link rút gọn maps.app.goo.gl đã mở ra (lưu ở geo_lat/geo_lng) → định vị đã lưu của khách
 *    quen cùng số điện thoại và cùng địa chỉ.
 *  - Khoảng cách là đường chim bay (công thức haversine), không gọi dịch vụ bản đồ trả phí. Đường đi thật
 *    xem bằng nút mở Google Maps có sẵn các điểm dừng theo đúng thứ tự.
 *  - Lộ trình nhiều đơn: đi từ kho, qua mọi điểm, quay về kho, chọn thứ tự cho tổng quãng đường ngắn nhất
 *    (tính chính xác tới 10 điểm, nhiều hơn thì gần đúng).
 */
export const WAREHOUSE = {
  code: 'KH_BS',
  name: 'Kho Bồ Sơn',
  address: '168 Đ. Triệu Việt Vương, Võ Cường, Bắc Ninh',
  lat: 21.1639226,
  lng: 106.0529077,
  map_url: 'https://maps.app.goo.gl/TdFAuS1vNaZfY88u5',
};

const R_EARTH_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
export const round1 = (km) => Math.round(km * 10) / 10;

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  && !(lat === 0 && lng === 0);
const point = (lat, lng) => { const p = { lat: Number(lat), lng: Number(lng) }; return valid(p.lat, p.lng) ? p : null; };

/** Toạ độ nằm sẵn trong một link Google Maps (điểm ghim !3d!4d, ?q= / query= / ll=, /search/…, @tâm bản đồ). */
export function coordsFromUrl(href) {
  if (typeof href !== 'string' || !href) return null;
  let text = href;
  try { text = decodeURIComponent(href); } catch { /* giữ nguyên */ }
  const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`),
    new RegExp(`[?&](?:q|query|ll|destination|center)=(?:loc:)?\\s*${NUM}\\s*,\\s*${NUM}`),
    new RegExp(`/(?:search|place|dir)/${NUM}\\s*,\\s*\\+?${NUM}`),
    new RegExp(`@${NUM},${NUM}`),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const p = m && point(m[1], m[2]);
    if (p) return p;
  }
  return null;
}

const GOOGLE_HOST = /^((www|maps|consent)\.)?google\.com(\.vn)?$|^(maps\.app\.)?goo\.gl$/i;

/**
 * Mở link rút gọn Google Maps (maps.app.goo.gl/…) để lấy toạ độ: chỉ đọc địa chỉ chuyển hướng, tối đa
 * 4 lần, chỉ đi tới tên miền của Google, không tải trang. Không lấy được thì trả về null (không ném lỗi).
 */
export async function resolveMapLink(href, { timeoutMs = 3500 } = {}) {
  const inline = coordsFromUrl(href);
  if (inline) return inline;
  if (process.env.GEO_RESOLVE === '0' || typeof fetch !== 'function') return null;
  let current = href;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const url = new URL(current);
      if (url.protocol !== 'https:' || !GOOGLE_HOST.test(url.hostname) || url.username || url.password || url.port) return null;
      if (url.hostname.startsWith('consent.')) {
        const next = url.searchParams.get('continue');
        if (!next) return null;
        current = next;
        const found = coordsFromUrl(current);
        if (found) return found;
        continue;
      }
      const res = await fetch(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GaoKinhBac/1.0)', 'Accept-Language': 'vi' } });
      const location = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* bỏ qua */ }
      if (!location) return null;
      current = new URL(location, url).href;
      const found = coordsFromUrl(current);
      if (found) return found;
    }
  } catch {
    return null;
  }
  return null;
}

/** Toạ độ của đơn đã có sẵn (không cần mạng). */
export function orderPoint(order) {
  return point(order.delivery_lat, order.delivery_lng)
    || point(order.geo_lat, order.geo_lng)
    || coordsFromUrl(order.map_url)
    || null;
}

const sameAddress = (a, b) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim() === String(b || '').toLowerCase().replace(/\s+/g, ' ').trim();
const RETRY_HOURS = 6;

/**
 * Tìm toạ độ cho những đơn chưa có: mở link rút gọn, hoặc dùng định vị đã lưu của khách quen. Lưu kết quả
 * (kể cả lần không tìm được) để lần sau không hỏi lại. Giới hạn số đơn và thời gian mỗi lượt.
 */
export async function ensureOrderPoints(orders, { max = 12, budgetMs = 6000 } = {}) {
  const started = Date.now();
  const need = orders.filter((o) => o.fulfillment !== 'pickup' && !orderPoint(o)
    && (!o.geo_checked_at || Date.parse(`${String(o.geo_checked_at).replace(' ', 'T')}Z`) < Date.now() - RETRY_HOURS * 3600_000));
  let done = 0;
  for (const order of need) {
    if (done >= max || Date.now() - started > budgetMs) break;
    done++;
    let found = null;
    let source = null;
    if (order.map_url) {
      found = await resolveMapLink(order.map_url, { timeoutMs: Math.max(800, Math.min(3500, budgetMs - (Date.now() - started))) });
      source = found ? 'map' : null;
    }
    if (!found && order.phone) {
      const profile = db.prepare('SELECT address, map_url, lat, lng FROM customer_profiles WHERE phone = ?').get(order.phone);
      if (profile && sameAddress(profile.address, order.address)) {
        found = point(profile.lat, profile.lng) || coordsFromUrl(profile.map_url)
          || (profile.map_url && profile.map_url !== order.map_url ? await resolveMapLink(profile.map_url, { timeoutMs: 2500 }) : null);
        source = found ? 'profile' : null;
      }
    }
    db.prepare("UPDATE orders SET geo_lat = ?, geo_lng = ?, geo_source = ?, geo_checked_at = datetime('now') WHERE id = ?")
      .run(found?.lat ?? null, found?.lng ?? null, source, order.id);
    order.geo_lat = found?.lat ?? null;
    order.geo_lng = found?.lng ?? null;
    order.geo_source = source;
  }
}

/** Khoảng cách đường chim bay từ kho tới đơn (km, 1 chữ số thập phân) hoặc null khi chưa có định vị. */
export function distanceFromWarehouse(order) {
  const p = orderPoint(order);
  return p ? round1(haversineKm(WAREHOUSE, p)) : null;
}

/**
 * Thứ tự đi qua các điểm `points` rồi quay về `end`, xuất phát từ `start`, cho tổng quãng đường ngắn nhất.
 * Trả về chỉ số các điểm theo thứ tự đi.
 */
export function bestOrder(points, start = WAREHOUSE, end = WAREHOUSE) {
  const n = points.length;
  if (n <= 1) return points.map((_, i) => i);
  const d = (i, j) => haversineKm(points[i], points[j]);
  const fromStart = points.map((p) => haversineKm(start, p));
  const toEnd = points.map((p) => haversineKm(p, end));
  if (n <= 10) {
    // Held-Karp: dp[tập đã đi][điểm cuối] = quãng ngắn nhất.
    const FULL = 1 << n;
    const dp = new Float64Array(FULL * n).fill(Infinity);
    const prev = new Int8Array(FULL * n).fill(-1);
    for (let i = 0; i < n; i++) dp[(1 << i) * n + i] = fromStart[i];
    for (let mask = 1; mask < FULL; mask++) {
      for (let last = 0; last < n; last++) {
        const cur = dp[mask * n + last];
        if (!(mask & (1 << last)) || cur === Infinity) continue;
        for (let next = 0; next < n; next++) {
          if (mask & (1 << next)) continue;
          const m2 = mask | (1 << next);
          const v = cur + d(last, next);
          if (v < dp[m2 * n + next] - 1e-12) { dp[m2 * n + next] = v; prev[m2 * n + next] = last; }
        }
      }
    }
    let best = Infinity;
    let last = 0;
    for (let i = 0; i < n; i++) {
      const v = dp[(FULL - 1) * n + i] + toEnd[i];
      if (v < best - 1e-12) { best = v; last = i; }
    }
    const order = [];
    let mask = FULL - 1;
    while (last !== -1) {
      order.push(last);
      const p = prev[mask * n + last];
      mask &= ~(1 << last);
      last = p;
    }
    return order.reverse();
  }
  // Nhiều điểm: láng giềng gần nhất rồi cải thiện bằng 2-opt.
  const left = new Set(points.map((_, i) => i));
  const order = [];
  let at = null;
  while (left.size) {
    let pick = null;
    let bestD = Infinity;
    for (const i of left) {
      const v = at === null ? fromStart[i] : d(at, i);
      if (v < bestD) { bestD = v; pick = i; }
    }
    order.push(pick);
    left.delete(pick);
    at = pick;
  }
  const total = (o) => fromStart[o[0]] + o.slice(1).reduce((s, v, k) => s + d(o[k], v), 0) + toEnd[o[o.length - 1]];
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (total(cand) < total(order) - 1e-9) { order.splice(0, n, ...cand); improved = true; }
      }
    }
  }
  return order;
}

const ll = (p) => `${Number(p.lat.toFixed(6))},${Number(p.lng.toFixed(6))}`;

/** Link chỉ đường Google Maps qua các điểm theo thứ tự (mỗi link tối đa 9 điểm dừng, quá thì tách nhiều link). */
export function directionsUrls(stops, start = WAREHOUSE, end = WAREHOUSE) {
  const urls = [];
  let from = start;
  for (let i = 0; i < stops.length; i += 9) {
    const chunk = stops.slice(i, i + 9);
    const last = i + 9 >= stops.length;
    const path = [from, ...chunk, ...(last ? [end] : [])].map(ll).join('/');
    urls.push(`https://www.google.com/maps/dir/${path}/data=!4m2!4m1!3e0`);
    from = chunk[chunk.length - 1];
  }
  return urls;
}

/**
 * Lộ trình cho một nhóm đơn (đã có toạ độ): thứ tự đi, quãng từng chặng, tổng quãng đường khứ hồi,
 * và so với đi riêng từng đơn (mỗi đơn đi về một lượt).
 */
export function planRoute(orders, { start = WAREHOUSE, end = WAREHOUSE } = {}) {
  const located = orders.map((o) => ({ order: o, p: orderPoint(o) })).filter((x) => x.p);
  let idx = bestOrder(located.map((x) => x.p), start, end);
  // Đi và về cùng một chỗ thì chiều ngược lại dài bằng nhau: chọn chiều có chặng cuối quay về kho ngắn hơn.
  if (idx.length > 1 && start.lat === end.lat && start.lng === end.lng
      && haversineKm(located[idx[0]].p, end) < haversineKm(located[idx[idx.length - 1]].p, end) - 1e-9) idx = idx.reverse();
  const seq = idx.map((i) => located[i]);
  let at = start;
  let total = 0;
  const stops = seq.map(({ order, p }, k) => {
    const leg = haversineKm(at, p);
    total += leg;
    at = p;
    return { id: order.id, step: k + 1, leg_km: round1(leg), from_warehouse_km: round1(haversineKm(WAREHOUSE, p)), lat: p.lat, lng: p.lng };
  });
  const back = seq.length ? haversineKm(at, end) : 0;
  total += back;
  const separate = seq.reduce((s, { p }) => s + 2 * haversineKm(WAREHOUSE, p), 0);
  return {
    stops,
    total_km: round1(total),
    return_km: round1(back),
    separate_km: round1(separate),
    saved_km: round1(Math.max(0, separate - total)),
    directions_urls: seq.length ? directionsUrls(seq.map((x) => x.p), start, end) : [],
    started_from: start === WAREHOUSE ? 'warehouse' : 'last_stop',
  };
}

/**
 * Gom đơn gần nhau: hai đơn chỉ chung nhóm khi mọi cặp đơn trong nhóm cách nhau không quá `radiusKm`
 * (gộp dần từ cặp gần nhất), mỗi nhóm tối đa `maxSize` đơn.
 */
export function clusterOrders(orders, { radiusKm = 2, maxSize = 8 } = {}) {
  const items = orders.map((o) => ({ o, p: orderPoint(o) })).filter((x) => x.p);
  let groups = items.map((x) => [x]);
  const diameter = (a, b) => {
    let m = 0;
    for (const x of a) for (const y of b) m = Math.max(m, haversineKm(x.p, y.p));
    return m;
  };
  for (;;) {
    let best = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i].length + groups[j].length > maxSize) continue;
        const dm = diameter(groups[i], groups[j]);
        if (dm <= radiusKm && (!best || dm < best.dm)) best = { i, j, dm };
      }
    }
    if (!best) break;
    groups[best.i] = [...groups[best.i], ...groups[best.j]];
    groups = groups.filter((_, k) => k !== best.j);
  }
  return groups.map((g) => g.map((x) => x.o));
}

/* ---------- Ngày giao của đơn (giống frontend/src/api.js slotDay) ---------- */
const SLOT_END = { sang1: 570, sang2: 690, chieu1: 900, chieu2: 1050, chieu3: 1120, sang: 690, chieu: 1080 };
const LEGACY = new Set(['sang', 'chieu']);
const CUTOFF = 17 * 60 + 30;
const LEAD = 60;

/** Ngày giao YYYY-MM-DD (giờ Việt Nam) suy từ giờ đặt và khung giờ. */
export function deliveryDay(createdAt, slot) {
  const placed = new Date(`${String(createdAt).replace(' ', 'T')}${/[zZ+]/.test(String(createdAt)) ? '' : 'Z'}`);
  if (Number.isNaN(placed.getTime())) return null;
  const vn = new Date(placed.getTime() + 7 * 3600_000);
  const m = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  let tomorrow = m >= CUTOFF;
  if (!tomorrow && slot && SLOT_END[slot]) tomorrow = LEGACY.has(slot) ? m >= SLOT_END[slot] : m + LEAD > SLOT_END[slot];
  if (tomorrow) vn.setUTCDate(vn.getUTCDate() + 1);
  return vn.toISOString().slice(0, 10);
}
