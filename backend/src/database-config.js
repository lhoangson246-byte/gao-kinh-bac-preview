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
  const url = firstValue(env.TURSO_DATABASE_URL, env.LIBSQL_URL);
  const authToken = firstValue(env.TURSO_AUTH_TOKEN, env.LIBSQL_AUTH_TOKEN);
  const isVercel = firstValue(env.VERCEL, env.VERCEL_ENV) !== '';

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
