import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const uri = String(process.env.MONGODB_URI || "").trim();
if (!uri) throw new Error("MONGODB_URI is required");

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(process.env.BACKUP_DIR || path.join(here, "../../backups"));
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 14);
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = path.join(outputDir, "shan-api-" + stamp + ".archive.gz");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shan-mongodump-"));
const configPath = path.join(tempDir, "mongodump.yml");

try {
  fs.writeFileSync(configPath, "uri: " + JSON.stringify(uri) + "\n", { mode: 0o600 });
  await new Promise((resolve, reject) => {
    const child = spawn("mongodump", ["--config", configPath, "--archive", archive, "--gzip"], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("mongodump exited with code " + code)));
  });

  const cutoff = Date.now() - retentionDays * 86400000;
  for (const name of fs.readdirSync(outputDir)) {
    if (!/^shan-api-.*\.archive\.gz$/.test(name)) continue;
    const file = path.join(outputDir, name);
    if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
  }
  console.log("Backup created:", archive);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
