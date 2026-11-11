/**
 * Định vị khách do nhân viên dán vào (12/11/2026): link Google Maps khách gửi qua Zalo, hoặc toạ độ.
 * Chỉ nhận link https của Google Maps để nút "Chỉ đường" của nhân viên giao hàng không bao giờ mở
 * trang lạ. Khách hay gửi kèm chữ ("Vị trí của em: https://maps.app.goo.gl/…") nên lấy link đầu tiên
 * trong đoạn văn bản.
 */
export const MAP_LINK_INPUT_MAX = 2000;
const MAP_LINK_MAX = 1000;
export const MAP_LINK_ERROR = 'Định vị chưa đúng. Dán link Google Maps (https://maps.app.goo.gl/… hoặc https://www.google.com/maps/…) hoặc toạ độ dạng 21.1861,106.0763.';

const COORDS_RE = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/;
const GOOGLE_HOST_RE = /^(www\.|maps\.)?google\.com(\.vn)?$/;

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
  const coords = COORDS_RE.exec(text);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: MAP_LINK_ERROR };
    return { url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` };
  }
  const found = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!found) return { error: MAP_LINK_ERROR };
  let url;
  try {
    url = new URL(found[0].replace(/[.,;:!?)\]]+$/, ''));
  } catch {
    return { error: MAP_LINK_ERROR };
  }
  url.protocol = 'https:';
  if (url.username || url.password || url.port || !allowedMapUrl(url)) return { error: MAP_LINK_ERROR };
  const href = url.href;
  if (href.length > MAP_LINK_MAX) return { error: 'Link định vị quá dài. Trong Google Maps bấm Chia sẻ → Sao chép đường liên kết để lấy link ngắn.' };
  return { url: href };
}
