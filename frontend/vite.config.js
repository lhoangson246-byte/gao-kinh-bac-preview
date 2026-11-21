import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// CSP máy dev (giống vercel.json, nới thêm script nội tuyến và WebSocket cho tải lại nóng).
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "connect-src 'self' https: ws: wss:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
// Trang quản trị được nạp Google Maps cho Bản đồ điều phối (21/11/2026) — giống luật "/quan-tri(.*)" trong vercel.json.
const DEV_ADMIN_CSP = DEV_CSP
  .replace("script-src 'self'", "script-src 'self' https://maps.googleapis.com https://maps.gstatic.com")
  .replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com")
  .replace("img-src 'self' https: data:", "img-src 'self' https: data: blob:")
  .replace("font-src 'self'", "font-src 'self' https://fonts.gstatic.com")
  + "; worker-src 'self' blob:; frame-src https://*.google.com";
const adminCsp = (req, res, next) => {
  if (/^\/quan-tri(\/|\?|$)/.test(req.url || '')) {
    const writeHead = res.writeHead;
    res.writeHead = function patched(...args) {
      res.setHeader('Content-Security-Policy', DEV_ADMIN_CSP);
      return writeHead.apply(this, args);
    };
  }
  next();
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const siteUrl = (env.VITE_SITE_URL || '').replace(/\/$/, '');
  for (const value of [siteUrl, env.VITE_API_URL].filter(Boolean)) {
    const parsed = new URL(value);
    if (parsed.origin !== value || !['http:', 'https:'].includes(parsed.protocol)
        || (mode === 'production' && parsed.protocol !== 'https:')) {
      throw new Error('VITE_SITE_URL and VITE_API_URL must be exact origins (HTTPS for production).');
    }
  }

  return {
    plugins: [
      react(),
      {
        name: 'gao-admin-maps-csp',
        configureServer(server) { server.middlewares.use(adminCsp); },
        configurePreviewServer(server) { server.middlewares.use(adminCsp); },
      },
      {
        name: 'gao-kinh-bac-social-preview',
        transformIndexHtml(html) {
          // Chỉ thêm khi đã biết địa chỉ thật của trang — thẻ og:image bắt buộc dùng URL tuyệt đối.
          if (!siteUrl) return html;
          const imageUrl = `${siteUrl}/og.png`;
          return html.replace(
            '</head>',
            `    <meta property="og:url" content="${siteUrl}/" />\n` +
            `    <meta property="og:image" content="${imageUrl}" />\n` +
            '    <meta property="og:image:width" content="1200" />\n' +
            '    <meta property="og:image:height" content="630" />\n' +
            '    <meta property="og:image:alt" content="Gạo Kinh Bắc — gạo ngon giao tận nhà tại Bắc Ninh" />\n' +
            `    <meta name="twitter:image" content="${imageUrl}" />\n` +
            '  </head>'
          );
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      // Gửi cùng Content-Security-Policy với bản đã triển khai (xem vercel.json),
      // để những gì bị chặn trên Vercel cũng bị chặn ngay ở máy. Trước đây máy dev
      // không có CSP nên ô chọn ảnh dùng "blob:" chạy tốt ở đây mà hỏng khi lên
      // Vercel. Chỉ nới đúng những thứ máy chủ dev cần: script nội tuyến và
      // WebSocket cho tải lại nóng.
      headers: { 'Content-Security-Policy': DEV_CSP },
      proxy: {
        // Gọi /api/... từ frontend sẽ được chuyển sang backend cổng 4000
        '/api': 'http://localhost:4000',
      },
    },
  };
});
