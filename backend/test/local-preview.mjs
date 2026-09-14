// Bản kiểm giao diện dùng database tạm; tuyệt đối không dùng dữ liệu cửa hàng.
import { fixture } from './fixture.mjs';
const app = await fixture({
  PORT: process.env.QA_PORT || '4000', SERVE_FRONTEND: 'true',
  ADMIN_EMAIL: 'qa-admin@example.com', ADMIN_PASSWORD: 'Local-QA-only-2026!',
});
console.log('Bản kiểm giao diện: ' + app.base);
process.on('SIGINT', async () => { await app.close(); process.exit(); });
process.on('SIGTERM', async () => { await app.close(); process.exit(); });
await new Promise(() => {});
