# SHAN Developer API Backend

This is an isolated Express/Mongoose backend. It does not replace or modify the existing Vercel Pair API handlers.

## Setup

1. Use Node.js 22.
2. Copy `.env.example` to `.env` and fill in the MongoDB URI, JWT secret, frontend origin and admin credentials.
3. Run `npm install`.
4. Run `npm run seed:admin` once.
5. Run `npm start`.

The service listens on 127.0.0.1:3035 by default. Put Nginx in front of it and proxy a dedicated path or subdomain to this port. Keep the existing Pair API reverse-proxy location and environment variables unchanged.

## Initial routes

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `GET /api/dashboard` (Bearer token)

## API key management

All key-management routes require `Authorization: Bearer <JWT>`.

- `GET /api/keys` — list key metadata (never returns stored raw keys)
- `POST /api/keys` with JSON `{"name":"My application"}` — create a key
- `DELETE /api/keys/:id` — revoke an active key

A newly created key has the format `myapi_<32 hexadecimal characters>`. The raw key is returned only once at creation. Only its SHA-256 hash is stored. Users may have up to five active keys.

## API authentication and quota middleware

Import `requireApiKey` and `apiKeyRateLimit` from `./middleware/apiKeyAuth.js` in a category router. Apply them in this order:

```js
router.use(requireApiKey, apiKeyRateLimit);
```

The middleware accepts the key in the `x-api-key` header or `api_key` query parameter. It checks the key, account, plan and expiry. Expired paid plans are downgraded to Free. Free-plan requests use a 200-request lifetime allowance; failed endpoint responses (HTTP 4xx/5xx) release the reserved quota. Successful requests are logged. Paid plans seeded by this project are 30-day unlimited plans.

The dashboard response includes `usage.used`, `usage.limit` and `usage.unlimited`. The general backend limiter and per-key limiter both apply.

Never commit `.env`. This backend is separate from the existing Pair System; do not replace root Vercel files or Pair environment variables.
