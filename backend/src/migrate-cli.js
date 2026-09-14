import 'dotenv/config';
import { openDatabase } from './database.js';
import { migrate } from './migrate.js';
import { SCHEMA_VERSION } from './schema-version.js';

// Build Preview không được chạy migration, dù bị gán nhầm biến Production.
if (process.argv.includes('--deploy') && process.env.VERCEL_ENV !== 'production') {
  console.log('Bỏ qua migration: đây không phải deployment Production.');
} else {
  if (process.env.VERCEL_ENV === 'preview') throw new Error('Không chạy migration trong Preview. Migrate the separate preview database explicitly outside the build.');
  const db = await openDatabase();
  try {
    migrate(db);
    console.log('Đã cập nhật cơ sở dữ liệu: ' + SCHEMA_VERSION);
  } finally { db.close(); }
}
