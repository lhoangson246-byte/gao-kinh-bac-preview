import { GOOGLE_MAPS_API_KEY, hasGoogleMapsKey } from '../mapConfig.js';

/**
 * Nạp Google Maps JavaScript API một lần cho cả trang (21/11/2026).
 * Trả về Promise<google.maps>; lỗi (chưa có khoá, khoá sai, mất mạng, chính sách bảo mật chặn) thì Promise
 * bị từ chối để bản đồ chuyển sang chế độ mô phỏng.
 */
let loading = null;
const authListeners = new Set();
/** Báo khi Google từ chối khoá (có thể xảy ra cả SAU khi bản đồ đã hiện) để chuyển sang mô phỏng. */
export function onMapsAuthFailure(callback) {
  authListeners.add(callback);
  return () => authListeners.delete(callback);
}

/** Khoá dùng: khoá chủ cửa hàng dán ở Quản trị → CẬP NHẬT (máy chủ gửi kèm), không có thì khoá lúc build. */
export const effectiveMapsKey = (runtimeKey) => (runtimeKey || (hasGoogleMapsKey() ? GOOGLE_MAPS_API_KEY : ''));

export function loadGoogleMaps({ key: runtimeKey, timeoutMs = 12000 } = {}) {
  const key = effectiveMapsKey(runtimeKey);
  if (!key) return Promise.reject(new Error('Chưa điền khoá Google Maps (YOUR_GOOGLE_MAPS_API_KEY).'));
  if (window.google?.maps?.OverlayView) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const fail = (message) => { loading = null; reject(new Error(message)); };
    const timer = window.setTimeout(() => fail('Google Maps không phản hồi.'), timeoutMs);
    // Google gọi hàm này khi khoá sai / chưa bật thanh toán / tên miền không được phép.
    window.gm_authFailure = () => {
      const message = 'Khoá Google Maps bị từ chối (kiểm tra khoá, thanh toán và tên miền được phép).';
      window.clearTimeout(timer);
      fail(message);
      for (const callback of authListeners) callback(message);
    };
    const callback = `__gaoMapsReady${Date.now()}`;
    window[callback] = () => {
      window.clearTimeout(timer);
      delete window[callback];
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=vi&region=VN&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => { window.clearTimeout(timer); script.remove(); fail('Không tải được Google Maps (mất mạng hoặc trang chặn — thử tải lại trang).'); };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Ghim HTML trên Google Maps: một thẻ <div> đặt đúng toạ độ, nội dung do React vẽ vào (createPortal) nên
 * ghim trên bản đồ thật và bản đồ mô phỏng trông giống nhau. Tạo lớp sau khi Google Maps đã nạp.
 */
export function createHtmlMarkerClass(maps) {
  return class HtmlMarker extends maps.OverlayView {
    constructor(position, element, zIndex = 1) {
      super();
      this.position = position;
      this.element = element;
      this.element.style.position = 'absolute';
      this.element.style.zIndex = String(zIndex);
      // Bấm vào ghim không làm bản đồ kéo / phóng to.
      maps.OverlayView.preventMapHitsAndGesturesFrom(this.element);
    }

    onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.element); }

    draw() {
      const projection = this.getProjection();
      const point = projection && projection.fromLatLngToDivPixel(new maps.LatLng(this.position.lat, this.position.lng));
      if (!point) return;
      this.element.style.left = `${point.x}px`;
      this.element.style.top = `${point.y}px`;
    }

    onRemove() { this.element.remove(); }

    setPosition(position) {
      this.position = position;
      this.draw();
    }
  };
}
