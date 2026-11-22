/**
 * Tự tìm định vị từ địa chỉ chữ (22/11/2026): đơn không có vị trí khách ghim và không có link Google Maps thì
 * tra địa chỉ trên bản đồ OpenStreetMap (dịch vụ Photon, miễn phí, không cần khoá), chỉ lấy kết quả trong tỉnh
 * Bắc Ninh, rồi chọn kết quả khớp địa chỉ nhất (số nhà + tên đường, phường, tên toà nhà / chung cư).
 *
 * Kết quả là định vị GẦN ĐÚNG: nhân viên xem lại và sửa được (dán link Google Maps) ở thẻ đơn hàng.
 * Chỉ gửi đi phần địa chỉ (không gửi tên, số điện thoại khách). Tắt bằng GEO_RESOLVE=0 (bộ kiểm thử).
 */
const PHOTON_URL = 'https://photon.komoot.io/api/';
// Khung tỉnh Bắc Ninh (cả phần sáp nhập Bắc Giang ở phía bắc): minLng, minLat, maxLng, maxLat.
const BBOX = [105.85, 20.9, 106.75, 21.55];
const MIN_SCORE = 3;
const MIN_GAP_MS = 1100;   // tối đa ~1 yêu cầu / giây theo quy định dùng chung của dịch vụ miễn phí

/** Bỏ dấu, chữ thường, chỉ giữ chữ / số / khoảng trắng. */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['duong', 'pho', 'so', 'ngo', 'ngach', 'hem', 'thon', 'xom', 'khu', 'phuong', 'xa', 'thi', 'tran', 'thanh', 'quan', 'huyen', 'tinh', 'tp', 'viet', 'nam', 'bac', 'ninh']);
const words = (s) => fold(s).split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
const contains = (haystack, needle) => needle && ` ${haystack} `.includes(` ${needle} `);

/** Chuỗi gửi đi tìm: bỏ ký tự thừa, chắc chắn có "Bắc Ninh". */
export function searchText(address) {
  const text = String(address || '').replace(/[|;]+/g, ',').replace(/\s+/g, ' ').trim();
  return /bac ninh/.test(fold(text)) ? text : `${text}, Bắc Ninh`;
}

/** Điểm khớp giữa một kết quả bản đồ và địa chỉ khách ghi. */
export function scoreCandidate(props, address) {
  const addr = fold(address);
  const house = (addr.match(/^(?:so\s+)?(\d+[a-z]?)\b/) || [])[1] || null;
  let score = 0;
  const street = fold(props.street || '').replace(/^(duong|pho)\s+/, '');
  const streetHit = street && contains(addr, street);
  if (streetHit) score += 3;
  if (streetHit && house && fold(props.housenumber || '') === house) score += 4;
  for (const area of [props.district, props.locality]) {
    const a = fold(area || '');
    if (a && contains(addr, a)) { score += 3; break; }
  }
  const nameWords = words(props.name || '');
  if (nameWords.length) {
    const hit = nameWords.filter((w) => contains(addr, w)).length / nameWords.length;
    score += 3 * hit;
  }
  return score;
}

const inBox = ([lng, lat]) => lng >= BBOX[0] && lng <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3];

/** Chọn kết quả tốt nhất từ danh sách GeoJSON của Photon; null nếu không đủ khớp. */
export function pickBest(features, address) {
  let best = null;
  for (const f of features || []) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || !inBox(coords)) continue;
    const score = scoreCandidate(f.properties || {}, address);
    if (!best || score > best.score) best = { score, lat: coords[1], lng: coords[0], label: [f.properties?.name, f.properties?.street, f.properties?.district].filter(Boolean).join(', ') };
  }
  return best && best.score >= MIN_SCORE ? best : null;
}

/** Bản rút gọn để tìm lượt hai: bỏ số nhà và các chữ "số / đường / phường…", chỉ giữ tên đường, phường, toà nhà. */
export function simplifiedText(address) {
  const text = (` ${String(address || '')} `).replace(/(?<=[\s,.\-|;])(số|so|đường|duong|phố|pho|phường|phuong|xã|xa|ngõ|ngo|ngách|ngach|thôn|thon|tp\.?|thành phố)(?=[\s,.\-|;])/giu, ' ')
    .replace(/\d+[a-zA-Z]?\/?\d*/g, ' ').replace(/[,.\-|;]+/g, ' ').replace(/\s+/g, ' ').trim();
  return searchText(text);
}

let lastCall = 0;
async function photon(text, timeoutMs) {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `${PHOTON_URL}?${new URLSearchParams({ q: text, limit: '6', lang: 'default', bbox: BBOX.join(',') })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'GaoKinhBac-Shop/1.0 (delivery address lookup)', Accept: 'application/json' } });
  if (!res.ok) return [];
  return (await res.json()).features || [];
}

/** Tìm định vị cho địa chỉ; trả về { lat, lng, label, score } hoặc null (không ném lỗi). */
export async function geocodeAddress(address, { timeoutMs = 4000 } = {}) {
  if (process.env.GEO_RESOLVE === '0' || typeof fetch !== 'function') return null;
  const text = searchText(address);
  if (fold(text).length < 6) return null;
  try {
    let best = pickBest(await photon(text, timeoutMs), address);
    // Chưa khớp cả tên đường lẫn phường / số nhà: tìm thêm bằng bản rút gọn rồi lấy kết quả điểm cao hơn.
    if (!best || best.score < 6) {
      const short = simplifiedText(address);
      if (short !== text && fold(short).length >= 6) {
        const second = pickBest(await photon(short, timeoutMs), address);
        if (second && (!best || second.score > best.score)) best = second;
      }
    }
    return best;
  } catch {
    return null;
  }
}
