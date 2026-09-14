import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDatabaseConfig } from './database-config.js';

export async function openDatabase(env = process.env) {
  const config = resolveDatabaseConfig(env);
  if (config.isRemote) {
    const { default: Database } = await import('libsql');
    const db = new Database(config.url, { authToken: config.authToken });
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  }
  const { default: Database } = await import('better-sqlite3');
  const directory = env.DATA_DIR ? path.resolve(env.DATA_DIR)
    : fileURLToPath(new URL('../data/', import.meta.url));
  fs.mkdirSync(directory, { recursive: true });
  const db = new Database(path.join(directory, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
