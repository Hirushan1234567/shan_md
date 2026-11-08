import crypto from "node:crypto";
import { promisify } from "node:util";
import { MongoClient, ObjectId } from "mongodb";
import { dispatchCategory } from "../modules/registry.js";

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

      const configuredBase = String(process.env.PAIR_API_URL || process.env.BOT_API_URL || "").trim().replace(/\/+$/, "");
      const pairSecret = String(process.env.PAIR_API_SECRET || process.env.SHAN_API_KEY || "").trim();
      if (!configuredBase || !pairSecret) return send(res, 503, { error: "WhatsApp pairing service is not configured. Set PAIR_API_URL and PAIR_API_SECRET." });

      let upstreamUrl;
      try { upstreamUrl = new URL(configuredBase); } catch { return send(res, 500, { error: "Invalid PAIR_API_URL configuration" }); }
      if (upstreamUrl.protocol !== "https:") return send(res, 500, { error: "PAIR_API_URL must use HTTPS" });
      const pairRoot = configuredBase.replace(/\/pair-api\/?$/, "") + "/pair-api";
      const response = await fetch(pairRoot + "/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pair-secret": pairSecret },
        body: JSON.stringify({ number: phoneNumber }),
        signal: AbortSignal.timeout(30000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return send(res, response.status || 502, { error: result.error || "Could not create pairing session" });
      if (!result.pairCode) return send(res, 502, { error: "Pairing service did not return a pairing code" });

      const publicId = crypto.randomBytes(24).toString("hex");
      await d.collection("pairingSessions").insertOne({
        publicId, phoneNumber, createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60000)
      });
      return send(res, 200, {
        success: true, sessionId: publicId, phoneNumber,
        status: result.status || "pairing", pairCode: result.pairCode
      });
    }

    if (path[0] === "pair" && path[1] && method === "GET") {
      const record = await d.collection("pairingSessions").findOne({
        publicId: path[1], expiresAt: { $gt: new Date() }
      });
      if (!record) return send(res, 404, { error: "Pairing session not found" });

      const configuredBase = String(process.env.PAIR_API_URL || process.env.BOT_API_URL || "").trim().replace(/\/+$/, "");
      const pairSecret = String(process.env.PAIR_API_SECRET || process.env.SHAN_API_KEY || "").trim();
      if (!configuredBase || !pairSecret) return send(res, 503, { error: "WhatsApp pairing service is not configured" });
      const upstreamUrl = new URL(configuredBase);
      if (upstreamUrl.protocol !== "https:") return send(res, 500, { error: "PAIR_API_URL must use HTTPS" });
      const pairRoot = configuredBase.replace(/\/pair-api\/?$/, "") + "/pair-api";
      const response = await fetch(pairRoot + "/api/pair/" + encodeURIComponent(record.phoneNumber), {
        headers: { "x-pair-secret": pairSecret }, signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return send(res, response.status, { error: result.error || "Could not read pairing status" });
      return send(res, 200, {
        success: true, sessionId: path[1], phoneNumber: record.phoneNumber,
        status: result.status || "pending", pairCode: result.pairCode || null,
        active: result.active === true, error: result.error || null
      });
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
        limit: null
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
        const freeLimit = Number(input.freeLimit ?? 200);
        const premiumLimit = Number(input.premiumLimit ?? 5000);
        if (!Number.isSafeInteger(freeLimit) || freeLimit < 1 || freeLimit > 1000000000 ||
            !Number.isSafeInteger(premiumLimit) || premiumLimit < 1 || premiumLimit > 1000000000) {
          return send(res, 400, { error: "Free and Premium limits must be whole numbers between 1 and 1,000,000,000" });
        }
        const quotaPeriod = ["lifetime", "daily", "monthly"].includes(input.quotaPeriod) ? input.quotaPeriod : "lifetime";
        const creator = String(input.creator || "@SHAN").trim().slice(0, 60) || "@SHAN";
        const quotaMessage = String(input.quotaMessage || "Please upgrade to Premium or Membership on the SHAN Developer Portal.").trim().slice(0, 240);
        let parameters = [], sampleResponse = null;
        try { parameters = input.parametersJSON ? JSON.parse(input.parametersJSON) : []; } catch { return send(res, 400, { error: "Parameters must be valid JSON" }); }
        try { sampleResponse = input.sampleResponseJSON ? JSON.parse(input.sampleResponseJSON) : null; } catch { return send(res, 400, { error: "Sample response must be valid JSON" }); }
        if (!Array.isArray(parameters) && (typeof parameters !== "object" || parameters === null)) return send(res, 400, { error: "Parameters must be a JSON object or array" });
        const originalSlug = String(input.originalSlug || "").trim().toLowerCase();
        if (originalSlug) {
          const oldApi = await d.collection("apis").findOne({ slug: originalSlug });
          if (!oldApi) return send(res, 404, { error: "API being edited was not found" });
          if (originalSlug !== slug && await d.collection("apis").findOne({ slug })) {
            return send(res, 409, { error: "That API slug is already in use" });
          }
        }
        const selector = originalSlug ? { slug: originalSlug } : { slug };
        await d.collection("apis").updateOne(selector, {
          $set: {
            name, slug, description, category, method: apiMethod, sourceUrl: source.toString(),
            parameters, sampleResponse,
            docsUrl: String(input.docsUrl || "").trim().slice(0, 500),
            tags: String(input.tags || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 12),
            plan: input.plan === "premium" ? "premium" : "free",
            freeLimit, premiumLimit, quotaPeriod, creator, quotaMessage,
            active: input.active === false || input.active === "false" ? false : true, updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        }, { upsert: !originalSlug });
        return send(res, originalSlug ? 200 : 201, { ok: true, slug });
      }
    }


    if (path[0] === "admin" && path[1] === "categories") {
      if (!isAdmin(user)) return send(res, 403, { error: "Admin access required" });
      if (method === "GET" && path.length === 2) {
        const categories = await d.collection("apiCategories").find({}).sort({ createdAt: -1 }).toArray();
        return send(res, 200, { categories });
      }
      if (method === "POST" && path.length === 2) {
        const input = await body(req);
        const name = String(input.name || "").trim().slice(0, 80);
        const slug = String(input.slug || "").trim().toLowerCase();
        const description = String(input.description || "").trim().slice(0, 500);
        if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !description) {
          return send(res, 400, { error: "Enter a name, valid lowercase slug and description" });
        }
        const access = input.access === "premium" ? "premium" : "free";
        const freeLimit = Number(input.freeLimit ?? 200);
        const premiumLimit = Number(input.premiumLimit ?? 5000);
        if (!Number.isSafeInteger(freeLimit) || freeLimit < 1 || freeLimit > 1000000000 ||
            !Number.isSafeInteger(premiumLimit) || premiumLimit < 1 || premiumLimit > 1000000000) {
          return send(res, 400, { error: "Quota limits must be whole numbers between 1 and 1,000,000,000" });
        }
        const quotaPeriod = ["lifetime", "daily", "monthly"].includes(input.quotaPeriod) ? input.quotaPeriod : "lifetime";
        const originalSlug = String(input.originalSlug || "").trim().toLowerCase();
        const existing = await d.collection("apiCategories").findOne({ slug });
        if (existing && slug !== originalSlug) return send(res, 409, { error: "That category slug already exists" });
        if (originalSlug && originalSlug !== slug) {
          const old = await d.collection("apiCategories").findOne({ slug: originalSlug });
          if (!old) return send(res, 404, { error: "Category being edited was not found" });
          await d.collection("moduleItems").updateMany({ categorySlug: originalSlug }, { $set: { categorySlug: slug } });
          await d.collection("usage").updateMany({ categorySlug: originalSlug }, { $set: { categorySlug: slug } });
        }
        const enabled = input.enabled === false || input.enabled === "false" ? false : true;
        const parameters = Array.isArray(input.parameters) ? input.parameters.slice(0, 30) : [];
        let exampleResponse = null;
        try { exampleResponse = input.exampleResponseJSON ? JSON.parse(input.exampleResponseJSON) : null; }
        catch { return send(res, 400, { error: "Example response must be valid JSON" }); }
        const selector = originalSlug ? { slug: originalSlug } : { slug };
        await d.collection("apiCategories").updateOne(selector, {
          $set: { name, slug, description, access, enabled, freeLimit, premiumLimit, quotaPeriod,
            quotaMessage: String(input.quotaMessage || "Request quota exhausted. Please upgrade your plan.").trim().slice(0, 240),
            creator: String(input.creator || "@SHAN").trim().slice(0, 60) || "@SHAN",
            parameters, exampleResponse, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() }
        }, { upsert: !originalSlug });
        return send(res, originalSlug ? 200 : 201, { ok: true, slug });
      }
      if (method === "DELETE" && path[2]) {
        const slug = String(path[2]).toLowerCase();
        const result = await d.collection("apiCategories").deleteOne({ slug });
        await d.collection("moduleItems").deleteMany({ categorySlug: slug });
        return send(res, result.deletedCount ? 200 : 404, result.deletedCount ? { ok: true } : { error: "Category not found" });
      }
      if (path[2] && path.length === 3 && method === "GET") {
        const category = await d.collection("apiCategories").findOne({ slug: String(path[2]).toLowerCase() });
        if (!category) return send(res, 404, { error: "Category not found" });
        const items = await d.collection("moduleItems").find({ categorySlug: category.slug }).sort({ createdAt: -1 }).limit(200).toArray();
        return send(res, 200, { category, items });
      }
      if (path[2] && path.length === 3 && method === "POST") {
        const slug = String(path[2]).toLowerCase();
        const category = await d.collection("apiCategories").findOne({ slug });
        if (!category) return send(res, 404, { error: "Category not found" });
        const input = await body(req);
        const title = String(input.title || "").trim().slice(0, 160);
        if (!title) return send(res, 400, { error: "Item title is required" });
        let customFields = {};
        try { customFields = typeof input.customFieldsJSON === "string" ? JSON.parse(input.customFieldsJSON || "{}") : (input.customFields || {}); }
        catch { return send(res, 400, { error: "Custom fields must be valid JSON" }); }
        if (!customFields || typeof customFields !== "object" || Array.isArray(customFields) || Object.keys(customFields).length > 40) {
          return send(res, 400, { error: "Custom fields must be a JSON object with up to 40 fields" });
        }
        const item = { categorySlug: slug, title, customFields, searchText: JSON.stringify(customFields),
          published: input.published === false || input.published === "false" ? false : true,
          createdAt: new Date(), updatedAt: new Date() };
        const result = await d.collection("moduleItems").insertOne(item);
        return send(res, 201, { ok: true, id: String(result.insertedId) });
      }
      if (path[2] && path[3] && path.length === 4 && ["PUT", "PATCH"].includes(method)) {
        const slug = String(path[2]).toLowerCase();
        if (!ObjectId.isValid(path[3])) return send(res, 400, { error: "Invalid item ID" });
        const input = await body(req);
        const update = { updatedAt: new Date() };
        if (input.title !== undefined) update.title = String(input.title || "").trim().slice(0, 160);
        if (input.published !== undefined) update.published = !(input.published === false || input.published === "false");
        if (input.customFieldsJSON !== undefined || input.customFields !== undefined) {
          try { update.customFields = typeof input.customFieldsJSON === "string" ? JSON.parse(input.customFieldsJSON || "{}") : input.customFields;
          update.searchText = JSON.stringify(update.customFields); }
          catch { return send(res, 400, { error: "Custom fields must be valid JSON" }); }
          if (!update.customFields || typeof update.customFields !== "object" || Array.isArray(update.customFields) || Object.keys(update.customFields).length > 40) {
            return send(res, 400, { error: "Custom fields must be a JSON object with up to 40 fields" });
          }
        }
        const result = await d.collection("moduleItems").updateOne({ _id: new ObjectId(path[3]), categorySlug: slug }, { $set: update });
        return send(res, result.matchedCount ? 200 : 404, result.matchedCount ? { ok: true } : { error: "Item not found" });
      }
      if (path[2] && path[3] && path.length === 4 && method === "DELETE") {
        if (!ObjectId.isValid(path[3])) return send(res, 400, { error: "Invalid item ID" });
        const result = await d.collection("moduleItems").deleteOne({ _id: new ObjectId(path[3]), categorySlug: String(path[2]).toLowerCase() });
        return send(res, result.deletedCount ? 200 : 404, result.deletedCount ? { ok: true } : { error: "Item not found" });
      }
    }

    if (path[0] === "admin" && path[1] === "category-stats") {
      if (!isAdmin(user)) return send(res, 403, { error: "Admin access required" });
      const rows = await d.collection("usage").aggregate([
        { $match: { categorySlug: { $exists: true, $ne: null } } },
        { $group: { _id: "$categorySlug", requests: { $sum: 1 }, lastRequest: { $max: "$at" } } },
        { $sort: { requests: -1 } }
      ]).toArray();
      return send(res, 200, { stats: rows.map(x => ({ slug: x._id, requests: x.requests, lastRequest: x.lastRequest })) });
    }

    if (path[0] === "usage" && path[1] === "categories") {
      if (!user) return send(res, 401, { error: "Sign in required" });
      const keys = await d.collection("keys").find({ userId: user._id }, { projection: { _id: 1 } }).toArray();
      const keyIds = keys.map(x => x._id);
      const rows = keyIds.length ? await d.collection("usage").aggregate([
        { $match: { keyId: { $in: keyIds }, categorySlug: { $exists: true, $ne: null } } },
        { $group: { _id: "$categorySlug", requests: { $sum: 1 } } },
        { $sort: { requests: -1 } }
      ]).toArray() : [];
      return send(res, 200, { stats: rows.map(x => ({ slug: x._id, requests: x.requests })) });
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
      const quotaLimit = key.plan === "premium" ? Number(api.premiumLimit ?? 5000) : Number(api.freeLimit ?? 50);
      const quotaQuery = { keyId: key._id, apiSlug: api.slug };
      const quotaPeriod = ["lifetime", "daily", "monthly"].includes(api.quotaPeriod) ? api.quotaPeriod : "lifetime";
      if (quotaPeriod !== "lifetime") {
        const periodStart = new Date();
        if (quotaPeriod === "daily") periodStart.setUTCHours(0, 0, 0, 0);
        else { periodStart.setUTCDate(1); periodStart.setUTCHours(0, 0, 0, 0); }
        quotaQuery.at = { $gte: periodStart };
      }
      const usedForApi = await d.collection("usage").countDocuments(quotaQuery);
      if (usedForApi >= quotaLimit) {
        const upgrade = api.quotaMessage || "Please upgrade to Premium or Membership on the SHAN Developer Portal.";
        return send(res, 429, {
          status: false,
          creator: api.creator || "@SHAN",
          detail: `Request quota exhausted (${usedForApi}/${quotaLimit} requests used). ${upgrade}`
        });
      }
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


    if (path[0] === "v1" && path[1] === "categories" && method === "GET") {
      const categories = await d.collection("apiCategories").find({ enabled: true },
        { projection: { _id: 0, name: 1, slug: 1, description: 1, access: 1, freeLimit: 1, premiumLimit: 1, quotaPeriod: 1, parameters: 1, exampleResponse: 1, creator: 1 } }
      ).sort({ name: 1 }).toArray();
      return send(res, 200, { status: true, creator: "@SHAN", result: categories });
    }

    if (path[0] === "v1" && path[1] && path[2] && method === "GET") {
      const slug = String(path[1]).toLowerCase();
      const action = String(path[2]).toLowerCase();
      const category = await d.collection("apiCategories").findOne({ slug, enabled: true });
      if (!category) return send(res, 404, { status: false, creator: "@SHAN", detail: "API category not found or disabled" });
      const incoming = new URL(req.url || "/", "https://hub.invalid");
      const raw = req.headers["x-api-key"] || incoming.searchParams.get("api_key");
      if (!raw) return send(res, 401, { status: false, creator: category.creator || "@SHAN", detail: "API key required. Send x-api-key header or api_key query parameter." });
      const key = await d.collection("keys").findOne({ keyHash: sha(String(raw)), revoked: { $ne: true } });
      if (!key) return send(res, 401, { status: false, creator: category.creator || "@SHAN", detail: "Invalid API key" });
      const plan = key.plan === "premium" ? "premium" : "free";
      if (category.access === "premium" && plan !== "premium") {
        return send(res, 403, { status: false, creator: category.creator || "@SHAN", detail: "Premium plan required for this API category" });
      }
      const quotaLimit = plan === "premium" ? Number(category.premiumLimit ?? 5000) : Number(category.freeLimit ?? 200);
      const quotaQuery = { keyId: key._id, categorySlug: slug };
      const quotaPeriod = ["daily", "monthly", "lifetime"].includes(category.quotaPeriod) ? category.quotaPeriod : "lifetime";
      if (quotaPeriod !== "lifetime") {
        const periodStart = new Date();
        if (quotaPeriod === "daily") periodStart.setUTCHours(0, 0, 0, 0);
        else { periodStart.setUTCDate(1); periodStart.setUTCHours(0, 0, 0, 0); }
        quotaQuery.at = { $gte: periodStart };
      }
      const used = await d.collection("usage").countDocuments(quotaQuery);
      if (used >= quotaLimit) {
        return send(res, 429, { status: false, creator: category.creator || "@SHAN",
          detail: "Request quota exhausted (" + used + "/" + quotaLimit + " requests used). " +
            (category.quotaMessage || "Please upgrade your plan.") });
      }
      await d.collection("usage").insertOne({
        keyId: key._id, apiSlug: "v1:" + slug + "/" + action, categorySlug: slug,
        status: 200, at: new Date()
      });
      await d.collection("keys").updateOne({ _id: key._id }, { $inc: { used: 1 } });
      const query = Object.fromEntries(incoming.searchParams.entries());
      delete query.api_key;
      const result = await dispatchCategory({ db: d, category, action, query });
      if (result.statusCode !== 200) return send(res, result.statusCode, {
        status: false, creator: category.creator || "@SHAN", detail: result.detail || "API action failed"
      });
      return send(res, 200, { status: true, creator: category.creator || "@SHAN",
        result: result.result, ...(result.pagination ? { pagination: result.pagination } : {}) });
    }

    return send(res, 404, { error: "Route not found" });
  } catch (error) {
    console.error("SHAN API HUB", error);
    return send(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
}
