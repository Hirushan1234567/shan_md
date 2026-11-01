import login from "../../lib/developer/login.cjs";
import logout from "../../lib/developer/logout.cjs";
import register from "../../lib/developer/register.cjs";
import me from "../../lib/developer/me.cjs";
import catalog from "../../lib/developer/catalog.cjs";
import keys from "../../lib/developer/keys.cjs";
import usage from "../../lib/developer/usage.cjs";
import usageIngest from "../../lib/developer/usage-ingest.cjs";
import premium from "../../lib/developer/premium.cjs";

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
