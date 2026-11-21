import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

export const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function run(script, env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: backend, env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (v) => { output += v; });
    child.stderr.on('data', (v) => { output += v; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

export async function fixture(overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gao-security-'));
  const env = {
    ...process.env, DOTENV_CONFIG_PATH: path.join(directory, 'absent.env'),
    DATA_DIR: directory, NODE_ENV: 'production', PORT: '0', TRUST_PROXY: '0',
    // Bắt lỗi chỉ xảy ra trên Turso: câu lệnh chuẩn bị ngoài transaction.
    DB_STRICT_TRANSACTIONS: '1',
    // Kiểm thử không gọi ra mạng để mở link Google Maps rút gọn.
    GEO_RESOLVE: '0',
    // Bộ kiểm thử tạo hàng chục tài khoản / đơn từ cùng một IP trong vài giây: nới các ngưỡng chống flood.
    // security.mjs có bài riêng đặt lại ngưỡng chặt để chứng minh bị chặn (21/11/2026).
    REGISTER_LIMIT_PER_HOUR: '1000', TRACK_LIMIT_PER_15M: '1000', TRANSFER_PROOF_LIMIT_PER_15M: '1000',
    REGISTRATION_BREAKER_PER_5M: '100000', GUEST_PENDING_BREAKER_PER_10M: '100000', GUEST_SAME_CONTACT_PENDING: '100000',
    TURSO_DATABASE_URL: '', LIBSQL_URL: '', TURSO_AUTH_TOKEN: '', LIBSQL_AUTH_TOKEN: '',
    VERCEL: '', VERCEL_ENV: '', PREVIEW_TURSO_DATABASE_URL: '', PREVIEW_TURSO_AUTH_TOKEN: '',
    CLIENT_ORIGIN: 'https://shop.example', COOKIE_SAME_SITE: 'lax', SERVE_FRONTEND: 'false',
    JWT_SECRET: randomBytes(48).toString('hex'), ADMIN_EMAIL: 'audit-admin@example.com',
    ADMIN_PASSWORD: randomBytes(24).toString('hex'), ...overrides,
  };
  let server;
  async function close() {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit'); server.kill(); await exited;
    }
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('gao-security-')) throw new Error('Unsafe cleanup target');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  try {
    const seed = await run('src/seed.js', env);
    if (seed.code !== 0) throw new Error(seed.output);
    server = fork(path.join(backend, 'src/server.js'), [], { cwd: backend, env, execArgv: [], silent: true, windowsHide: true });
    let logs = '';
    server.stderr.on('data', (v) => { logs += v; });
    server.stdout.on('data', (v) => { logs += v; });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 15000);
      server.once('message', (v) => { clearTimeout(timer); resolve(v.port); });
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    // Như trình duyệt thật: luôn gửi X-CSRF-Protection: 1. Bài kiểm thử cố ý bỏ header thì truyền
    // headers: { 'X-CSRF-Protection': '' } (giá trị rỗng = không gửi).
    async function call(route, { method = 'GET', body, token, headers = {}, raw } = {}) {
      const merged = { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
      for (const [key, value] of Object.entries(merged)) if (value === '' || value == null) delete merged[key];
      const response = await fetch(`${base}/api${route}`, {
        method, headers: merged,
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      return { status: response.status, data: await response.json().catch(() => ({})), headers: response.headers };
    }
    return { directory, env, base, call, close };
  } catch (err) { await close(); throw err; }
}
