import { randomBytes } from 'node:crypto';

const production = process.env.NODE_ENV === 'production';
const configuredSecret = process.env.JWT_SECRET;
if (configuredSecret && (Buffer.byteLength(configuredSecret) < 32 || /gao_nha_minh_dev_secret|doi_chuoi_bi_mat|change.?me|dat_mat_khau/i.test(configuredSecret))) {
  throw new Error('JWT_SECRET must contain at least 32 bytes and must not be a sample value.');
}
if (production && !configuredSecret) throw new Error('JWT_SECRET is required in production.');
export const JWT_SECRET = configuredSecret || randomBytes(48).toString('hex');
export const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'gao-shop', audience: 'gao-shop-api', expiresIn: '1h' };
export const COOKIE_NAME = production ? '__Host-gao_session' : 'gao_session';
export const COOKIE_OPTIONS = {
  httpOnly: true, secure: production, path: '/',
  sameSite: process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'lax',
};
if (COOKIE_OPTIONS.sameSite === 'none' && !production) throw new Error('Cross-site cookies require production HTTPS.');

export function sessionCookie(req) {
  const matches = (req.headers.cookie || '').split(';').map((v) => v.trim())
    .filter((v) => v.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  try { return decodeURIComponent(matches[0].slice(COOKIE_NAME.length + 1)); } catch { return null; }
}

export function deliverSession(req, res, user, token, status = 200) {
  if (req.get('x-session-mode') === 'cookie') {
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 1000 });
    return res.status(status).json({ user });
  }
  return res.status(status).json({ user, token });
}

export function trustedProxy(value, env = process.env) {
  // Vercel luôn đặt đúng một tầng proxy trước hàm serverless và tự viết lại
  // X-Forwarded-For/Proto. Không tin tầng đó thì req.protocol luôn là "http"
  // (trong khi trình duyệt gửi Origin "https://…") nên mọi yêu cầu ghi bị chặn,
  // và giới hạn tần suất gom tất cả khách vào chung một địa chỉ IP nội bộ.
  if (value === undefined || value === null || value === '') {
    return env.VERCEL || env.VERCEL_ENV ? 1 : false;
  }
  if (value === '0' || value === 'false') return false;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 10) {
    throw new Error('TRUST_PROXY must be 0/false or an explicit hop count from 1 to 10.');
  }
  return Number(value);
}

const origins = (process.env.CLIENT_ORIGIN || (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
  .split(',').map((v) => v.trim()).filter(Boolean);
for (const origin of origins) {
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) {
    throw new Error('CLIENT_ORIGIN must list exact origins (HTTPS in production).');
  }
}
/**
 * true khi Origin trỏ về đúng tên miền đang phục vụ yêu cầu này.
 * So theo host chứ không so cả "giao thức://host": sau một proxy kết thúc TLS
 * (Vercel, Render, Nginx) thì req.protocol có thể là "http" trong khi trình
 * duyệt gửi Origin "https://…". Việc chống CSRF vẫn nguyên vẹn vì trang của
 * kẻ tấn công ở tên miền khác luôn gửi Origin với host khác.
 */
function sameHostOrigin(req, origin) {
  const host = req.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function originAllowed(req, origin) {
  return !origin || origins.includes(origin) || sameHostOrigin(req, origin);
}

// Custom headers force cross-origin browser requests through CORS preflight.
export function protectBrowserRequests(req, res, next) {
  if (!originAllowed(req, req.get('origin'))) return res.status(403).json({ message: 'Nguồn yêu cầu không được phép.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && (sessionCookie(req) || req.get('x-session-mode') === 'cookie')
      && req.get('x-csrf-protection') !== '1') {
    return res.status(403).json({ message: 'Yêu cầu thiếu bảo vệ CSRF.' });
  }
  next();
}
