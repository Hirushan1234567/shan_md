import { randomBytes } from "node:crypto";
import { db, sha, redirect, config } from "../../developer/_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CALLBACK_URL } = config();
    const state = randomBytes(32).toString("hex");
    const database = await db();

    await database.collection("apiOAuthStates").insertOne({
      hash: sha(state),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", GOOGLE_CALLBACK_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");

    return redirect(res, url.toString());
  } catch (error) {
    console.error("Google login start:", error.message);
    return res.status(500).json({ error: "Google Login is not configured yet" });
  }
}
