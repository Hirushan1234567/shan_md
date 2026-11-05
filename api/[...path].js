import crypto from "node:crypto";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";

const scrypt = promisify(crypto.scrypt);
let clientPromise;
async function db() {
  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) throw new Error("MONGODB_URI is missing or invalid. Set a valid MongoDB connection string in Vercel Environment Variables.");
  if (!clientPromise) clientPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 }).connect().catch(error => { clientPromise = null; throw error; });
  return (await clientPromise).db(process.env.MONGODB_DB || "shan_api_hub");
}
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const send = (res, status, data) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
};
const adminEmail = () => (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return salt + ":" + derived.toString("hex");
}
async function passwordMatches(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hex] = stored.split(":");
  const actual = await scrypt(password, salt, 64);
  return safeEqual(actual.toString("hex"), hex);
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString().trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { const error = new Error("Invalid JSON request body"); error.statusCode = 400; throw error; }
}
function cookie(req, name) {
  const part = (req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}
async function startSession(req, res, d, user) {
  const token = crypto.randomBytes(32).toString("hex");
  await d.collection("sessions").insertOne({
    userId: user._id, tokenHash: sha(token),
    expiresAt: new Date(Date.now() + 14 * 86400000)
  });
  res.setHeader("Set-Cookie", "shan_session=" + token + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1209600");
}
async function currentUser(req, d) {
  const token = cookie(req, "shan_session");
  if (!token) return null;
  const session = await d.collection("sessions").findOne({
    tokenHash: sha(token), expiresAt: { $gt: new Date() }
  });
  return session ? d.collection("users").findOne({ _id: session.userId }) : null;
}
const isAdmin = user => !!user && user.email === adminEmail();

export default async function handler(req, res) {
  try {
    const d = await db();
    const path = (req.url || "/").split("?")[0].replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const method = req.method;

    if (path[0] === "health") return send(res, 200, { ok: true, name: "SHAN API HUB" });

    if (path[0] === "auth" && path[1] === "register" && method === "POST") {
      const input = await body(req);
      const email = String(input.email || "").trim().toLowerCase();
      const name = String(input.name || "").trim().slice(0, 60);
      const password = String(input.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: "Enter a valid email address" });
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: "Password must be 8–128 characters" });
      if (email === adminEmail()) return send(res, 403, { error: "This email is reserved for the site administrator" });
      if (await d.collection("users").findOne({ email })) return send(res, 409, { error: "An account with this email already exists" });
      const user = {
        email, name: name || email.split("@")[0],
        passwordHash: await passwordHash(password),
        plan: "free", createdAt: new Date(), updatedAt: new Date()
      };
      await d.collection("users").insertOne(user);
      await startSession(req, res, d, user);
      return send(res, 201, { ok: true });
    }

    if (path[0] === "auth" && path[1] === "login" && method === "POST") {
      const input = await body(req);
      const email = String(input.email || "").trim().toLowerCase();
      const password = String(input.password || "");
      if (!email || !password) return send(res, 400, { error: "Email and password are required" });
      if (email === adminEmail()) {
        if (!process.env.ADMIN_PASSWORD || !safeEqual(password, process.env.ADMIN_PASSWORD)) {
          return send(res, 401, { error: "Incorrect email or password" });
        }
        let user = await d.collection("users").findOne({ email });
        if (!user) {
          const record = { email, name: "SHAN API HUB Admin", plan: "premium", createdAt: new Date(), updatedAt: new Date() };
          const result = await d.collection("users").insertOne(record);
          user = { ...record, _id: result.insertedId };
        }
        await startSession(req, res, d, user);
        return send(res, 200, { ok: true });
      }
      const user = await d.collection("users").findOne({ email });
      if (!user || !(await passwordMatches(password, user.passwordHash))) {
        return send(res, 401, { error: "Incorrect email or password" });
      }
      await startSession(req, res, d, user);
      return send(res, 200, { ok: true });
    }

    if (path[0] === "auth" && path[1] === "logout") {
      const token = cookie(req, "shan_session");
      if (token) await d.collection("sessions").deleteOne({ tokenHash: sha(token) });
      res.setHeader("Set-Cookie", "shan_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
      return send(res, 200, { ok: true });
    }

    if (path[0] === "catalog" && method === "GET") {
      const apis = await d.collection("apis").find({ active: true }, { projection: { sourceUrl: 0 } }).sort({ createdAt: -1 }).toArray();
      return send(res, 200, { apis });
    }

    if (path[0] === "monetization" && path.length === 1 && method === "GET") {
      const items = await d.collection("monetization").find({ active: true }, { projection: { _id: 0, title: 1, slug: 1, type: 1, description: 1, url: 1, buttonLabel: 1 } }).sort({ createdAt: -1 }).toArray();
      return send(res, 200, { items });
    }
    if (path[0] === "monetization" && path[1] === "inquiry" && method === "POST") {
      const input = await body(req), name = String(input.name || "").trim().slice(0,80), email = String(input.email || "").trim().toLowerCase().slice(0,160), message = String(input.message || "").trim().slice(0,2000);
      const type = ["sponsorship","advertising","api-partnership","affiliate"].includes(input.type) ? input.type : "sponsorship";
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || !message) return send(res,400,{error:"Enter your name, valid email and proposal"});
      await d.collection("partnerInquiries").insertOne({name,email,company:String(input.company||"").trim().slice(0,120),type,message,createdAt:new Date(),status:"new"});
      return send(res,201,{ok:true});
    }
    const user = await currentUser(req, d);

    if (path[0] === "pair" && path[1] === "create" && method === "POST") {
      const input = await body(req);
      const phoneNumber = String(input.phoneNumber || "").replace(/\D/g, "");
      if (!/^\d{10,15}$/.test(phoneNumber)) return send(res, 400, { error: "Enter a valid phone number with country code" });
      const base = String(process.env.BOT_API_URL || "").trim().replace(/\/+$/, "");
      const apiKey = String(process.env.SHAN_API_KEY || "").trim();
      if (!base || !apiKey) return send(res, 503, { error: "WhatsApp pairing service is not configured yet" });
      let upstreamUrl;
      try { upstreamUrl = new URL(base); } catch { return send(res, 500, { error: "Invalid BOT_API_URL configuration" }); }
      if (upstreamUrl.protocol !== "https:") return send(res, 500, { error: "BOT_API_URL must use HTTPS" });
      const response = await fetch(base + "/api/web/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ number: phoneNumber, phoneNumber }),
        signal: AbortSignal.timeout(25000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false || result.status === false) return send(res, response.status || 502, { error: result.message || result.error || "Could not create pairing session" });
      const sessionId = String(result.sessionId || result.session || result.id || "");
      if (!sessionId) return send(res, 502, { error: "Pairing service did not return a session ID" });
      const publicId = crypto.randomBytes(24).toString("hex");
      await d.collection("pairingSessions").insertOne({ publicId, sessionId, phoneNumber, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60000) });
      return send(res, 200, { success: true, sessionId: publicId, status: result.connection || result.status || "pending", pairCode: result.pairCode || result.code || result.pairingCode || null });
    }

    if (path[0] === "pair" && path[1] && method === "GET") {
      const record = await d.collection("pairingSessions").findOne({ publicId: path[1], expiresAt: { $gt: new Date() } });
      if (!record) return send(res, 404, { error: "Pairing session not found" });
      const base = String(process.env.BOT_API_URL || "").trim().replace(/\/+$/, "");
      const apiKey = String(process.env.SHAN_API_KEY || "").trim();
      if (!base || !apiKey) return send(res, 503, { error: "WhatsApp pairing service is not configured yet" });
      const upstreamUrl = new URL(base);
      if (upstreamUrl.protocol !== "https:") return send(res, 500, { error: "BOT_API_URL must use HTTPS" });
      const response = await fetch(base + "/api/status/" + encodeURIComponent(record.sessionId), {
        headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return send(res, response.status, { error: result.message || result.error || "Could not read pairing status" });
      return send(res, 200, { success: true, sessionId: record.sessionId, phoneNumber: record.phoneNumber, status: result.connection || result.status || "pending", pairCode: result.pairCode || result.code || result.pairingCode || null });
    }

    if (path[0] === "me") {
      if (!user) return send(res, 401, { error: "Sign in required" });
      const keys = await d.collection("keys").find({ userId: user._id, revoked: { $ne: true } }).toArray();
      const used = keys.reduce((sum, key) => sum + (key.used || 0), 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const keyIds = keys.map(key => key._id);
      const monthResult = keyIds.length ? await d.collection("usage").aggregate([
        { $match: { keyId: { $in: keyIds }, at: { $gte: monthStart } } },
        { $count: "total" }
      ]).toArray() : [];
      return send(res, 200, { user: {
        name: user.name, email: user.email, isAdmin: isAdmin(user),
        plan: user.plan || "free", keyCount: keys.length,
        used, monthUsed: monthResult[0]?.total || 0,
        limit: (user.plan || "free") === "premium" ? null : Math.max(50, keys.length * 50)
      }});
    }

    if (path[0] === "keys") {
      if (!user) return send(res, 401, { error: "Sign in required" });
      if (method === "GET") {
        const keys = await d.collection("keys").find(
          { userId: user._id, revoked: { $ne: true } },
          { projection: { keyHash: 0 } }
        ).toArray();
        return send(res, 200, { keys });
      }
      if (method === "POST") {
        const count = await d.collection("keys").countDocuments({ userId: user._id, revoked: { $ne: true } });
        if (count >= 3) return send(res, 403, { error: "Maximum 3 active keys" });
        const raw = "shan_" + crypto.randomBytes(28).toString("hex");
        await d.collection("keys").insertOne({
          userId: user._id, label: "My API key", prefix: raw.slice(0, 12),
          keyHash: sha(raw), plan: user.plan || "free", used: 0,
          createdAt: new Date(), revoked: false
        });
        return send(res, 201, { key: raw });
      }
    }

    if (path[0] === "admin" && path[1] === "users") {
      if (!isAdmin(user)) return send(res, 403, { error: "Admin access required" });
      if (method === "GET") {
        const users = await d.collection("users").find(
          {},
          { projection: { passwordHash: 0 } }
        ).sort({ createdAt: -1 }).limit(200).toArray();
        return send(res, 200, { users: users.map(item => ({
          id: String(item._id), name: item.name || "", email: item.email,
          plan: item.plan || "free", createdAt: item.createdAt || null,
          isAdmin: isAdmin(item)
        })) });
      }
      if (method === "POST") {
        const input = await body(req);
        const plan = input.plan === "premium" ? "premium" : input.plan === "free" ? "free" : null;
        if (!plan) return send(res, 400, { error: "Choose a valid plan" });
        if (input.all === true) {
          const result = await d.collection("users").updateMany(
            { email: { $ne: adminEmail() } },
            { $set: { plan, updatedAt: new Date() } }
          );
          const users = await d.collection("users").find({ email: { $ne: adminEmail() } }, { projection: { _id: 1 } }).toArray();
          const ids = users.map(item => item._id);
          if (ids.length) await d.collection("keys").updateMany({ userId: { $in: ids }, revoked: { $ne: true } }, { $set: { plan } });
          return send(res, 200, { ok: true, updated: result.modifiedCount, plan });
        }
        const email = String(input.email || "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: "Enter a valid user email" });
        if (email === adminEmail()) return send(res, 403, { error: "The administrator plan cannot be changed here" });
        const target = await d.collection("users").findOne({ email });
        if (!target) return send(res, 404, { error: "User not found" });
        await d.collection("users").updateOne({ _id: target._id }, { $set: { plan, updatedAt: new Date() } });
        await d.collection("keys").updateMany({ userId: target._id, revoked: { $ne: true } }, { $set: { plan } });
        return send(res, 200, { ok: true, email, plan });
      }
    }

    if (path[0] === "admin" && path[1] === "monetization") {
      if (!isAdmin(user)) return send(res,403,{error:"Admin access required"});
      if (method === "GET") {
        const [items,inquiries]=await Promise.all([d.collection("monetization").find({}).sort({createdAt:-1}).toArray(),d.collection("partnerInquiries").find({}).sort({createdAt:-1}).limit(100).toArray()]);
        return send(res,200,{items,inquiries});
      }
      if (method === "POST") {
        const input=await body(req),title=String(input.title||"").trim().slice(0,100),description=String(input.description||"").trim().slice(0,500);let target;
        try{target=new URL(String(input.url||""))}catch{return send(res,400,{error:"Enter a valid destination URL"})}
        if(!title||!description||target.protocol!=="https:"||target.username||target.password)return send(res,400,{error:"Title, description and public HTTPS URL are required"});
        const type=["advertisement","sponsored","affiliate","api-partnership"].includes(input.type)?input.type:"sponsored",slug=title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+crypto.randomBytes(3).toString("hex");
        await d.collection("monetization").insertOne({title,description,url:target.toString(),type,slug,buttonLabel:String(input.buttonLabel||"Visit Offer").slice(0,40),active:true,createdAt:new Date()});
        return send(res,201,{ok:true,slug});
      }
      if(method==="DELETE"&&path[2]){const result=await d.collection("monetization").deleteOne({slug:path[2]});return send(res,result.deletedCount?200:404,result.deletedCount?{ok:true}:{error:"Offer not found"})}
    }
    if (path[0] === "admin" && path[1] === "apis") {
      if (!isAdmin(user)) return send(res, 403, { error: "Admin access required" });
      if (method === "GET") {
        const items = await d.collection("apis").find({}).sort({ updatedAt: -1, createdAt: -1 }).toArray();
        return send(res, 200, { apis: items });
      }
      if (method === "DELETE" && path[2]) {
        const result = await d.collection("apis").deleteOne({ slug: path[2] });
        return send(res, result.deletedCount ? 200 : 404, result.deletedCount ? { ok: true } : { error: "API not found" });
      }
      if (method === "POST") {
        const input = await body(req);
        let source;
        try { source = new URL(String(input.sourceUrl || "")); } catch { return send(res, 400, { error: "Invalid source URL" }); }
        if (source.protocol !== "https:" || source.username || source.password || ["localhost", "127.0.0.1", "::1"].includes(source.hostname)) {
          return send(res, 400, { error: "Only public HTTPS upstreams allowed" });
        }
        const slug = String(input.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
        const name = String(input.name || "").trim().slice(0, 100);
        const description = String(input.description || "").trim().slice(0, 500);
        if (!slug || !name || !description) return send(res, 400, { error: "Name, slug and description required" });
        const category = ["movie","ai","download","image","search","utility","other"].includes(input.category) ? input.category : "other";
        const apiMethod = input.method === "POST" ? "POST" : "GET";
        let parameters = [], sampleResponse = null;
        try { parameters = input.parametersJSON ? JSON.parse(input.parametersJSON) : []; } catch { return send(res, 400, { error: "Parameters must be valid JSON" }); }
        try { sampleResponse = input.sampleResponseJSON ? JSON.parse(input.sampleResponseJSON) : null; } catch { return send(res, 400, { error: "Sample response must be valid JSON" }); }
        if (!Array.isArray(parameters) && (typeof parameters !== "object" || parameters === null)) return send(res, 400, { error: "Parameters must be a JSON object or array" });
        const originalSlug = String(input.originalSlug || "").trim().toLowerCase();
        if (originalSlug && originalSlug !== slug) {
          const oldApi = await d.collection("apis").findOne({ slug: originalSlug });
          if (!oldApi) return send(res, 404, { error: "API being edited was not found" });
          if (await d.collection("apis").findOne({ slug })) return send(res, 409, { error: "That API slug is already in use" });
        }
        const selector = originalSlug ? { slug: originalSlug } : { slug };
        await d.collection("apis").updateOne(selector, {
          $set: {
            name, slug, description, category, method: apiMethod, sourceUrl: source.toString(),
            parameters, sampleResponse,
            docsUrl: String(input.docsUrl || "").trim().slice(0, 500),
            tags: String(input.tags || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 12),
            plan: input.plan === "premium" ? "premium" : "free",
            active: input.active === false || input.active === "false" ? false : true, updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        }, { upsert: !originalSlug });
        return send(res, originalSlug ? 200 : 201, { ok: true, slug });
      }
    }

    if (path[0] === "gateway" && path[1] && ["GET", "POST"].includes(method)) {
      const raw = req.headers["x-api-key"];
      if (!raw) return send(res, 401, { error: "x-api-key header required" });
      const key = await d.collection("keys").findOne({ keyHash: sha(String(raw)), revoked: { $ne: true } });
      if (!key) return send(res, 401, { error: "Invalid API key" });
      const api = await d.collection("apis").findOne({ slug: path[1], active: true });
      if (!api) return send(res, 404, { error: "API not found" });
      if (method !== (api.method === "POST" ? "POST" : "GET")) return send(res, 405, { error: "Method not allowed for this API", allowed: api.method || "GET" });
      if (api.plan === "premium" && key.plan !== "premium") return send(res, 403, { error: "Premium plan required" });
      if (key.plan !== "premium" && key.used >= 50) return send(res, 429, { error: "Free lifetime quota of 50 requests reached" });
      const target = new URL(api.sourceUrl);
      if (target.protocol !== "https:" || target.username || target.password) return send(res, 400, { error: "Unsafe upstream" });
      const incoming = new URL(req.url || "/", "https://hub.invalid");
      for (const [name, value] of incoming.searchParams) target.searchParams.set(name, value);
      const upstream = await fetch(target, { method: api.method === "POST" ? "POST" : "GET", headers: { Accept: "application/json", ...(api.method === "POST" ? { "Content-Type": req.headers["content-type"] || "application/json" } : {}) }, ...(api.method === "POST" ? { body: JSON.stringify(await body(req)) } : {}), signal: AbortSignal.timeout(20000), redirect: "error" });
      const response = await upstream.text();
      await d.collection("keys").updateOne({ _id: key._id }, { $inc: { used: 1 } });
      await d.collection("usage").insertOne({ keyId: key._id, apiSlug: api.slug, status: upstream.status, at: new Date() });
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      res.setHeader("Cache-Control", "no-store");
      return res.end(response);
    }

    return send(res, 404, { error: "Route not found" });
  } catch (error) {
    console.error("SHAN API HUB", error);
    return send(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
}
