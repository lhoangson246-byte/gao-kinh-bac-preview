import bcrypt from 'bcryptjs';
import db from './db.js';

export function rejectDefaultAdministrator() {
  const admins = db.prepare("SELECT password_hash FROM users WHERE role = 'admin'").all();
  if (admins.some((admin) => bcrypt.compareSync('admin123', admin.password_hash))) {
    throw new Error('An administrator still uses the documented default password. Set ADMIN_EMAIL and a new ADMIN_PASSWORD, then run npm run rotate:admin before production startup.');
  }
}
