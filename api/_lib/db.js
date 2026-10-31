import { MongoClient } from "mongodb";

const COLLECTION = process.env.PAIR_SITE_COLLECTION || "pair_sessions";

let clientPromise = globalThis.__shanMongo;

export async function getDb() {
  const uri = process.env.MONGODB_URI || "";

  console.log("Mongo URI check:", {
    exists: !!uri,
    startsCorrectly: /^mongodb(\+srv)?:\/\//.test(uri.trim()),
    hasQuotes: /^["']/.test(uri.trim()),
    hasEnvPrefix: uri.trim().startsWith("MONGODB_URI=")
  });

  if (!uri && !globalThis.__shanMongo) {
    throw new Error("MONGODB_URI is not set");
  }

  if (!clientPromise) {
    clientPromise = globalThis.__shanMongo = new MongoClient(
      uri,
      { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 }
    ).connect();
  }

  const client = await clientPromise;
  return client.db();
}

export async function sessions() {
  return (await getDb()).collection(COLLECTION);
}

cat > /opt/shan-dashboard-check/api/_lib/db.js <<'EOF'
import { MongoClient } from "mongodb";

const COLLECTION = process.env.PAIR_SITE_COLLECTION || "pair_sessions";

let clientPromise = globalThis.__shanMongo;

export async function getDb() {
  const uri = process.env.MONGODB_URI || "";

  console.log("Mongo URI check:", {
    exists: !!uri,
    startsCorrectly: /^mongodb(\+srv)?:\/\//.test(uri.trim()),
    hasQuotes: /^["']/.test(uri.trim()),
    hasEnvPrefix: uri.trim().startsWith("MONGODB_URI=")
  });

  if (!uri && !globalThis.__shanMongo) {
    throw new Error("MONGODB_URI is not set");
  }

  if (!clientPromise) {
    clientPromise = globalThis.__shanMongo = new MongoClient(
      uri,
      { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 }
    ).connect();
  }

  const client = await clientPromise;
  return client.db();
}

export async function sessions() {
  return (await getDb()).collection(COLLECTION);
}
