const routes = {
  login: require("../../lib/developer/login"),
  logout: require("../../lib/developer/logout"),
  register: require("../../lib/developer/register"),
  me: require("../../lib/developer/me"),
  catalog: require("../../lib/developer/catalog"),
  keys: require("../../lib/developer/keys"),
  usage: require("../../lib/developer/usage"),
  "usage-ingest": require("../../lib/developer/usage-ingest"),
  premium: require("../../lib/developer/premium")
};

module.exports = async function handler(req, res) {
  const path = req.query?.path;
  const endpoint = Array.isArray(path) ? path[0] : path;

  const route = routes[endpoint];
  if (!route) return res.status(404).json({ error: "Developer API route not found" });

  return route(req, res);
};
