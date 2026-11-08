# VPS deployment (Ubuntu 24.04 + Node 22)

This deployment runs the new API Hub as a separate PM2 process on 127.0.0.1:3035. It does not alter the existing Pair API service or its Nginx location.

## 1. Get the code

```bash
cd /opt
git clone https://github.com/Hirushan1234567/shan_md.git shan_md
cd /opt/shan_md/backend
```

If the repository is already cloned, use `git pull` from its root instead of cloning again.

## 2. Configure environment

```bash
cd /opt/shan_md/backend
cp .env.example .env
nano .env
```

Set a private MongoDB URI, a random JWT_SECRET of at least 32 characters, the frontend origin(s), and the initial admin email/password. Do not paste secrets into chat or commit .env.

## 3. Install, check and seed

```bash
npm install
npm run check
npm run seed:admin
```

The seed command creates Free (200 lifetime requests), Premium (30 days, unlimited) and Membership (30 days, unlimited), plus the Movies category/endpoints and initial admin. Keep the admin password safe.

## 4. Start with PM2

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 status
curl http://127.0.0.1:3035/api/health
```

## 5. Nginx and TLS

Copy `deploy/nginx-api-hub.conf` to an Nginx site file and replace the example hostname with a domain you control. Enable the site, run `nginx -t`, reload Nginx, then issue a TLS certificate with Certbot. Do not overwrite the existing SHAN MINI BOT Pair API server block or `/pair-api/` location.

After enabling HTTPS, include the exact frontend origin in `APP_ORIGINS`, then restart the PM2 app with updated environment.

## 6. Smoke-test endpoints

- `GET https://YOUR-HOST/api/health`
- `GET https://YOUR-HOST/api/public/categories`
- `GET https://YOUR-HOST/api/public/docs/movies`
- Register/login, create an API key, then test `GET /api/v1/movies/list` with `x-api-key`.

Only published movie metadata entered by an administrator is returned. Add only data you own or are licensed to distribute. Never enable an untrusted module or commit credentials.
