# Application security audit — 6 September 2026

**The most urgent finding is an existing administrator using the publicly documented default password.** A read-only check of the local database confirmed one administrator with that password. No production host was attacked or inspected. The code now prevents new default accounts and refuses production startup with the old default credential, but the existing local account still needs rotation.

The audit covered the current working tree, including previously uncommitted features: all seven Express routers, authentication, validation, SQLite schema/migrations, seed scripts, loyalty/audit helpers, React pages/components, API client, PWA worker, Vite configuration, deployment configuration, and both dependency lockfiles. Existing application data and credentials were not changed. Tests used temporary databases and generated credentials. Changes are local and have not been deployed.

## Findings and rewrites

Severity describes practical impact with the stated prerequisites, not an assertion that every deployment is exposed.

### 1. Critical — default administrator credentials

**Evidence:** `backend/src/seed.js` originally defaulted to a documented admin email and `admin123`. `render.yaml` ran seed at startup without supplying admin credentials. The local database still accepts that documented password for its administrator.

**Exploit:** on a fresh deployment using those defaults, an anonymous attacker can log in as administrator and read customer addresses, reset customer passwords, change prices, and alter orders. An arbitrary strong JWT signing key does not prevent this login.

**Rewrite:** [seed.js](backend/src/seed.js) requires explicit strong bootstrap credentials for a new database. [admin-security.js](backend/src/admin-security.js) rejects the old default at production startup. [rotate-admin.js](backend/src/rotate-admin.js) updates only the explicitly selected administrator and revokes its sessions. Render requires operator-supplied credentials. Existing accounts are not silently overwritten by seed.

**Required action:** set the existing administrator email and a new unique password in the private environment, then run:

```sh
npm --prefix backend run rotate:admin
```

Changing `ADMIN_PASSWORD` and running ordinary seed does **not** rotate an existing account. If the default was ever publicly reachable, review customer-password resets and administrative activity as well as rotating credentials.

### 2. Critical when misconfigured — known JWT signing keys

**Evidence:** the old middleware had a hardcoded development key whenever `NODE_ENV` was not exactly `production` and `JWT_SECRET` was absent. Production checked only presence, so copying the sample environment's known key also passed.

**Exploit:** a known HMAC key lets an attacker sign a token with an administrator's database ID. Reloading the role from SQLite does not prevent impersonation of that ID.

**Rewrite:** [security.js](backend/src/security.js) rejects short keys and the known sample values; production requires a configured key. Development without a key uses fresh cryptographic randomness, never a shared fallback. [auth middleware](backend/src/middleware/auth.js) explicitly verifies HS256, issuer, audience, expiry, issued-at time, integer identity, and session version. Key length cannot prove entropy: generate the secret randomly rather than choosing a phrase.

### 3. High — password reset and logout did not revoke stolen sessions

**Evidence:** reset changed only `password_hash`; JWTs lived for seven days. Logout only removed local browser storage. Locking blocked access temporarily, but unlocking revived previously issued tokens.

**Exploit:** someone holding a stolen token could continue using it after a password reset or the victim's logout, or resume after an unlock.

**Rewrite:** a database `session_version` is included in each signed token and checked on every authenticated request. Password resets, self-service changes, lock/unlock, administrator rotation, and logout increment it. Tokens expire after one hour. Old-format tokens are deliberately rejected on upgrade. Logout revokes **all** sessions for that account. Role and lock state remain database-authoritative.

```js
// Atomic credential replacement and revocation; values remain parameterized.
db.prepare(`UPDATE users
  SET password_hash = ?, session_version = session_version + 1
  WHERE id = ?`).run(hash, id);

// After JWT verification and loading the current user:
if (payload.version !== user.session_version) throw new Error('Revoked session');
```

Asynchronous password verification also rechecks account state before issuing a session, so a concurrent reset or lock cannot revive stale credentials.

### 4. Medium — public disclosure of internal purchase costs

