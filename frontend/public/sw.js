// Service worker cho PWA "Gạo Kinh Bắc".
// Nguyên tắc: KHÔNG bao giờ lưu đệm dữ liệu API — giá, tồn kho và đơn hàng
// phải luôn lấy mới từ máy chủ.
const CACHE_NAME = 'gao-kinh-bac-v6';
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Thiếu một tệp cũng không được làm hỏng cả bước cài đặt.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** true với mọi request tới API, dù API nằm ở tên miền khác. */
function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname === '/api';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Bỏ qua: không phải GET, request tới API, và các giao thức khác http(s).
  // Ngoại lệ duy nhất: ảnh upload có ID ngẫu nhiên, nội dung bất biến và công khai.
  const uploadedImage = url.origin === self.location.origin && /^\/api\/images\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(url.pathname);
  if (request.method !== 'GET' || (isApiRequest(url) && !uploadedImage) || !url.protocol.startsWith('http')) return;

  // Điều hướng trang: ưu tiên mạng, khi mất mạng mới dùng bản đã lưu.
  // Nhờ vậy mọi đường dẫn React Router đều mở được khi offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/', { ignoreSearch: true });
          return cached || new Response(
            '<!doctype html><meta charset="utf-8"><title>Không có mạng</title>' +
            '<body style="font-family:system-ui;padding:40px;text-align:center;background:#f6f1e7;color:#20251f">' +
            '<h1>Đang mất kết nối mạng</h1><p>Vui lòng kiểm tra kết nối rồi mở lại ứng dụng.</p></body>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // Assets có hash và ảnh upload bất biến: cache-first.
  // Ảnh/icon không có hash: trả cache sớm và thực sự cập nhật nền.
  if (url.origin === self.location.origin) {
    const immutable = url.pathname.startsWith('/assets/') || uploadedImage;
    const refresh = async () => {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    };
    const cachedPromise = caches.match(request);
    // Đăng ký waitUntil ngay trong sự kiện để worker sống tới khi cập nhật xong.
    const network = cachedPromise.then(cached => !cached || !immutable ? refresh() : null);
    event.waitUntil(network.catch(() => {}));
    event.respondWith(
      cachedPromise.then(cached => cached || network)
    );
  }
});

/* ------------------------------------------------------------------ *
 * Thông báo đẩy báo đơn mới (Web Push, VAPID). Máy chủ gửi qua dịch vụ
 * push của trình duyệt, nên vẫn báo khi điện thoại tắt màn hình hoặc đã
 * đóng app. Nội dung do backend/src/push.js soạn.
 * ------------------------------------------------------------------ */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const isOrder = data.kind === 'order';
  const tag = data.tag || (data.orderId ? `order-${data.orderId}` : 'gao-kinh-bac');
  const options = {
    body: data.body || 'Có thông báo mới từ cửa hàng.',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag,
    renotify: true,
    // Đơn mới (và tin thử) nằm lại trên màn hình cho tới khi chủ cửa hàng bấm vào hoặc gạt đi.
    requireInteraction: isOrder || data.kind === 'test',
    vibrate: [300, 100, 300, 100, 400, 100, 400],
    timestamp: Date.now(),
    data: { url: data.url || '/quan-tri', phone: data.phone || null, gpsUrl: data.gpsUrl || null, orderId: data.orderId || null },
    actions: isOrder ? [
      { action: 'confirm', title: '✅ Xem & Xác nhận đơn' },
      { action: 'call', title: '📞 Mở chi tiết' },
    ] : [],
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title || '🌾 Gạo Kinh Bắc', options),
    // App đang mở thì kêu chuông "xịch xing" ngay, không chờ lượt hỏi 20 giây.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => list.forEach((client) => client.postMessage({ type: 'gao:push', kind: data.kind || null, orderId: data.orderId || null }))),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || '/quan-tri', self.location.origin);
  // Chỉ mở trang của chính cửa hàng.
  if (target.origin !== self.location.origin) return;
  if (event.action === 'confirm' || event.action === 'call') target.searchParams.set('action', event.action);
  const path = target.pathname + target.search;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((c) => new URL(c.url).pathname.startsWith('/quan-tri')) || windows[0];
    if (client) {
      // App đang mở (kể cả chạy nền): đưa lên trước và chuyển tới đơn, không tải lại trang.
      await client.focus().catch(() => {});
      client.postMessage({ type: 'gao:open', url: path });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

// Trình duyệt tự làm mới đăng ký push (hiếm): báo máy chủ địa chỉ mới để không lỡ đơn.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old?.options?.applicationServerKey || event.newSubscription?.options?.applicationServerKey;
    const sub = event.newSubscription
      || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
    if (!sub) return;
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1' },
      body: JSON.stringify({ ...sub.toJSON(), old_endpoint: old?.endpoint || null }),
    });
  })().catch(() => {}));
});
