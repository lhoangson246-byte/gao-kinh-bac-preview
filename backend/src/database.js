import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDatabaseConfig } from './database-config.js';

/**
 * Chế độ kiểm thử (DB_STRICT_TRANSACTIONS=1): báo lỗi khi một câu lệnh được
 * db.prepare() NGOÀI một transaction nhưng lại chạy BÊN TRONG nó.
 *
 * Trên Turso (libSQL qua HTTP), câu lệnh như vậy không chạy cùng phiên với
 * transaction nên thao tác ghi thất bại với "Lỗi máy chủ". better-sqlite3 ở máy
 * thì chạy bình thường, nên nếu không có lớp kiểm tra này, lỗi chỉ lộ ra sau
 * khi đã triển khai.
 */
function guardTransactions(db) {
  let depth = 0;
  let generation = 0;

  const transaction = db.transaction.bind(db);
  db.transaction = (fn) => transaction((...args) => {
    // Chỉ transaction ngoài cùng mở phiên mới; transaction lồng dùng chung phiên.
    if (depth === 0) generation++;
    depth++;
    try { return fn(...args); } finally { depth--; }
  });

  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const preparedIn = depth > 0 ? generation : 0;
    for (const method of ['run', 'get', 'all', 'iterate']) {
      const original = statement[method];
      if (typeof original !== 'function') continue;
      statement[method] = function guarded(...args) {
        if (depth > 0 && preparedIn !== generation) {
          throw new Error('Câu lệnh được chuẩn bị ngoài transaction nhưng chạy bên trong (sẽ lỗi trên Turso): '
            + String(sql).replace(/\s+/g, ' ').trim().slice(0, 90));
        }
        return original.apply(this, args);
      };
    }
    return statement;
  };
  return db;
}

export async function openDatabase(env = process.env) {
  const config = resolveDatabaseConfig(env);
  const strict = env.DB_STRICT_TRANSACTIONS === '1';
  if (config.isRemote) {
    const { default: Database } = await import('libsql');
    const db = new Database(config.url, { authToken: config.authToken });
    db.exec('PRAGMA foreign_keys = ON');
    return strict ? guardTransactions(db) : db;
  }
  const { default: Database } = await import('better-sqlite3');
  const directory = env.DATA_DIR ? path.resolve(env.DATA_DIR)
    : fileURLToPath(new URL('../data/', import.meta.url));
  fs.mkdirSync(directory, { recursive: true });
  const db = new Database(path.join(directory, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return strict ? guardTransactions(db) : db;
}
