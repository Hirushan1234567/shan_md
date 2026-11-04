# SHAN API HUB

Vercel + MongoDB API marketplace with email/password accounts.

## Vercel environment variables
- `MONGODB_URI` — MongoDB Atlas connection string
- `MONGODB_DB` — `shan_api_hub` (optional)
- `ADMIN_EMAIL` — reserved administrator email
- `ADMIN_PASSWORD` — private administrator password
- `APP_URL` — deployed HTTPS site URL

No Google OAuth credentials or Google Cloud billing are required.

## Features
- Email/password registration and login
- Salted scrypt password hashes and HttpOnly login sessions
- API catalogue and admin registration
- Developer API keys stored as SHA-256 hashes; raw key shown once
- Free keys: 50 lifetime requests total
- API gateway: GET `/api/gateway/:slug` with `x-api-key`

The initial release does not yet integrate WhatsApp pairing or the Coins service. See [SETUP.md](SETUP.md) for deployment instructions.
