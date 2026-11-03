# SHAN MINI BOT site  +  SHAN API Developer Platform V2

One Vercel project, two independent products:

| Product | URL | Data | Login |
|---|---|---|---|
| **SHAN MINI BOT** site (pairing, Coins Dashboard, Sender panel, games) — *unchanged features* | `/`, `/dashboard`, `/sender` | existing collections (`users`, `bots`, …) | username **or** WhatsApp number + password |
| **SHAN API Developer Platform V2** (new) | `/dev/` (users), `/dev/admin` (admin) | its own `dev_*` collections | username/e-mail + password; separate admin accounts |

## What changed in this version

**Removed completely**
- WhatsApp OTP login (`/api/auth/otp`, `/api/auth/verify`) and OTP confirmation of coin transfers / plugin purchases.
- WhatsApp **Bot Key** login, verification and "send me a new key" (`/api/auth/key-resend`). The pairing flow no longer sends a Bot Key.
- Files deleted: `api/_lib/otp.js`, `api/_lib/botkey.js`. Old data in the `bot_keys` / `otps` collections is left untouched.

**Replaced with**
- Registration + login with username / password (scrypt hashes), forgot/reset password, 14-day signed sessions that are invalidated on password change, brute-force limits.
- **Existing Coins users keep their accounts and coins**: they log in with their WhatsApp number + the password they already set. Accounts that never had a password get a reset link from the Coins admin (`POST /api/admin/reset-link`).
- Coin transfers and plugin purchases are confirmed with the account password.

**Kept, untouched**: WhatsApp pairing (`/api/pair`), Coins Dashboard (wallet, tasks, coupons, referrals, leaderboard, shop), Sender panel (`/sender`), Games, all existing APIs and the Coins admin panel. The sender number is no longer needed for login (kept for notifications).

**Fixed on the way**: `.env.example` contained real credentials (rotate them — see Security). `AUTH_SECRET` and `SESSION_SECRET` are both accepted now.

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB Atlas connection string |
| `AUTH_SECRET` (or `SESSION_SECRET`) | yes | 32+ random chars, signs Coins sessions |
| `ADMIN_PASSWORD` | yes | Coins admin panel + `/sender` |
| `DEV_ADMIN_USERNAME`, `DEV_ADMIN_PASSWORD` | yes (first run) | creates the first Developer Platform admin on first login; ignored afterwards. Password ≥ 10 chars |
| `CRON_SECRET` | recommended | protects `/api/dev/cron/health` (Vercel Cron sends it automatically) |
| `RESEND_API_KEY`, `MAIL_FROM` | optional | sends password-reset e-mails. Without them, admins create reset links |

Never commit real values. Generate secrets with `openssl rand -base64 32`.

## Database setup

No manual setup. On first request the platform creates its indexes (unique usernames/e-mails/key hashes, TTL for sessions, logs and monitoring) and seeds: the 11 API categories, the 3 plans, one changelog entry and one example plugin. Collections (all prefixed `dev_`):
`users, admins, api_keys, usage, plans, tickets, changelog, plugins, activity, categories, announcements, monitor, settings, sessions, resets`.

## Deploy

1. Push this folder to GitHub, import it in Vercel (Node 22).
2. Set the environment variables above.
3. Deploy. Open `/dev/admin`, sign in with `DEV_ADMIN_*`, then **change the admin password** (Admins & Security).
4. In **APIs & Categories**, connect each API to its data source (see below).

### Connecting data sources (important)
The gateway is `GET /api/dev/v1/<slug>` with `x-api-key`. It authenticates the key, applies plan / quota / rate / IP rules, then calls the **data source URL** you set per API in the admin panel (plus optional secret headers, never sent to browsers) and wraps the JSON in `{status, api, data, meta}`. Until a data source is connected the API answers `503 UPSTREAM_NOT_CONFIGURED` and no quota is used — nothing is faked. This project ships **no movie scrapers or content**; point the APIs at a backend/data you are entitled to serve. Upstreams must be public http(s) hosts (private/internal addresses are blocked).

## Plans
- **Free**: 50 requests **per API key, for the key's lifetime** (regenerating does not reset it). Free categories only, 10 req/min, 3 keys.
- **Premium 1 / 2**: assigned in Admin → Users (limit, unlimited, expiry date). Premium categories, higher rate limits and key counts. When a plan expires the user falls back to Free automatically.
- Defaults are editable in Admin → Plans & Limits. Which categories are premium is set per API.

## Security summary
API keys stored as SHA-256 hashes, shown once · HttpOnly + SameSite=Strict + Secure session cookies, server-side revocable · CSRF header check · scrypt passwords · login/IP/key brute-force limits · per-key rate limit & IP/CIDR whitelist · key expiry/revoke/deactivate · suspicious-use logging · SSRF guard for upstreams · input validation everywhere · admin routes behind a separate admin session · maintenance mode (admin stays available).

**Rotate now**: the original `.env.example` contained a real MongoDB password, admin password, session secret and owner API key. Change them in Atlas/Vercel.

## Tests
```
npm test        # 143 API assertions (in-memory MongoDB stand-in, fake data source) — no network or DB needed
npm run demo    # local UI at http://127.0.0.1:4173/dev/  (admin: root / RootPassw0rd!!)
```
The suite covers auth, sessions, CSRF, key hashing, the 50-lifetime-request rule, rate limits, IP rules, premium access, refunds, blocking, password reset, tickets, plugins, changelog, monitoring, maintenance, SSRF, and the Coins login/transfer/purchase flows. Browser checks (desktop 1366px + mobile 390px, no horizontal overflow) were run with Playwright.

## Notes / limits
- Vercel Hobby cron runs once a day; the Monitoring page also triggers live checks every 30 s while open.
- "Real-time" updates are polling-based (30 s), not websockets.
- Payments are not integrated: Premium is granted by an admin (users can request it via a ticket).
- New username-only Coins accounts have no WhatsApp number; bot pairing still works per the existing flow.
