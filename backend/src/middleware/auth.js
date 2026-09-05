import jwt from 'jsonwebtoken';
import db from '../db.js';

const DEV_SECRET = 'gao_nha_minh_dev_secret_khong_dung_that';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  // Không cho phép chạy production với chuỗi bí mật mặc định.
  throw new Error('Thiếu biến môi trường JWT_SECRET. Hãy đặt một chuỗi bí mật dài và ngẫu nhiên.');
}
if (!isProduction && !process.env.JWT_SECRET) {
  console.warn('⚠️  Chưa đặt JWT_SECRET — đang dùng chuỗi tạm cho môi trường phát triển.');
}

const SECRET = process.env.JWT_SECRET || DEV_SECRET;

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/** Bắt buộc đăng nhập */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ message: 'Bạn cần đăng nhập.' });

  try {
    const payload = jwt.verify(token, SECRET);
    // Luôn đọc lại vai trò từ cơ sở dữ liệu, không tin vai trò ghi trong token.
    const user = db
      .prepare('SELECT id, full_name, email, phone, address, role FROM users WHERE id = ?')
      .get(payload.id);
    if (!user) return res.status(401).json({ message: 'Tài khoản không tồn tại.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
  }
}

/** Bắt buộc là admin (dùng sau requireAuth) */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Bạn không có quyền truy cập.' });
  }
  next();
}