**Evidence:** both `/api/products` and `/api/products/:id` used `SELECT *`, exposing the newly added `cost_price` without authentication. Order item responses already excluded that field.

**Exploit:** anyone can download the catalog and derive purchase costs and margins once costs are entered.

**Rewrite:** [products.js](backend/src/routes/products.js) selects an explicit public-column allowlist for both endpoints. Authenticated admin APIs retain cost information. Regression checks verify both public responses.

### 5. Medium — permissive coercion and incomplete input contracts

**Evidence:** `toInteger` used `Number` and `Math.round`, accepting booleans, arrays and fractional values as identifiers or quantities. `cleanText` stringified objects and silently truncated long input. Lock flags treated the string `"false"` as true; a missing flag meant unlock. Several invalid query values fell back to defaults. Image path checking missed backslashes.

**Exploit:** malformed payloads can modify a different rounded resource ID, corrupt quantities, or unexpectedly lock/unlock an account. These are integrity failures; they did not demonstrate a way to override server-calculated prices or gain an administrator role.

**Rewrite:** [schemas.js](backend/src/schemas.js) applies strict Zod objects to every implemented router operation, including nested line items and queries. Unknown fields, wrong types, duplicate query arrays, invalid dates, oversized strings, and non-integer numbers are rejected. Decimal digit strings remain intentionally supported for existing form clients. Route matching respects Express's case-insensitive behavior. [validate.js](backend/src/validate.js) rejects coercion/rounding and unsafe image schemes, credentials, control characters, protocol-relative paths, and backslashes. Inventory additions also enforce the overall stock ceiling.

```js
const line = z.strictObject({
  product_id: z.number().int().positive(),
  quantity: z.number().int().min(1).max(1000),
});
// Actual schemas also explicitly support digit strings for form compatibility.
```

Validation is not HTML sanitization. React text rendering supplies contextual escaping here; stripping characters from ordinary customer names would not be an appropriate XSS defense.

### 6. Medium — weak password policy, predictable suggestions, bcrypt truncation

**Evidence:** new passwords required only six characters. Suggested passwords were a fixed prefix plus one of 900,000 numbers generated by `Math.random`. The backend accepted 100 characters even though bcrypt uses only the first 72 UTF-8 bytes. Success messages repeated plaintext credentials.

**Exploit:** suggested credentials have a small guessing space. Two passwords sharing the first 72 bytes authenticate identically; multibyte passwords reach this boundary much earlier than 72 characters. Messages unnecessarily extend plaintext exposure to screenshots and visible notifications.

**Rewrite:** new/reset passwords require at least 12 characters and at most 72 UTF-8 bytes; login rejects oversized inputs. Password suggestions use 128 random bits from Web Crypto. Fields are masked with explicit reveal controls, and success messages omit passwords. New hashes use bcrypt cost 12 and asynchronous APIs. A self-service password-change endpoint and form now exist. Older legitimate short passwords can still log in, allowing migration; the documented administrator default is explicitly prohibited in production.

