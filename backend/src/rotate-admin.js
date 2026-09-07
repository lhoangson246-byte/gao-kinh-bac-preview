import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { isEmail } from './validate.js';
import { newPassword } from './schemas.js';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!isEmail(email) || !newPassword.safeParse(password).success || /^(admin123|dat_mat_khau|change.?me)/i.test(password)) {
  throw new Error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes) in the private environment.');
}
const hash = await bcrypt.hash(password, 12);
const result = db.prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1
  WHERE email = ? AND role = 'admin'`).run(hash, email);
if (result.changes !== 1) throw new Error('No matching administrator. No account was changed.');
console.log('Administrator password rotated; all previous sessions revoked.');
db.close();
