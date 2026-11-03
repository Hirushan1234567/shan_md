// Minimal in-memory MongoDB stand-in, used ONLY by the test-suite (see tests/hooks.mjs).
const stores = new Map();
const val = x => (x instanceof Date ? +x : x);
const eq = (a, b) => (a === b) || (val(a) === val(b) && val(a) !== undefined && typeof val(a) !== "object") || (a == null && b == null);
const cmp = (a, b) => { a = val(a); b = val(b); return a < b ? -1 : a > b ? 1 : 0; };
const get = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function setp(o, p, v) { const ks = p.split("."); let x = o; ks.slice(0, -1).forEach(k => { x[k] ??= {}; x = x[k]; }); x[ks.at(-1)] = v; }
const isOp = c => c && typeof c === "object" && !Array.isArray(c) && !(c instanceof Date) && Object.keys(c).some(k => k.startsWith("$"));

function cond(v, c) {
  if (isOp(c)) {
    return Object.entries(c).every(([op, a]) => {
      switch (op) {
        case "$gt": return v != null && cmp(v, a) > 0;
        case "$gte": return v != null && cmp(v, a) >= 0;
        case "$lt": return v != null && cmp(v, a) < 0;
        case "$lte": return v != null && cmp(v, a) <= 0;
        case "$ne": return Array.isArray(v) ? !v.some(x => eq(x, a)) : !eq(v, a);
        case "$in": return a.some(x => eq(v, x));
        case "$nin": return !a.some(x => eq(v, x));
        case "$exists": return (v !== undefined) === a;
        default: throw new Error("mock mongo: unsupported operator " + op);
      }
    });
  }
  if (Array.isArray(v) && !Array.isArray(c)) return v.some(x => eq(x, c));
  return eq(v, c);
}
const match = (d, f = {}) => Object.entries(f).every(([k, c]) =>
  k === "$or" ? c.some(s => match(d, s)) : k === "$and" ? c.every(s => match(d, s)) : cond(get(d, k), c));

function applyUpdate(d, u, inserting) {
  for (const [op, spec] of Object.entries(u)) {
    for (const [k, v] of Object.entries(spec)) {
      if (op === "$set") setp(d, k, v);
      else if (op === "$setOnInsert") { if (inserting) setp(d, k, v); }
      else if (op === "$unset") { delete d[k]; }
      else if (op === "$inc") setp(d, k, (get(d, k) || 0) + v);
      else if (op === "$addToSet") { const a = get(d, k) || []; if (!a.some(x => eq(x, v))) a.push(v); setp(d, k, a); }
      else if (op === "$pull") { const a = get(d, k) || []; setp(d, k, a.filter(x => !(typeof v === "object" ? Object.entries(v).every(([kk, vv]) => eq(x?.[kk], vv)) : eq(x, v)))); }
      else if (op === "$push") {
        const a = get(d, k) || [];
        if (v && v.$each) { const pos = v.$position ?? a.length; a.splice(pos, 0, ...v.$each); if (v.$slice) a.length = Math.min(a.length, v.$slice); }
        else a.push(v);
        setp(d, k, a);
      } else throw new Error("mock mongo: unsupported update " + op);
    }
  }
}

class Cursor {
  constructor(docs) { this.docs = docs; }
  sort(s) { const es = Object.entries(s); this.docs.sort((a, b) => { for (const [k, dir] of es) { const c = dir * cmp(get(a, k), get(b, k)); if (c) return c; } return 0; }); return this; }
  skip(n) { this.docs = this.docs.slice(n); return this; }
  limit(n) { if (n) this.docs = this.docs.slice(0, n); return this; }
  project() { return this; }
  async toArray() { return this.docs.map(d => structuredClone(d)); }
}

class Collection {
  constructor() { this.docs = []; this.unique = []; }
  async createIndex(spec, opts = {}) { if (opts.unique) this.unique.push(Object.keys(spec)); return "ok"; }
  _check(doc, skipId) {
    for (const keys of this.unique) {
      if (keys.some(k => doc[k] == null)) continue;
      if (this.docs.some(d => d._id !== skipId && keys.every(k => eq(d[k], doc[k])))) { const e = new Error("E11000 duplicate key"); e.code = 11000; throw e; }
    }
  }
  async insertOne(doc) {
    doc = structuredClone(doc); doc._id ??= Math.random().toString(16).slice(2);
    if (this.docs.some(d => d._id === doc._id)) { const e = new Error("E11000 duplicate _id"); e.code = 11000; throw e; }
    this._check(doc); this.docs.push(doc); return { insertedId: doc._id };
  }
  async findOne(f) { const d = this.docs.find(x => match(x, f)); return d ? structuredClone(d) : null; }
  find(f) { return new Cursor(this.docs.filter(x => match(x, f))); }
  async countDocuments(f) { return this.docs.filter(x => match(x, f)).length; }
  async updateOne(f, u, o = {}) {
    let d = this.docs.find(x => match(x, f));
    if (!d) {
      if (!o.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      d = {}; Object.entries(f).forEach(([k, c]) => { if (!k.startsWith("$") && !isOp(c)) setp(d, k, c); });
      applyUpdate(d, u, true); d._id ??= Math.random().toString(16).slice(2); this._check(d); this.docs.push(d);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    const copy = structuredClone(d); applyUpdate(copy, u, false); this._check(copy, d._id);
    Object.keys(d).forEach(k => delete d[k]); Object.assign(d, copy);
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }
  async updateMany(f, u) { let n = 0; for (const d of this.docs.filter(x => match(x, f))) { applyUpdate(d, u, false); n++; } return { matchedCount: n, modifiedCount: n }; }
  async replaceOne(f, doc, o = {}) {
    const i = this.docs.findIndex(x => match(x, f));
    if (i >= 0) { this.docs[i] = structuredClone(doc); return { matchedCount: 1 }; }
    if (o.upsert) { this.docs.push(structuredClone(doc)); return { upsertedCount: 1 }; } return { matchedCount: 0 };
  }
  async deleteOne(f) { const i = this.docs.findIndex(x => match(x, f)); if (i >= 0) this.docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
  async deleteMany(f) { const n = this.docs.length; this.docs = this.docs.filter(x => !match(x, f)); return { deletedCount: n - this.docs.length }; }
  async findOneAndUpdate(f, u, o = {}) {
    const d = this.docs.find(x => match(x, f)); if (!d) return null;
    const before = structuredClone(d); applyUpdate(d, u, false);
    return o.returnDocument === "before" ? before : structuredClone(d);
  }
}
const db = { collection(name) { if (!stores.has(name)) stores.set(name, new Collection()); return stores.get(name); } };
export class MongoClient { constructor() {} async connect() { return this; } db() { return db; } }
export class ObjectId { static isValid() { return false; } }
export const __stores = stores;
