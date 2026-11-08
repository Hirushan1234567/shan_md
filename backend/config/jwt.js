import jwt from "jsonwebtoken";

export function signAccessToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  return jwt.sign(
    { role: user.role },
    secret,
    { subject: String(user._id), expiresIn: "12h", issuer: "shan-api-hub" }
  );
}