The byte limit follows the [bcrypt.js implementation documentation](https://github.com/dcodeIO/bcrypt.js/). Existing accounts with passwords exceeding the byte limit require reset.

### 7. Medium, conditional on script execution — persistent browser bearer tokens

**Evidence:** authentication tokens were stored in `localStorage`, accessible to any script executing in the site's origin. This is an exposure amplifier, not proof of an XSS vulnerability. [OWASP recommends keeping session identifiers out of localStorage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).

**Rewrite:** the React client uses HttpOnly session cookies; production adds Secure and a `__Host-` cookie name with no Domain attribute. Legacy localStorage tokens are removed. Cookie-mode authentication responses omit bearer tokens. Non-browser API clients retain explicit bearer-token support. A custom CSRF header and allowed-origin checks protect cookie mutations and login, including cross-origin preflight. HttpOnly prevents reading the cookie; it does not stop an active XSS payload from making requests as the user.

### 8. Medium — proxy parsing, permissive CORS, and deployment header gaps

**Evidence:** `Number(TRUST_PROXY) || 1` turned the strings `"0"` and `"false"` into one trusted hop. If clients could reach that listener directly, forged forwarding headers could change the apparent IP and evade limits. CORS reflected arbitrary origins when unset. Helmet protected Express responses, but the separately hosted Vercel frontend lacked equivalent headers, and authenticated API responses lacked explicit no-store.

**Rewrite:** proxy configuration now handles disabled values correctly and rejects ambiguous settings. Existing IP limits remain; a normalized-account limiter adds protection against attempts from different IPs. Expensive password-change requests use the auth limiter. IP limits precede JSON parsing. CORS defaults to same-origin plus explicit origins (local development origins in development). API responses use no-store; Vercel gains CSP, anti-framing, nosniff, HSTS, referrer and permissions policies. Error logs emit only error classification, and audit redaction is recursive.

Proxy hop counts still must match the actual network path, and the trusted proxy must overwrite forwarding headers. See [Express's proxy guidance](https://expressjs.com/en/guide/behind-proxies/). CORS was not itself an authentication bypass because the old API required an explicitly supplied bearer token.

### 9. High for an exposed vulnerable development server — dependency advisories

The initial frontend audit reported four affected packages: Vite (high), esbuild, react-router and react-router-dom (moderate). Backend audit initially reported zero. The [Vite Windows file-deny bypass advisory](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) requires an exposed development server and relevant sensitive files; it is not a vulnerability in static production bundles. React Router also had [redirect handling advisories](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6); SSR hydration advisories are not evidence of an exploitable SSR path in this client-rendered application.

**Rewrite:** Vite 8.2.2, React Router DOM 7.18.3, and the compatible React plugin 6.1.1 are installed and locked. Zod 4.5.4 supplies validation. Vite development binds to loopback by default. Build-time site/API origins are validated before HTML metadata insertion. Both package audits now report zero known advisories. This is a major tooling/router upgrade; restart any old development processes to use the new dependencies.

### 10. Medium — checkout silently changed login identity

**Evidence:** an email-only customer's first checkout copied the recipient phone into `users.phone`, without verification or consistent normalization. A delivery contact could therefore become a login identifier and the identifier used for loyalty accounting; differently formatted phone values could also defeat intended uniqueness until restart.

**Rewrite:** [orders.js](backend/src/routes/orders.js) normalizes the delivery phone and stores it only on the order. Checkout no longer fills the account login phone. Customers must explicitly manage their login identity through the profile flow. Tests confirm an email-only customer's login phone remains empty after checkout.

## Injection and authorization checks that held

- Database value inputs use bound SQLite parameters. Dynamic SQL column names are constructed from server-authored allowlists; filter fragments are fixed strings. `REPORT_TIME_SHIFT` is constrained before interpolation, and date helper column arguments are internal constants. No practical SQL injection was established.
- There is no NoSQL database or application request path executing shell commands, `eval`, or dynamic code. Test-process spawning uses fixed executable paths and argument arrays.
- Order reads/cancellations and address writes constrain both object ID and owner ID. Admin, customer-management, and retail routers require the database-backed administrator role. Tests verify anonymous denial, customer denial, and cross-customer IDOR denial.
- No `dangerouslySetInnerHTML`/raw HTML rendering of customer data was found. User-facing values are rendered as React text. Product images are URL-validated, and the backend does not fetch arbitrary image URLs, so that field is not a demonstrated server-side SSRF path.
- Order prices, discounts and totals remain server-calculated. Inventory reservation/cancellation uses transactions and conditional updates; concurrent cancellation restores stock only once.
- Targeted tracked-file secret patterns found no private keys or provider tokens. Git history checks found no committed `.env`, private-key or database files under the searched patterns. The existing private JWT configuration was inspected without printing its value and was not a recognized sample. These are scoped checks, not a guarantee against every possible secret format. Old archives and generated documents were not rebuilt.

## Remaining risks and deployment work

1. **Critical: rotate the existing administrator password before deployment.** The migration preserves existing user data. The production startup guard intentionally blocks deployment until the old default is removed. Rotate the signing secret too if a known/sample secret was ever deployed. Old artifacts and already-running servers do not acquire these fixes automatically.
2. **Medium: phone/email ownership is still unverified.** Public signup and profile phone changes accept claims without OTP/email verification; profile phone changes also lack password reauthentication. Someone can reserve another person's unused contact identifier, and phone-based loyalty association is not proof of ownership. This does not let them authenticate to an already registered account without its password. A complete fix requires a verified-contact challenge lifecycle, expiry/replay protection, reauthentication for identity changes, and delivery-provider configuration. No SMS/email messages were sent and no provider was configured in this audit.
3. **Medium: refund/loyalty accounting needs a business-rule correction.** `POST /api/retail/returns` caps cumulative refunds and returned quantities, but does not reverse earned loyalty points or reduce lifetime spend. A customer receiving staff-approved refunds can retain points and potentially redeem them later. Implement an atomic reversal ledger tied to each refund, including an explicit policy for already-redeemed points and historical reconciliation. This is an open finding; existing balances were not rewritten and refunds were not disabled. Staff authorization is required to create the refund, so this is not an unauthenticated endpoint exploit.
4. **Operational: rate-limit stores remain process-local.** Restarting clears budgets; multiple instances do not share them. Use a shared store when scaling. Account limits reduce guessing but can also temporarily deny a targeted account; monitor failures and consider MFA for administrators. Large order histories and admin lists still lack pagination, so sustained data growth can produce expensive responses.
5. **Privacy/process: registration reveals whether a contact identifier exists**, and staff-created passwords are deliberately disclosed to staff for delivery. Verified-contact onboarding with generic responses and one-time activation would improve both. Staff-assisted resets need identity verification outside the current software.
6. **Cookies and hosting:** prefer same-site frontend/API deployment. For separate sites, configure `COOKIE_SAME_SITE=none`, HTTPS, and exact `CLIENT_ORIGIN`; browsers blocking third-party cookies may require moving the API behind the frontend origin. The Vercel CSP permits HTTPS connections for this deployment model; narrow `connect-src` to the actual API origin when known. Use durable storage for SQLite; the supplied free preview configuration is not a production persistence guarantee.

## Verification and limitations

- `npm --prefix backend run test:security`: **58 checks passed**, including CSRF, cookie flags, revocation, default-key forgery, startup guards, admin rotation, authorization, IDOR, SQL-shaped payloads, coercion, URL validation, concurrency, sensitive-field exclusion, malformed/oversized bodies, and IP/account throttling.
- `npm --prefix backend run test:isolated`: **262 checks passed**: smoke 81, retail 97, management 84. Existing tests were updated for deliberate rejection of forged totals and the need to reauthenticate after revocation. Fresh seeding now marks reward products on insertion, correcting a seed-order issue exposed by isolated tests.
- `npm --prefix frontend run build`: passed on Node.js 24.15.0.
- `npm audit --json`: zero known vulnerabilities for both current lockfiles.
- `git diff --check`: passed.
- Browser setup and discovery returned no available browser. Browser UI behavior and real HTTPS/proxy/CORS/cookie deployment were **not** verified interactively. HTTP cookie/CSRF tests and compilation passed; that does not replace deployment testing.
- A temporary UI-test server was stopped. Automatic approval review rejected deletion of `C:\Users\ASUS\AppData\Local\Temp\gao-security-PjLVlD`, reporting only “blocked by policy”; its disposable database files remain. Other isolated test fixtures cleaned themselves up.

No production deployment, password rotation on the existing database, outgoing user messages, or changes to the pre-existing application database were performed.
