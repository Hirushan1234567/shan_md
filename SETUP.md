# SHAN API HUB — setup

## 1. MongoDB Atlas
Create a database named `shan_api_hub`. Create a database user and allow network access from Vercel. Copy the Node.js connection string and replace its password placeholder.

## 2. Vercel environment variables
Open Project → Settings → Environment Variables. Add these separately for Production:

- `MONGODB_URI`: your MongoDB Atlas connection string.
- `MONGODB_DB`: `shan_api_hub` (optional; this is the default).
- `ADMIN_EMAIL`: the email address reserved for the site administrator, in lowercase.
- `ADMIN_PASSWORD`: a strong private password for the administrator account (at least 16 characters recommended).
- `APP_URL`: your deployed site origin, e.g. `https://your-project.vercel.app` (no trailing slash).

No Google Client ID, Google Client Secret, Google Cloud project, or Google billing is required.

After changing environment variables, redeploy the project.

## 3. Accounts
Visitors can create an account using an email address and password (minimum 8 characters). The email set in `ADMIN_EMAIL` is reserved and cannot be registered through the public form. The administrator signs in using that email and `ADMIN_PASSWORD`.

## 4. API keys and gateway
Create a key in the dashboard. The raw key is shown once. Call:

```bash
curl https://YOUR-VERCEL-DOMAIN/api/gateway/YOUR_API_SLUG \
  -H "x-api-key: YOUR_API_KEY"
```

Free keys have a lifetime cap of 50 requests total.

## Important
- Never commit real credentials or API keys.
- Passwords for normal accounts are stored as salted scrypt hashes; login sessions use HttpOnly cookies.
- Keep `ADMIN_PASSWORD` private and use a unique strong password.
- The current release includes email/password accounts, API catalogue, API key issuance, API registration and a basic GET gateway.
- WhatsApp pairing and the existing Mini Bot Coins service are not connected yet. They need the bot server base URL and a server-to-server authentication contract before integration.
- The gateway currently forwards GET requests to the configured upstream URL. It does not yet support configurable methods, request bodies, custom upstream headers or full OpenAPI import.
