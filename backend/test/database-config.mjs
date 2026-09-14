import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDatabaseConfig } from '../src/database-config.js';

test('uses the environment names created by the Vercel Turso integration', () => {
  assert.deepEqual(resolveDatabaseConfig({
    VERCEL: '1',
    TURSO_DATABASE_URL: ' libsql://shop.turso.io ',
    TURSO_AUTH_TOKEN: ' token ',
  }), {
    url: 'libsql://shop.turso.io',
    authToken: 'token',
    isRemote: true,
  });
});

test('keeps the legacy LIBSQL environment names working', () => {
  assert.deepEqual(resolveDatabaseConfig({
    LIBSQL_URL: 'file:local.db',
    LIBSQL_AUTH_TOKEN: 'legacy-token',
  }), {
    url: 'file:local.db',
    authToken: 'legacy-token',
    isRemote: true,
  });
});

test('does not silently use an ephemeral SQLite file on Vercel', () => {
  assert.throws(
    () => resolveDatabaseConfig({ VERCEL_ENV: 'production' }),
    /Persistent database is not configured for Vercel/
  );
});

test('requires a token for a remote libsql URL', () => {
  assert.throws(
    () => resolveDatabaseConfig({ TURSO_DATABASE_URL: 'libsql://shop.turso.io' }),
    /TURSO_AUTH_TOKEN/
  );
});

test('allows local development to use the SQLite file', () => {
  assert.deepEqual(resolveDatabaseConfig({ NODE_ENV: 'development' }), {
    url: '',
    authToken: '',
    isRemote: false,
  });
});

test('Preview fails closed without a separate database or when it reuses Production', () => {
  assert.throws(() => resolveDatabaseConfig({ VERCEL_ENV: 'preview', LIBSQL_URL: 'libsql://prod.turso.io', LIBSQL_AUTH_TOKEN: 'x' }), /Preview/);
  assert.throws(() => resolveDatabaseConfig({ VERCEL_ENV: 'preview', LIBSQL_URL: 'libsql://prod.turso.io', PREVIEW_TURSO_DATABASE_URL: 'libsql://prod.turso.io/' }), /Preview/);
  assert.deepEqual(resolveDatabaseConfig({ VERCEL_ENV: 'preview', LIBSQL_URL: 'libsql://prod.turso.io', LIBSQL_AUTH_TOKEN: 'prod-token',
    PREVIEW_TURSO_DATABASE_URL: 'libsql://preview.turso.io', PREVIEW_TURSO_AUTH_TOKEN: 'preview-token' }),
  { url: 'libsql://preview.turso.io', authToken: 'preview-token', isRemote: true });
});

test('Actual Vercel deployments reject local database files', () => {
  assert.throws(() => resolveDatabaseConfig({ VERCEL_ENV: 'production', LIBSQL_URL: 'file:temp.db' }), /persistent remote/);
});
