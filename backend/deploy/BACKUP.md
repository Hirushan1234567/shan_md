# Database backup

Install MongoDB Database Tools on the VPS so `mongodump` is available. Configure `MONGODB_URI` in the private backend `.env`.

Run a manual compressed backup:

```bash
cd /opt/shan_md/backend
npm run backup
```

Backups are written outside the backend source tree to `/opt/shan_md/backend/backups` by default. The script writes a temporary MongoDB config file with restrictive permissions so the URI is not passed as a process command-line argument, then removes that temporary file. It prunes matching backups older than 14 days by default.

Optional environment variables:
- `BACKUP_DIR` — backup destination directory
- `BACKUP_RETENTION_DAYS` — retention window (minimum 1 day)

Keep backup files private and copy them to a separate secure storage location. Test restores against a separate database before relying on a backup. This script creates backups only; it does not automatically restore or overwrite production data.
