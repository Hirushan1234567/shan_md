import { aux } from "../db.js";

const col = n => aux("dev_" + n);

const P = {
  q: { name: "q", type: "string", required: false, description: "Search text (movie / series title)." },
  page: { name: "page", type: "integer", required: false, description: "Result page number (default 1)." },
  year: { name: "year", type: "integer", required: false, description: "Release year filter." }
};

const example = (slug, extra = {}) => JSON.stringify({
  status: true, api: slug,
  data: { page: 1, results: [{ id: "example-id", title: "Example title", year: 2024, ...extra }] },
  meta: { plan: "free", remaining: 49, responseTimeMs: 312 }
}, null, 2);

const CATS = [
  ["sinhala-movies", "Sinhala Movies", "Search and list Sinhala movies.", [P.q, P.page, P.year], false],
  ["tamil-movies", "Tamil Movies", "Search and list Tamil movies.", [P.q, P.page, P.year], false],
  ["english-movies", "English Movies", "Search and list English movies.", [P.q, P.page, P.year], false],
  ["action-movies", "Action Movies", "Browse action movies.", [P.q, P.page, P.year], false],
  ["comedy-movies", "Comedy Movies", "Browse comedy movies.", [P.q, P.page, P.year], false],
  ["horror-movies", "Horror Movies", "Browse horror movies.", [P.q, P.page, P.year], false],
  ["drama-movies", "Drama Movies", "Browse drama movies.", [P.q, P.page, P.year], false],
  ["latest-movies", "Latest Movies", "Newest movie releases.", [P.page], false],
  ["tv-series", "TV Series", "Search TV series and episodes.", [P.q, P.page], true],
  ["subtitles", "Subtitles", "Find subtitles for a movie or episode.", [
    { name: "q", type: "string", required: true, description: "Movie or episode title." },
    { name: "lang", type: "string", required: false, description: "Language code, e.g. si, en, ta." }], true],
  ["movie-downloads", "Movie Downloads", "Download links for a movie id returned by the movie APIs.", [
    { name: "id", type: "string", required: true, description: "Movie id from a movie API response." },
    { name: "quality", type: "string", required: false, description: "e.g. 480p, 720p, 1080p." }], true]
];

const PLANS = [
  { _id: "free", name: "Free", limit: 50, unlimited: false, expiryDays: 0, rpm: 10, maxKeys: 3,
    description: "50 total requests per API key for the key's entire lifetime (not per day). Free categories only." },
  { _id: "premium1", name: "Premium Level 1", limit: 5000, unlimited: false, expiryDays: 30, rpm: 60, maxKeys: 10,
    description: "Admin-configured request limit and expiry. Premium categories included." },
  { _id: "premium2", name: "Premium Level 2", limit: 50000, unlimited: true, expiryDays: 30, rpm: 300, maxKeys: 25,
    description: "Higher or unlimited requests, 300 requests/minute, 25 API keys, priority support tickets." }
];

const PLUGIN_CODE = `// SHAN MINI BOT plugin template — movie search via SHAN API
// Keep the key in your bot's environment variables, never in public code.
const API = "https://YOUR-DOMAIN/api/dev/v1/english-movies";

export default async function movie(sock, msg, args) {
  const q = args.join(" ").trim();
  if (!q) return sock.sendMessage(msg.key.remoteJid, { text: "Usage: .movie <title>" }, { quoted: msg });

  const res = await fetch(\`\${API}?q=\${encodeURIComponent(q)}\`, {
    headers: { "x-api-key": process.env.SHAN_API_KEY }
  });
  const json = await res.json();
  if (!json.status) return sock.sendMessage(msg.key.remoteJid, { text: "API error: " + json.error.message }, { quoted: msg });

  const list = json.data.results.slice(0, 5).map((m, i) => \`\${i + 1}. \${m.title}\`).join("\\n");
  await sock.sendMessage(msg.key.remoteJid, { text: list || "No results." }, { quoted: msg });
}`;

export async function seedDefaults() {
  const settings = await col("settings");
  if (await settings.findOne({ _id: "seeded" })) return;

  const cats = await col("categories");
  let order = 0;
  for (const [slug, name, description, params, premium] of CATS) {
    await cats.updateOne({ _id: slug }, {
      $setOnInsert: {
        slug, name, group: slug === "subtitles" ? "subtitles" : slug === "movie-downloads" ? "downloads" : slug === "tv-series" ? "series" : "movies",
        method: "GET", description, params, premium, status: "active", enabled: true,
        upstreamUrl: "", upstreamHeaders: {}, exampleResponse: example(slug), order: order++, createdAt: Date.now(),
        health: { state: "unconfigured", latency: null, checkedAt: null }
      }
    }, { upsert: true });
  }

  const plans = await col("plans");
  for (const { _id, ...rest } of PLANS) await plans.updateOne({ _id }, { $setOnInsert: rest }, { upsert: true });

  await (await col("changelog")).updateOne({ _id: "v2-0-0" }, {
    $setOnInsert: {
      version: "2.0.0", type: "new", title: "SHAN API Developer Platform V2",
      body: "Username/password accounts, hashed API keys, plans and quotas, playground, monitoring, tickets, plugin marketplace and admin panel.",
      date: new Date().toISOString().slice(0, 10), createdAt: Date.now()
    }
  }, { upsert: true });

  await (await col("plugins")).updateOne({ _id: "movie-search" }, {
    $setOnInsert: {
      slug: "movie-search", name: "Movie Search (.movie)", category: "Movies",
      shortDesc: "Search movies from WhatsApp using the SHAN API.",
      description: "Adds a .movie <title> command to SHAN MINI BOT that calls the English Movies API and replies with the top matches.",
      docs: "1. Create an API key on the My API Keys page.\n2. Add it to your bot environment as SHAN_API_KEY.\n3. Replace YOUR-DOMAIN in the code with this platform's domain.\n4. Send .movie <title> in WhatsApp.",
      install: "Save the code as plugins/movie.js in your SHAN MINI BOT project, set SHAN_API_KEY, restart the bot.",
      code: PLUGIN_CODE, version: "1.0.0", author: "SHAN MD", apiCategories: ["english-movies"], published: true, createdAt: Date.now()
    }
  }, { upsert: true });

  await settings.updateOne({ _id: "maintenance" }, { $setOnInsert: { v: { on: false, message: "" } } }, { upsert: true });
  await settings.updateOne({ _id: "seeded" }, { $set: { v: Date.now() } }, { upsert: true });
}
