const firstValue = (...values) => {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized) return normalized;
  }
  return '';
};

/**
 * Resolve the persistent database credentials.
 *
 * The Turso integration in Vercel creates TURSO_DATABASE_URL and
 * TURSO_AUTH_TOKEN. LIBSQL_* remains supported for manually configured
 * deployments and backwards compatibility.
 */
export function resolveDatabaseConfig(env = process.env) {
  let url = firstValue(env.TURSO_DATABASE_URL, env.LIBSQL_URL);
  let authToken = firstValue(env.TURSO_AUTH_TOKEN, env.LIBSQL_AUTH_TOKEN);
  const isVercel = firstValue(env.VERCEL, env.VERCEL_ENV) !== '';
  if (env.VERCEL_ENV === 'preview') {
    const previewUrl = firstValue(env.PREVIEW_TURSO_DATABASE_URL);
    if (!previewUrl || previewUrl.replace(/\/$/, '').toLowerCase() === url.replace(/\/$/, '').toLowerCase()) {
      throw new Error('Preview cần database riêng. Set PREVIEW_TURSO_DATABASE_URL and PREVIEW_TURSO_AUTH_TOKEN; never reuse the Production database.');
    }
    url = previewUrl;
    authToken = firstValue(env.PREVIEW_TURSO_AUTH_TOKEN);
  }
  if (['production', 'preview'].includes(env.VERCEL_ENV) && url && !/^(libsql|https):\/\//.test(url)) {
    throw new Error('Không dùng SQLite tạm trên Vercel. A persistent remote database is required.');
  }

  if (isVercel && !url) {
    throw new Error(
      'Persistent database is not configured for Vercel. Connect a Turso database ' +
      'or set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, then redeploy.'
    );
  }

  if (url.startsWith('libsql://') && !authToken) {
    throw new Error(
      'TURSO_AUTH_TOKEN (or LIBSQL_AUTH_TOKEN) is required for the remote libSQL database.'
    );
  }

  return { url, authToken, isRemote: Boolean(url) };
}
