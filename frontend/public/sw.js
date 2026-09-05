// Service worker cho PWA "Gạo Kinh Bắc".
// Nguyên tắc: KHÔNG bao giờ lưu đệm dữ liệu API — giá, tồn kho và đơn hàng
// phải luôn lấy mới từ máy chủ.
const CACHE_NAME = 'gao-kinh-bac-v3';
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
  if (request.method !== 'GET' || isApiRequest(url) || !url.protocol.startsWith('http')) return;

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

  // Tài nguyên tĩnh cùng tên miền: dùng bản đã lưu trước, đồng thời tải bản mới.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
