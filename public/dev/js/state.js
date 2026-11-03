import { esc } from "./core.js";
export const S = { user: null, catalog: [] };
export const leave = []; // cleanup callbacks run when the page changes
export const onLeave = f => leave.push(f);

export const HINTS = {
  MISSING_API_KEY: "Add your key as the x-api-key header (use the API key field above).",
  INVALID_API_KEY: "That key does not exist. Keys are shown only once — regenerate it on My API Keys if you lost it.",
  KEY_REVOKED: "This key was revoked. Create a new key on My API Keys.",
  KEY_DISABLED: "This key is deactivated. Re-activate it on My API Keys.",
  KEY_EXPIRED: "This key has expired. Create or regenerate a key.",
  IP_NOT_ALLOWED: "Your IP is not in this key's whitelist. Edit the key's IP restrictions.",
  PREMIUM_REQUIRED: "This category needs a Premium plan. Open a ticket to request an upgrade.",
  QUOTA_EXHAUSTED: "No requests left on this key/plan.",
  RATE_LIMITED: "Too many requests per minute. Wait and retry (see Retry-After header).",
  MISSING_PARAMETER: "A required parameter is missing. See the endpoint's parameter table.",
  INVALID_PARAMETER: "A parameter has the wrong format.",
  UPSTREAM_NOT_CONFIGURED: "The platform admin has not connected a data source to this API yet. Your quota was not used.",
  UPSTREAM_ERROR: "The data source failed. Your request was not counted.",
  MAINTENANCE: "The platform is in maintenance mode.",
  API_OFFLINE: "This API is switched off by the admin."
};

export function genCode(lang, { url, method = "GET", headers = {}, body }) {
  const hs = Object.entries(headers).filter(([k]) => k);
  if (lang === "curl") {
    return `curl -X ${method} "${url}"` + hs.map(([k, v]) => ` \\\n  -H "${k}: ${v}"`).join("") + (body ? ` \\\n  -d '${body}'` : "");
  }
  const hjs = hs.length ? `{\n${hs.map(([k, v]) => `    "${k}": "${v}"`).join(",\n")}\n  }` : "{}";
  if (lang === "js") {
    return `const res = await fetch("${url}", {\n  method: "${method}",\n  headers: ${hjs}${body ? `,\n  body: JSON.stringify(${body})` : ""}\n});\nconst data = await res.json();\nconsole.log(data);`;
  }
  if (lang === "node") {
    return `// Node.js 18+ (built-in fetch). Keep your key in an environment variable.\nconst res = await fetch("${url}", {\n  method: "${method}",\n  headers: ${hjs.replace(/"YOUR_API_KEY"/, "process.env.SHAN_API_KEY")}${body ? `,\n  body: JSON.stringify(${body})` : ""}\n});\nif (!res.ok) throw new Error("HTTP " + res.status);\nconsole.log(await res.json());`;
  }
  const hpy = hs.length ? `{${hs.map(([k, v]) => `"${k}": "${v}"`).join(", ")}}` : "{}";
  return `import requests\n\nres = requests.request("${method}", "${url}", headers=${hpy}${body ? `, data='${body}'` : ""}, timeout=15)\nprint(res.status_code)\nprint(res.json())`;
}
export const statusClass = s => (s >= 200 && s < 300 ? "success" : s >= 400 && s < 500 ? "warning" : "danger");
export const esc2 = esc;
