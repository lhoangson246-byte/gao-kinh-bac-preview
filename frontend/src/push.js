import { api } from './api';

/**
 * Đăng ký thông báo đẩy (Web Push) cho máy quản trị: máy chủ gửi qua dịch vụ push của trình duyệt
 * (Google FCM trên Android), service worker (public/sw.js) hiện thông báo kể cả khi màn hình tắt
 * hoặc đã đóng app.
 */
export const pushSupported = () => typeof window !== 'undefined' && window.isSecureContext
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const toBytes = (base64url) => {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const sameKey = (buffer, base64url) => {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = toBytes(base64url);
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

/** Bản build thật đăng ký service worker lúc tải trang (main.jsx); máy dev thì đăng ký khi cần. */
async function registration() {
  if (!(await navigator.serviceWorker.getRegistration('/'))) await navigator.serviceWorker.register('/sw.js');
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker chưa sẵn sàng. Tải lại trang rồi thử lại.')), 15_000)),
  ]);
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Trạng thái đọc ngay trên máy, không cần mạng: 'unsupported' | 'denied' | 'on' | 'off'. */
export async function localPushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/**
 * Bật (ask = true, sau khi bấm nút) hoặc âm thầm đăng ký lại khi mở app (ask = false, chỉ khi đã
 * được cho phép). Khoá máy chủ đổi thì huỷ đăng ký cũ để đăng ký lại với khoá mới.
 * Trả { state, telegram, endpoint }.
 */
export async function connectPush({ ask }) {
  if (!pushSupported()) return { state: 'unsupported' };
  let permission = Notification.permission;
  if (permission === 'denied') return { state: 'denied' };
  if (permission !== 'granted') {
    if (!ask) return { state: 'off' };
    permission = await Notification.requestPermission();
    if (permission !== 'granted') return { state: permission === 'denied' ? 'denied' : 'off' };
  }
  const { publicKey, telegram } = await api.pushConfig();
  if (!publicKey) return { state: 'unconfigured', telegram };
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  let oldEndpoint = null;
  if (sub && !sameKey(sub.options?.applicationServerKey, publicKey)) {
    oldEndpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) });
  await api.pushSubscribe(sub.toJSON(), oldEndpoint);
  return { state: 'on', telegram, endpoint: sub.endpoint };
}

/** Tắt trên máy này: báo máy chủ ngừng gửi, rồi huỷ đăng ký với trình duyệt. */
export async function disconnectPush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}

export async function sendTestPush() {
  const sub = await currentSubscription();
  return api.pushTest(sub?.endpoint || null);
}

/** Lời báo dễ hiểu cho các lỗi thường gặp khi bật thông báo. */
export function pushErrorMessage(err) {
  if (err?.status != null) return err.message;
  if (err?.name === 'NotAllowedError') return 'Trình duyệt không cho phép thông báo. Mở cài đặt trang (biểu tượng ổ khoá) → Thông báo → Cho phép.';
  if (err?.name === 'AbortError' || err?.name === 'InvalidStateError') {
    return 'Không kết nối được dịch vụ thông báo của trình duyệt. Kiểm tra mạng, mở bằng Chrome rồi thử lại.';
  }
  return err?.message || 'Chưa bật được thông báo. Vui lòng thử lại.';
}
