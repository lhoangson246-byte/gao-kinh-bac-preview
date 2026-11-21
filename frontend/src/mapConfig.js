/**
 * ======================================================================================================
 *  KHOÁ GOOGLE MAPS — CHỈ SỬA Ở MỘT CHỖ NÀY
 * ======================================================================================================
 *  Bản đồ điều phối giao hàng (Quản trị → Đơn hàng → Bản đồ điều phối) dùng Google Maps JavaScript API.
 *
 *  Cách điền khoá (chọn 1 trong 2):
 *   1. Khuyên dùng: trên Vercel → Project → Settings → Environment Variables, thêm
 *        VITE_GOOGLE_MAPS_API_KEY = <khoá của chị>
 *      rồi bấm Redeploy. Khoá không nằm trong mã nguồn.
 *   2. Hoặc thay chữ YOUR_GOOGLE_MAPS_API_KEY ở dòng dưới bằng khoá rồi đưa lên lại.
 *
 *  Tạo khoá: https://console.cloud.google.com → APIs & Services → bật "Maps JavaScript API" → Credentials →
 *  Create API key. NÊN giới hạn khoá: Application restrictions = Websites, thêm
 *    https://gaokinhbac.com/*  và  https://www.gaokinhbac.com/*
 *  (khoá trình duyệt luôn nhìn thấy được trong trang, giới hạn tên miền để người khác không dùng ké được).
 *
 *  Chưa có khoá: bản đồ tự chuyển sang CHẾ ĐỘ MÔ PHỎNG (bản đồ sơ đồ vẽ ngay trong trang, vẫn có ghim đơn,
 *  shipper di chuyển, bấm xem chi tiết…) để thử giao diện ngay.
 * ======================================================================================================
 */
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY';

/** Đã điền khoá thật chưa (còn chữ mẫu hoặc để trống thì chưa). */
export const hasGoogleMapsKey = () => !!GOOGLE_MAPS_API_KEY && GOOGLE_MAPS_API_KEY !== 'YOUR_GOOGLE_MAPS_API_KEY';
