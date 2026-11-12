/**
 * Định vị khách do nhân viên dán vào (12/11/2026): link Google Maps khách gửi qua Zalo, hoặc toạ độ.
 * Chỉ nhận link https của Google Maps để nút "Chỉ đường" của nhân viên giao hàng không bao giờ mở
 * trang lạ. Khách hay gửi kèm chữ ("Vị trí của em: https://maps.app.goo.gl/…") nên lấy link đầu tiên
 * trong đoạn văn bản. Link chép từ thanh địa chỉ có dấu ' và " trong toạ độ (21°17'27.6"N) nên
 * link chỉ kết thúc ở khoảng trắng. Quy tắc này có bản sao ở frontend/src/api.js (pastedMapLink).
 */
export const MAP_LINK_INPUT_MAX = 2000;
const MAP_LINK_MAX = 1000;
export const MAP_LINK_ERROR = 'Định vị chưa đúng. Dán link Google Maps (https://maps.app.goo.gl/… hoặc https://www.google.com/maps/…) hoặc toạ độ dạng 21.1861,106.0763.';
/** Địa chỉ ghi trên đơn khi nhân viên chỉ dán định vị, không gõ địa chỉ. */
export const MAP_ONLY_ADDRESS = 'Giao theo định vị Google Maps';

const COORDS_RE = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/;
// Toạ độ dạng độ-phút-giây Google Maps hiển thị: 21°17'27.6"N 106°12'04.4"E
const DMS_RE = /^(\d{1,2})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|”|'')?\s*([NS])[\s,;+]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|”|'')?\s*([EW])$/i;
const URL_RE = /https?:\/\/[^\s<>]+/i;
const TRAILING_RE = /[.,;:!?)\]"'”’]+$/;
const GOOGLE_HOST_RE = /^(www\.|maps\.)?google\.com(\.vn)?$/;

const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const coordsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** Toạ độ thập phân hoặc độ-phút-giây → link; `undefined` nếu không phải toạ độ, `null` nếu ngoài phạm vi. */
function coordsLink(text) {
  const plain = COORDS_RE.exec(text);
  if (plain) {
    const lat = Number(plain[1]);
    const lng = Number(plain[2]);
    return inRange(lat, lng) ? coordsUrl(lat, lng) : null;
  }
  const dms = DMS_RE.exec(text);
  if (!dms) return undefined;
  const part = (deg, min, sec, negative) => {
    if (Number(min) >= 60 || Number(sec) >= 60) return NaN;
    const value = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
    return Number((negative ? -value : value).toFixed(6));
  };
  const lat = part(dms[1], dms[2], dms[3], /s/i.test(dms[4]));
  const lng = part(dms[5], dms[6], dms[7], /w/i.test(dms[8]));
  return inRange(lat, lng) ? coordsUrl(lat, lng) : null;
}

/** Toạ độ ghim nằm sẵn trong link đầy đủ (!3d…!4d… là điểm ghim, @…,… là tâm bản đồ). */
function pinInUrl(href) {
  const pin = /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(href) || /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(href);
  if (!pin) return null;
  const lat = Number(pin[1]);
  const lng = Number(pin[2]);
  return inRange(lat, lng) ? coordsUrl(lat, lng) : null;
}

function allowedMapUrl(url) {
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl') return url.pathname.length > 1;
  if (host === 'goo.gl') return url.pathname.startsWith('/maps/');
  if (!GOOGLE_HOST_RE.test(host)) return false;
  // maps.google.com/… nhận mọi đường dẫn; google.com phải là /maps…
  return host.startsWith('maps.') || url.pathname === '/maps' || url.pathname.startsWith('/maps/');
}

/**
 * Trả về `{ url }` (null nếu để trống) hoặc `{ error }`. Toạ độ đổi thành link Google Maps.
 */
export function parseMapLink(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { url: null };
  if (text.length > MAP_LINK_INPUT_MAX) return { error: MAP_LINK_ERROR };
  const coords = coordsLink(text);
  if (coords !== undefined) return coords ? { url: coords } : { error: MAP_LINK_ERROR };
  const found = URL_RE.exec(text);
  if (!found) return { error: MAP_LINK_ERROR };
  let url;
  try {
    url = new URL(found[0].replace(TRAILING_RE, ''));
  } catch {
    return { error: MAP_LINK_ERROR };
  }
  url.protocol = 'https:';
  if (url.username || url.password || url.port || !allowedMapUrl(url)) return { error: MAP_LINK_ERROR };
  const href = url.href.replace(/'/g, '%27');
  if (href.length <= MAP_LINK_MAX) return { url: href };
  // Link đầy đủ quá dài: giữ lại đúng điểm ghim nằm trong link.
  const pin = pinInUrl(href);
  return pin ? { url: pin } : { error: 'Link định vị quá dài. Trong Google Maps bấm Chia sẻ → Sao chép đường liên kết để lấy link ngắn.' };
}

/**
 * Nhân viên dán link Google Maps thẳng vào ô địa chỉ: tách link ra khỏi phần chữ.
 * Trả về `{ address, url }` hoặc null khi ô địa chỉ không chứa link Google Maps hợp lệ.
 */
export function splitAddressMap(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const found = URL_RE.exec(text);
  if (!found) return null;
  const map = parseMapLink(found[0]);
  if (!map.url) return null;
  const address = `${text.slice(0, found.index)} ${text.slice(found.index + found[0].length)}`
    .replace(/\s+/g, ' ').replace(/^[\s,;:|–-]+|[\s,;:|(–-]+$/g, '');
  return { address, url: map.url };
}
