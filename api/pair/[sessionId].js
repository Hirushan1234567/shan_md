import handler from "../[...path].js";

export default function route(req, res) {
  const sessionId = String((req.query && req.query.sessionId) || "").trim();
  const query = String(req.url || "").includes("?") ? String(req.url).slice(String(req.url).indexOf("?")) : "";
  req.url = "/api/pair/" + encodeURIComponent(sessionId) + query;
  return handler(req, res);
}
