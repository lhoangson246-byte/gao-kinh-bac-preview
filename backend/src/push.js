/**
 * Báo đơn mới cho chủ cửa hàng khi điện thoại đang khoá màn hình hoặc đã đóng app:
 *  - Web Push (VAPID) tới mọi máy quản trị đã bật "thông báo khi tắt màn hình";
 *  - Telegram (dự phòng, không bắt buộc) khi có TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID.
 *
 * Không bao giờ ném lỗi ra ngoài: gửi báo hỏng không được làm hỏng việc đặt hàng của khách.
 */
import webpush from 'web-push';
import db from './db.js';
import { DELIVERY_SLOTS } from './constants.js';

const env = process.env;
const SEND_TIMEOUT_MS = 5000;
// Mỗi tài khoản quản trị giữ tối đa chừng này máy; máy cũ nhất bị thay khi vượt.
export const MAX_DEVICES_PER_ADMIN = 20;

/** Khoá VAPID. Nhận cả tên biến kiểu Next.js/Vite cho khoá công khai để đỡ nhầm khi cấu hình. */
export function vapidConfig() {
  const publicKey = (env.VAPID_PUBLIC_KEY || env.VITE_VAPID_PUBLIC_KEY || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (env.VAPID_SUBJECT || '').trim();
  if (!publicKey || !privateKey || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

const TELEGRAM_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const TELEGRAM_CHAT = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;
export function telegramConfigured() {
  return TELEGRAM_TOKEN.test(env.TELEGRAM_BOT_TOKEN || '') && TELEGRAM_CHAT.test(env.TELEGRAM_CHAT_ID || '');
}

// Bài kiểm tra tự động dựng máy chủ push/Telegram giả trên máy; không bao giờ áp dụng trên Vercel.
const onVercel = () => Boolean(env.VERCEL || env.VERCEL_ENV);
const testOrigin = (name) => (onVercel() ? '' : (env[name] || '').trim());

/**
 * Máy chủ chỉ gửi tới dịch vụ push thật của trình duyệt. Chặn để một địa chỉ lạ không biến máy chủ
 * thành công cụ gọi vào mạng nội bộ (SSRF): FCM (Chrome/Android/Edge mới), Mozilla, Windows, Apple.
 */
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function pushEndpointAllowed(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.username || url.password) return false;
  const local = testOrigin('PUSH_TEST_ORIGIN');
  if (local && url.origin === local) return true;
  return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

const fromBase64Url = (value) => Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** Khoá của trình duyệt: p256dh là điểm P-256 dạng không nén (65 byte, bắt đầu 0x04), auth 16 byte. */
export function pushKeysValid(p256dh, auth) {
  const point = fromBase64Url(p256dh);
  return point.length === 65 && point[0] === 4 && fromBase64Url(auth).length === 16;
}

export const formatMoney = (value) => String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const mapsUrl = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng)
  ? `https://www.google.com/maps?q=${lat},${lng}` : null);
const slotLabel = (slot) => DELIVERY_SLOTS[slot] || 'Chưa chọn khung giờ';
const clip = (text, max) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** Đọc đơn kèm hàng để soạn thông báo (chỉ những cột cần, không lộ mã bí mật của đơn khách). */
export function orderForNotice(orderId) {
  const order = db.prepare(`
    SELECT id, code, receiver_name, phone, address, delivery_slot, delivery_lat, delivery_lng,
           payment_method, total, is_guest, note
    FROM orders WHERE id = ?
  `).get(orderId);
  if (!order) return null;
  order.items = db.prepare(`
    SELECT product_name, quantity, unit, price, is_reward, promo FROM order_items WHERE order_id = ? ORDER BY id
  `).all(orderId);
  return order;
}

/** Nội dung Web Push: service worker (frontend/public/sw.js) dựng thông báo từ đây. */
export function orderPushPayload(order) {
  const code = order.code || `#${order.id}`;
  return {
    kind: 'order',
    title: `🌾 ĐƠN HÀNG MỚI #${code} - ${formatMoney(order.total)}đ`,
    body: `Khách: ${clip(order.receiver_name, 60)} (${order.phone})\nGiờ giao: ${slotLabel(order.delivery_slot)} | Đ/c: ${clip(order.address, 140)}`,
    tag: `order-${order.id}`,
    orderId: order.id,
    url: `/quan-tri?orderId=${order.id}`,
    phone: order.phone,
    gpsUrl: mapsUrl(order.delivery_lat, order.delivery_lng),
  };
}

const escapeHtml = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 0979848405 → +84979848405: Telegram tự biến số dạng quốc tế thành nút gọi được. */
export const internationalPhone = (phone) => (/^0\d{9}$/.test(phone || '') ? `+84${phone.slice(1)}` : phone || '');

/** Tin Telegram (parse_mode HTML). Mọi dữ liệu khách nhập đều được thoát ký tự HTML. */
export function telegramText(order, siteOrigin) {
  const items = order.items.map((item) => {
    const tag = item.is_reward ? ' (quà đổi điểm)' : item.promo ? ' (quà khuyến mãi)' : '';
    return `• ${escapeHtml(item.product_name)}${tag} × ${item.quantity} ${escapeHtml(item.unit || '')} — ${formatMoney(item.price * item.quantity)}đ`;
  });
  const gps = mapsUrl(order.delivery_lat, order.delivery_lng);
  const lines = [
    `🌾 <b>ĐƠN HÀNG MỚI #${escapeHtml(order.code || order.id)}</b>${order.is_guest ? ' · mua nhanh' : ''}`,
    `👤 Khách: <b>${escapeHtml(order.receiver_name)}</b>`,
    `📞 Gọi: ${escapeHtml(internationalPhone(order.phone))}`,
    `🏠 Đ/c: ${escapeHtml(order.address)}`,
    gps ? `📍 <a href="${escapeHtml(gps)}">Mở vị trí khách trên Google Maps</a>` : '📍 Khách chưa ghim vị trí',
    `🕒 Giờ giao: ${escapeHtml(slotLabel(order.delivery_slot))}`,
    `💳 Thanh toán: ${order.payment_method === 'bank' ? 'Chuyển khoản (cửa hàng gửi thông tin sau khi xác nhận)' : 'Tiền mặt khi nhận hàng (COD)'}`,
    order.note ? `📝 Khách dặn: ${escapeHtml(order.note)}` : null,
    '🛒 Hàng:',
    ...items,
    `💰 <b>Tổng: ${formatMoney(order.total)}đ</b>`,
    siteOrigin ? `🔗 <a href="${escapeHtml(`${siteOrigin}/quan-tri?orderId=${order.id}`)}">Mở đơn trong trang quản trị</a>` : null,
  ];
  // Telegram giới hạn 4096 ký tự một tin.
  return lines.filter(Boolean).join('\n').slice(0, 4000);
}

const hostOf = (endpoint) => { try { return new URL(endpoint).host; } catch { return '?'; } };

/**
 * Mã hoá (aes128gcm) và ký VAPID bằng thư viện web-push, rồi gửi bằng fetch để tự cắt sau 5 giây.
 * Đơn mới phải tới ngay cả khi máy đang ngủ (Urgency: high); máy tắt nguồn thì dịch vụ push giữ
 * tối đa 24 giờ (TTL 86400).
 */
async function deliver(row, body, vapid) {
  const request = webpush.generateRequestDetails(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    body,
    { TTL: 86400, urgency: 'high', vapidDetails: vapid },
  );
  const headers = { ...request.headers };
  delete headers['Content-Length'];   // fetch tự tính
  const response = await fetch(request.endpoint, {
    method: request.method, headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (response.status >= 200 && response.status < 300) return response.status;
  const detail = await response.text().catch(() => '');
  throw Object.assign(new Error(`Push service responded ${response.status}: ${detail.slice(0, 120)}`), { statusCode: response.status });
}

/**
 * Gửi một thông báo tới các máy quản trị. `endpoint` = chỉ gửi tới đúng máy đó (nút thử).
 * Máy đã huỷ đăng ký (404/410) bị xoá khỏi danh sách. Trả { configured, sent, failed, removed }.
 */
export async function sendPushToAdmins(payload, { endpoint, userId } = {}) {
  const vapid = vapidConfig();
  if (!vapid) return { configured: false, sent: 0, failed: 0, removed: 0 };
  // Chỉ gửi cho tài khoản còn là quản trị và chưa bị khoá — không phụ thuộc phiên đăng nhập.
  const where = ["u.role = 'admin'", 'u.is_locked = 0'];
  const args = [];
  if (endpoint) { where.push('s.endpoint = ?'); args.push(endpoint); }
  if (userId) { where.push('s.user_id = ?'); args.push(userId); }
  const rows = db.prepare(`
    SELECT s.id, s.endpoint, s.p256dh, s.auth FROM admin_push_subscriptions s
    JOIN users u ON u.id = s.user_id WHERE ${where.join(' AND ')}
  `).all(...args).filter((row) => pushEndpointAllowed(row.endpoint));

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(rows.map((row) => deliver(row, body, vapid)));

  const summary = { configured: true, sent: 0, failed: 0, removed: 0 };
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') { summary.sent += 1; return; }
    const status = result.reason?.statusCode;
    if (status === 404 || status === 410) {
      db.prepare('DELETE FROM admin_push_subscriptions WHERE id = ?').run(rows[index].id);
      summary.removed += 1;
      return;
    }
    summary.failed += 1;
    // Không ghi endpoint (là địa chỉ bí mật của máy) hay nội dung đơn vào log.
    console.error({ event: 'push_failed', host: hostOf(rows[index].endpoint), status: status ?? null,
      message: String(result.reason?.message || '').slice(0, 160) });
  });
  return summary;
}

export async function sendTelegram(text) {
  if (!telegramConfigured()) return { configured: false, sent: false };
  const base = testOrigin('TELEGRAM_TEST_ORIGIN') || 'https://api.telegram.org';
  try {
    const response = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Telegram trả mô tả lỗi; không ghi token (nằm trong URL) vào log.
      const detail = await response.json().catch(() => ({}));
      console.error({ event: 'telegram_failed', status: response.status, message: String(detail.description || '').slice(0, 160) });
    }
    return { configured: true, sent: response.ok };
  } catch (err) {
    console.error({ event: 'telegram_failed', name: err?.name, message: String(err?.message || '').slice(0, 160) });
    return { configured: true, sent: false };
  }
}

/** Địa chỉ trang dùng cho liên kết trong tin Telegram. */
export function siteOrigin(req) {
  const configured = (env.PUBLIC_SITE_URL || env.VITE_SITE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const host = req?.get?.('host');
  return host ? `${req.protocol}://${host}` : '';
}

/**
 * Gọi ngay sau khi đơn đã lưu (transaction đã commit) và CHỜ xong trước khi trả lời khách, vì trên
 * Vercel hàm có thể bị dừng ngay sau khi trả lời. Mỗi lần gửi tự cắt sau 5 giây.
 */
export async function notifyNewOrder(orderId, { origin } = {}) {
  try {
    const order = orderForNotice(orderId);
    if (!order) return null;
    const [push, telegram] = await Promise.allSettled([
      sendPushToAdmins(orderPushPayload(order)),
      sendTelegram(telegramText(order, origin)),
    ]);
    return { push: push.value ?? null, telegram: telegram.value ?? null };
  } catch (err) {
    console.error({ event: 'notify_failed', name: err?.name, message: String(err?.message || '').slice(0, 160) });
    return null;
  }
}
