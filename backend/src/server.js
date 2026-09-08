import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import addressRoutes from './routes/addresses.js';
import adminRoutes from './routes/admin.js';
import retailRoutes from './routes/retail.js';
import customerRoutes from './routes/customers.js';
import { HttpError } from './validate.js';
import imageRoutes from './routes/images.js';
import { trustedProxy, originAllowed, protectBrowserRequests } from './security.js';
import { createHash } from 'node:crypto';
import { normalizePhone } from './validate.js';
import { rejectDefaultAdministrator } from './admin-security.js';

if (process.env.NODE_ENV === 'production') rejectDefaultAdministrator();

const app = express();

app.disable('x-powered-by');
// Khi chạy sau proxy (Railway, Render, Nginx…) cần bật để rate limit đọc đúng IP thật.
app.set('trust proxy', trustedProxy(process.env.TRUST_PROXY));

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(protectBrowserRequests);
app.use(cors((req, callback) => callback(null, {
  origin: originAllowed(req, req.get('origin')), credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Mode', 'X-CSRF-Protection'],
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
})));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const limiterOptions = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.' },
};

// Giới hạn chặt cho đăng nhập và đăng ký để chống dò mật khẩu.
const authLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60 * 1000, limit: 20 });
// Giới hạn rộng cho phần còn lại, đủ thoải mái cho người dùng bình thường.
const apiLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60 * 1000, limit: 600 });
// Chặn việc tạo đơn hàng liên tục bất thường.
const orderLimiter = rateLimit({ ...limiterOptions, windowMs: 60 * 60 * 1000, limit: 40 });

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Gạo Kinh Bắc API' }));

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/password', authLimiter);
// Ảnh gửi lên dưới dạng nhị phân, gắn trước express.json để bộ đọc JSON không nuốt mất.
app.use('/api', imageRoutes);
app.use(express.json({ limit: '100kb' }));
// Keep one account protected even when attempts arrive from different IPs.
const accountLimiter = rateLimit({
  ...limiterOptions, windowMs: 15 * 60 * 1000, limit: 15,
  keyGenerator: (req) => {
    const input = req.body?.identifier ?? req.body?.phone ?? req.body?.email;
    const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';
    return createHash('sha256').update(normalizePhone(raw) || raw).digest('hex');
  },
});
app.use('/api/auth/login', accountLimiter);
app.post('/api/orders', orderLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin/customers', customerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/retail', retailRoutes);

// Render preview deploys run the React app and API together. Keeping this
// opt-in means local development can continue to use Vite's dev server.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');
if (process.env.SERVE_FRONTEND === 'true' && fs.existsSync(frontendIndex)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    return res.sendFile(frontendIndex);
  });
}

app.use((req, res) => res.status(404).json({ message: 'Không tìm thấy đường dẫn API.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Dữ liệu gửi lên quá lớn.' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ message: 'Dữ liệu gửi lên không đọc được.' });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ message: 'Thông tin đã tồn tại. Vui lòng kiểm tra lại.' });
  }
  // Chỉ ghi log ở máy chủ, không trả chi tiết lỗi về cho trình duyệt.
  // Do not log request bodies, SQL values, cookies, or credentials.
  console.error({ event: 'request_error', name: err?.name, code: err?.code });
  res.status(500).json({ message: 'Lỗi máy chủ. Vui lòng thử lại.' });
});

export default app;

// Vercel imports the Express app as a function. The local server is only
// started when this file is run directly (npm start / npm run dev).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const PORT = process.env.PORT || 4000;
  const server = app.listen(PORT, () => {
    console.log(`API listening on port ${server.address().port}`);
    if (process.send) process.send({ port: server.address().port });
  });
}
