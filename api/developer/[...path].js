import login from "../../lib/developer/login.js";
import logout from "../../lib/developer/logout.js";
import register from "../../lib/developer/register.js";
import me from "../../lib/developer/me.js";
import catalog from "../../lib/developer/catalog.js";
import keys from "../../lib/developer/keys.js";
import usage from "../../lib/developer/usage.js";
import usageIngest from "../../lib/developer/usage-ingest.js";
import premium from "../../lib/developer/premium.js";

const routes = {
  login, logout, register, me, catalog, keys, usage,
  "usage-ingest": usageIngest,
  premium
};

export default async function handler(req, res) {
  const path = req.query?.path;
  const endpoint = Array.isArray(path) ? path[0] : path;
  const route = routes[endpoint];

  if (!route) {
    return res.status(404).json({ error: "Developer API route not found" });
  }

  return route(req, res);
}
