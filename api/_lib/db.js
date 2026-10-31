import { MongoClient } from "mongodb";

const COLLECTION = process.env.PAIR_SITE_COLLECTION || "pair_sessions";
let clientPromise = globalThis.__shanMongo;

export async function getDb() {
  const uri = process.env.MONGODB_URI || "";

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
