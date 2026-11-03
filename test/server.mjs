// Local server that mimics Vercel routing (static files + /api functions). Test-suite only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

export async function startServer(port = 0) {
  const dev = (await import(path.join(root, "api/dev/[...path].js"))).default;
  const coins = (await import(path.join(root, "api/[...path].js"))).default;
  const srv = http.createServer(async (req, res) => {
    req.headers["x-forwarded-proto"] = "http";
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/api/")) {
      let raw = ""; for await (const c of req) raw += c;
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
      return (u.pathname.startsWith("/api/dev/") ? dev : coins)(req, res);
    }
    let p = u.pathname;
    if (p.endsWith("/")) p += "index.html"; else if (!path.extname(p)) p += ".html";
    const f = path.join(root, "public", p);
    if (!f.startsWith(path.join(root, "public")) || !fs.existsSync(f)) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream");
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(port, "127.0.0.1", r));
  return { srv, port: srv.address().port };
}
