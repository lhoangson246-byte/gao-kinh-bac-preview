import jwt from 'jsonwebtoken';
import db from '../db.js';

import { JWT_SECRET as SECRET, JWT_OPTIONS, sessionCookie } from '../security.js';

export function signToken(user) {
  const row = db.prepare('SELECT session_version FROM users WHERE id = ?').get(user.id);
  return jwt.sign({ id: user.id, version: row.session_version }, SECRET, JWT_OPTIONS);
}

/** Bắt buộc đăng nhập */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header ? (header.startsWith('Bearer ') ? header.slice(7).trim() : null) : sessionCookie(req);
  if (!token || token.length > 4096) return res.status(401).json({ message: 'Bạn cần đăng nhập.' });

  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'], issuer: JWT_OPTIONS.issuer, audience: JWT_OPTIONS.audience, maxAge: '1h' });
    if (!Number.isSafeInteger(payload.id) || payload.id < 1 || !Number.isSafeInteger(payload.version) || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)) throw new Error('Invalid claims');
    // Luôn đọc lại vai trò từ cơ sở dữ liệu, không tin vai trò ghi trong token.
    const user = db
      .prepare('SELECT id, full_name, email, phone, address, role, is_locked, session_version FROM users WHERE id = ?')
      .get(payload.id);
    if (!user) return res.status(401).json({ message: 'Tài khoản không tồn tại.' });
    // Tài khoản bị cửa hàng khoá thì token cũ cũng hết tác dụng ngay.
    if (user.is_locked) {
      return res.status(403).json({ message: 'Tài khoản đã bị khoá. Vui lòng liên hệ cửa hàng.' });
    }
    if (payload.version !== user.session_version) throw new Error('Revoked session');
    delete user.session_version;
    delete user.is_locked;
    req.user = user;
  } catch {
    return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
  }
  next();
}

/** Bắt buộc là admin (dùng sau requireAuth) */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Bạn không có quyền truy cập.' });
  }
  next();
}
