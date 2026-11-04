# SHAN API HUB — setup

## 1. MongoDB Atlas
Create a MongoDB database named `shan_api_hub`. Create a database user and allow network access from Vercel (for a quick initial setup, Atlas may use 0.0.0.0/0; restrict this later where possible). Copy the Node.js connection string and replace its password placeholder.

## 2. Google sign-in (no OTP)
In Google Cloud Console:
1. Create/select a project.
2. Configure the OAuth consent screen and add your account as a test user if the app is in testing.
3. Create an OAuth Client ID of type **Web application**.
4. Add this Authorized redirect URI exactly: `https://YOUR-VERCEL-DOMAIN/api/auth/callback`.
5. Copy the Client ID and Client Secret.

## 3. Vercel environment variables
Add these under Project → Settings → Environment Variables, for Production (and Preview if needed):

- `MONGODB_URI`: MongoDB Atlas connection string.
- `MONGODB_DB`: `shan_api_hub` (optional).
- `GOOGLE_CLIENT_ID`: OAuth Web Client ID.
- `GOOGLE_CLIENT_SECRET`: OAuth Web Client Secret.
- `ADMIN_EMAIL`: the verified Google email address that should have admin access; use lowercase.
- `APP_URL`: deployed site origin, e.g. `https://your-project.vercel.app` (no trailing slash).

Redeploy after adding or changing variables.

## 4. First login
Open the deployed website and use Continue with Google. The Google account matching ADMIN_EMAIL receives the Admin role and can register APIs.

## 5. API gateway
Create a key in the dashboard. The raw key is shown once. Call:
```bash
curl https://YOUR-VERCEL-DOMAIN/api/gateway/YOUR_API_SLUG \
  -H "x-api-key: YOUR_API_KEY"
```
Free keys have a lifetime cap of 50 requests total.

## Important
- Never commit real credentials or API keys.
- The current release includes Google sign-in, API catalogue, API key issuance, API registration and a basic GET gateway.
- WhatsApp pairing and the existing Mini Bot Coins service are not connected yet. They need the actual bot server base URL and a server-to-server authentication secret/endpoint contract before they can be safely wired in.
- The gateway currently forwards GET requests to the configured upstream URL. It does not yet support configurable methods, request bodies, custom upstream headers or full OpenAPI import.
