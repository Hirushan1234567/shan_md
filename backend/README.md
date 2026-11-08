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

The Free plan starts at 200 requests. Premium and Membership plans are seeded as 30-day unlimited plans; their coin prices are configurable using environment variables and can be managed in a later admin stage.

Never commit `.env`. API keys and quota middleware are added in the next implementation stage.
