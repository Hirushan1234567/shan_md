import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { connectDatabase } from "./config/database.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";

const app = express();
const port = Number(process.env.PORT || 3035);
const host = process.env.HOST || "127.0.0.1";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
const allowedOrigins = String(process.env.APP_ORIGINS || "")
  .split(",").map(value => value.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"]
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "SHAN Developer API Backend" });
});

app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ error: "Origin is not allowed" });
  }
  console.error("[server]", error);
  res.status(500).json({ error: "Internal server error" });
});

try {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("Set JWT_SECRET to at least 32 characters");
  }
  await connectDatabase();
  app.listen(port, host, () => {
    console.log("[server] listening on " + host + ":" + port);
  });
} catch (error) {
  console.error("[startup]", error.message);
  process.exit(1);
}
