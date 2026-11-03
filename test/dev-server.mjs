// Local demo server: in-memory DB + fake data source. For UI testing only:  node --import ./tests/register.mjs tests/dev-server.mjs
import http from "node:http";
Object.assign(process.env, { MONGODB_URI: "mock://x", AUTH_SECRET: "dev-secret-dev-secret-123456", ADMIN_PASSWORD: "coins-admin", DEV_ADMIN_USERNAME: "root", DEV_ADMIN_PASSWORD: "RootPassw0rd!!", CRON_SECRET: "c", DEV_ALLOW_PRIVATE_UPSTREAM: "1" });
const { startServer } = await import("./server.mjs");
const up = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ results: [{ id: "1", title: "Demo result" }] })); });
await new Promise(r => up.listen(4174, "127.0.0.1", r));
const { port } = await startServer(4173);
console.log("ready http://127.0.0.1:" + port);
