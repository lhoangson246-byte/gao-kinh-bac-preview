// Service worker cho PWA "Gạo Kinh Bắc".
// Nguyên tắc: KHÔNG bao giờ lưu đệm dữ liệu API — giá, tồn kho và đơn hàng
// phải luôn lấy mới từ máy chủ.
const CACHE_NAME = 'gao-kinh-bac-v5';
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
