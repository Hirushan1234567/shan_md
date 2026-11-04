# SHAN API HUB

Vercel + MongoDB API marketplace.

## Vercel environment variables
- MONGODB_URI
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- AUTH_SECRET (32+ random characters)
- ADMIN_EMAIL (Google account allowed to register APIs)
- APP_URL (deployed https URL)

Google OAuth callback: https://YOUR_DOMAIN/api/auth/callback

## Features
- Google sign-in, no OTP
- API catalogue and admin registration
- Developer keys stored as SHA-256 hashes; raw key shown once
- Free keys: 50 lifetime requests total
- Premium plan flag is admin-configurable in MongoDB
- API gateway: GET /api/gateway/:slug with x-api-key

Only public HTTPS upstream URLs are accepted. Never put upstream secrets in browser code. This initial release does not yet integrate WhatsApp pairing or the Coins service.
