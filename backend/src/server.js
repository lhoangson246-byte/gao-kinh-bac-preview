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
import { HttpError } from './validate.js';

const app = express();

const allowedOrigins = process.env.CLIENT_ORIGIN
  ?.split(',').map((origin) => origin.trim()).filter(Boolean);

app.disable('x-powered-by');
// Khi chạy sau proxy (Railway, Render, Nginx…) cần bật để rate limit đọc đúng IP thật.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: allowedOrigins?.length ? allowedOrigins : true }));
app.use(express.json({ limit: '100kb' }));

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
app.post('/api/orders', orderLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
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
  // Chỉ ghi log ở máy chủ, không trả chi tiết lỗi về cho trình duyệt.
  console.error(err);
  res.status(500).json({ message: 'Lỗi máy chủ. Vui lòng thử lại.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🌾 API chạy tại http://localhost:${PORT}`));
