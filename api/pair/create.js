import handler from "../[...path].js";

export default function route(req, res) {
  const query = String(req.url || "").includes("?") ? String(req.url).slice(String(req.url).indexOf("?")) : "";
  req.url = "/api/pair/create" + query;
  return handler(req, res);
}
