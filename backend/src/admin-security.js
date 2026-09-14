import bcrypt from 'bcryptjs';
import { startupAdminHashes } from './db.js';

export function rejectDefaultAdministrator() {
  if (startupAdminHashes.some((hash) => bcrypt.compareSync('admin123', hash))) {
    throw new Error('An administrator still uses the documented default password. Set ADMIN_EMAIL and a new ADMIN_PASSWORD, then run npm run rotate:admin before production startup.');
  }
}
