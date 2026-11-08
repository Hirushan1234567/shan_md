# Backend structure

```text
backend/
├── config/
│   ├── database.js
│   └── jwt.js
├── deploy/
│   ├── ecosystem.config.cjs
│   ├── nginx-api-hub.conf
│   ├── DEPLOY.md
│   └── BACKUP.md
├── middleware/
│   ├── auth.js
│   ├── adminAuth.js
│   └── apiKeyAuth.js
├── models/
│   ├── User.js
│   ├── Plan.js
│   ├── ApiKey.js
│   ├── ApiCategory.js
│   ├── ApiEndpoint.js
│   ├── ContentItem.js
│   ├── CoinTransaction.js
│   ├── UsageLog.js
│   ├── Announcement.js
│   └── SupportTicket.js
├── modules/
│   ├── registry.js
│   ├── README.md
│   ├── custom-content/
│   │   ├── model.js
│   │   ├── controller.js
│   │   └── routes.js
│   └── movies/
│       ├── model.js
│       ├── controller.js
│       ├── routes.js
│       └── README.md
├── routes/
│   ├── auth.js
│   ├── dashboard.js
│   ├── apiKeys.js
│   ├── apiGateway.js
│   ├── plans.js
│   ├── public.js
│   ├── support.js
│   └── admin.js
├── scripts/
│   ├── seed-admin.js
│   └── backup-db.js
├── web/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js
```

The root repository's existing Vercel Pair API files remain outside this isolated backend directory.
