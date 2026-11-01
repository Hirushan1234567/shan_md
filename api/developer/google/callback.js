import { randomBytes } from "node:crypto";
import { db, sha, setCookie, redirect, config } from "../../developer/_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = config();
    const code = String(req.query?.code || "");
    const state = String(req.query?.state || "");
    if (!code || !state) return res.status(400).send("Google login was cancelled or invalid.");

    const database = await db();
    const states = database.collection("apiOAuthStates");
    const savedState = await states.findOneAndDelete({
      hash: sha(state),
      expiresAt: { $gt: new Date() }
    });

    if (!savedState) return res.status(400).send("Invalid or expired login state.");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: "authorization_code"
      })
    });

    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("Google token exchange failed:", tokens.error || tokenResponse.status);
      return res.status(401).send("Google login failed. Please try again.");
    }

    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResponse.json();

    if (!profileResponse.ok || !profile.email || profile.verified_email !== true) {
      return res.status(401).send("A verified Google email is required.");
    }

    const email = String(profile.email).trim().toLowerCase();
    const now = new Date();

    await database.collection("apiDevelopers").updateOne(
      { email },
      {
        $set: {
          name: String(profile.name || ""),
          picture: String(profile.picture || ""),
          googleId: String(profile.id || ""),
          emailVerified: true,
          lastLoginAt: now
        },
        $setOnInsert: { createdAt: now, plan: "free" }
      },
      { upsert: true }
    );

    const sessionToken = randomBytes(32).toString("hex");
    await database.collection("apiSessions").insertOne({
      tokenHash: sha(sessionToken),
      email,
      createdAt: now,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    setCookie(res, sessionToken, 30 * 24 * 60 * 60);
    return redirect(res, "/developer.html");
  } catch (error) {
    console.error("Google callback:", error.message);
    return res.status(500).send("Login failed. Please try again.");
  }
}
