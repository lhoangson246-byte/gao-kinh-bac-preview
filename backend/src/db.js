import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { resolveDatabaseConfig } from './database-config.js';
import { SCHEMA_VERSION } from './schema-version.js';

const db = await openDatabase();
const config = resolveDatabaseConfig();
const localFile = !config.isRemote || config.url.startsWith('file:');
// Seed là thao tác quản trị có chủ đích; production thông thường chỉ đọc phiên bản.
const seeding = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(new URL('./seed.js', import.meta.url));
const autoMigrate = seeding || (localFile && process.env.NODE_ENV !== 'production' && !process.env.VERCEL && !process.env.VERCEL_ENV);
if (autoMigrate) {
  const { migrate } = await import('./migrate.js');
  migrate(db);
}

let state;
try {
  // Gộp kiểm tra schema và đọc hash admin vào một truy vấn khi khởi động.
  state = db.prepare(`SELECT
    (SELECT name FROM app_migrations WHERE name = ?) AS version,
    (SELECT json_group_array(password_hash) FROM users WHERE role = 'admin') AS admins`).get(SCHEMA_VERSION);
} catch (err) {
  db.close();
  throw new Error('Chưa thể kiểm tra schema. Chạy npm --prefix backend run migrate trước khi khởi động. Cannot read schema; run migrations before startup.', { cause: err });
}
if (state.version !== SCHEMA_VERSION) {
  db.close();
  throw new Error('Cơ sở dữ liệu chưa cập nhật. Chạy npm --prefix backend run migrate trước khi triển khai. Stale schema: run migrations before deployment.');
}
export const startupAdminHashes = JSON.parse(state.admins || '[]');
export default db;
