# SHAN API HUB — Backend

A separate Express + MongoDB/Mongoose API platform. Existing root Vercel routes and SHAN MINI BOT Pair System files are kept separate.

## Local / VPS setup

See [VPS deployment guide](./deploy/DEPLOY.md). Quick start:

```bash
cp .env.example .env
npm install
npm run check
npm run seed:admin
npm start
```

Node.js 22 is required. The service binds to `127.0.0.1:3035` by default.

## Routes

### Account and dashboard
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer JWT)
- `GET /api/dashboard` (Bearer JWT)

### API keys
- `GET /api/keys` — list key metadata
- `POST /api/keys` — create a key; raw key is returned once
- `DELETE /api/keys/:id` — revoke a key

Keys use the `myapi_<32 hex characters>` format. Only SHA-256 hashes are stored. Maximum five active keys per account.

### Plans and public discovery
- `GET /api/plans`
- `POST /api/plans/:slug/purchase` (Bearer JWT; coin balance required)
- `GET /api/public/categories`
- `GET /api/public/docs/:category`
- `GET /api/public/announcements`
- `GET /api/public/status`
- `GET/POST /api/support/tickets` (Bearer JWT)

### Dynamic API gateway
- `/api/v1/:category/:action`
- Send the API key using `x-api-key` or the `api_key` query parameter.
- Category and endpoint definitions must exist and be enabled in the database.
- Free requests have a 200-request lifetime allowance. Premium and Membership are seeded as 30-day unlimited plans. Expired paid plans are downgraded to Free.
- Per-key rate limit: 60 requests per minute; overall API rate limit: 120 requests per minute per client IP.

### Movies module
- `GET /api/v1/movies/list?page=1&limit=20`
- `GET /api/v1/movies/search?q=title&genre=genre&year=2025`
- `GET /api/v1/movies/detail?id=MONGODB_ID` or `?title=title`

Only administrator-published records are returned. This module does not scrape websites or provide unauthorized downloads.

### Admin (Bearer JWT + admin role)
- `GET /api/admin/overview`
- `GET/PATCH /api/admin/users` and `/api/admin/users/:id`
- `POST /api/admin/users/:id/coins`
- `GET/POST/PATCH/DELETE /api/admin/categories`
- `GET/POST/PATCH/DELETE /api/admin/endpoints`
- `GET/POST/PATCH/DELETE /api/admin/content`
- `GET/POST/PATCH /api/admin/plans`
- `GET/POST/PATCH/DELETE /api/admin/announcements`
- `GET/PATCH /api/admin/support/tickets`

## Web interface

The responsive dark UI is served by Express:
- `/home`, `/doc`, `/playground`, `/buy`, `/tools`, `/status`, `/terms`, `/privacy`

## Safety / deployment notes

- Keep `.env` private and out of Git.
- Use HTTPS in production.
- Do not replace root `api/` files, root `package.json`, root `.env.example`, or existing Pair API Nginx routes when deploying this service.
- Admin should publish only data owned by the platform or licensed for distribution.
- Run `npm run check` before starting the service. This checks JavaScript syntax; it does not replace integration testing against your MongoDB deployment.
