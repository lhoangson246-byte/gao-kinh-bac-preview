import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const siteUrl = (env.VITE_SITE_URL || '').replace(/\/$/, '');

  return {
    plugins: [
      react(),
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
      port: 5173,
      proxy: {
        // Gọi /api/... từ frontend sẽ được chuyển sang backend cổng 4000
        '/api': 'http://localhost:4000',
      },
    },
  };
});
