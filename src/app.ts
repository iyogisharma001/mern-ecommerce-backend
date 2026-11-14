import express from "express";
import {
  clearReadCaches,
  connectDB,
  connectRedis,
} from "./utils/features.js";
import { errorMiddleware } from "./middlewares/error.js";
import { config } from "dotenv";
import morgan from "morgan";
import Stripe from "stripe";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import helmet from "helmet";
import mongoose from "mongoose";
import { apiLimiter, strictLimiter } from "./middlewares/rate-limit.js";

// Importing Routes
import userRoute from "./routes/user.js";
import productRoute from "./routes/products.js";
import orderRoute from "./routes/order.js";
import paymentRoute from "./routes/payment.js";
import { stripeWebhook } from "./controllers/payment.js";
import dashboardRoute from "./routes/stats.js";

config({
  path: "./.env",
});

const port = process.env.PORT || 4000;
const mongoURI = process.env.MONGO_URI || "";
const stripeKey = process.env.STRIPE_KEY || "";
const redisURI = process.env.REDIS_URI || "";
// One or more frontend URLs, comma-separated:
// CLIENT_URL=http://localhost:5173,https://my-shop.vercel.app
const clientURLs = (process.env.CLIENT_URL || "")
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (clientURLs.length === 0)
  console.warn(
    "WARNING: CLIENT_URL is not set in .env - browsers will be blocked by CORS. " +
      "Set it to your frontend URL, e.g. CLIENT_URL=http://localhost:5173"
  );
export const redisTTL = process.env.REDIS_TTL || 60 * 60 * 4;

connectDB(mongoURI);
export const redis = connectRedis(redisURI);
redis.once("ready", () => {
  clearReadCaches(redis).catch((e) =>
    console.log("Could not clear caches on startup:", e)
  );
});

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

export const stripe = new Stripe(stripeKey);

const app = express();
const isProduction = process.env.NODE_ENV === "production";

// Render (and most hosts) sit behind one proxy: needed for real client IPs,
// which the rate limiter relies on
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());

// Stripe webhook needs the raw body for signature checks -> before express.json()
app.post(
  "/api/v1/payment/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json({ limit: "100kb" }));
app.use(morgan(isProduction ? "combined" : "dev"));
app.use(
  cors({
    origin: clientURLs,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.send("API Working with /api/v1");
});

// Liveness + dependency status, for uptime monitors and debugging deploys
app.get("/api/v1/health", (req, res) => {
  const db = mongoose.connection.readyState === 1;
  const cache = redis.status === "ready";
  res.status(db && cache ? 200 : 503).json({
    status: db && cache ? "ok" : "degraded",
    db: db ? "connected" : "disconnected",
    cache: cache ? "connected" : redis.status,
    uptime: Math.round(process.uptime()),
  });
});

// Rate limits: a general one for the whole API, a stricter one for
// sign-up and payment creation (the Stripe webhook above is not limited)
app.use("/api/v1", apiLimiter);
app.use(["/api/v1/user/new", "/api/v1/payment/create"], strictLimiter);

// Using Routes
app.use("/api/v1/user", userRoute);
app.use("/api/v1/product", productRoute);
app.use("/api/v1/order", orderRoute);
app.use("/api/v1/payment", paymentRoute);
app.use("/api/v1/dashboard", dashboardRoute);

// Unknown API route -> JSON 404 instead of Express's HTML page
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use(errorMiddleware);

app.listen(port, () => {
  console.log(`Express is working on http://localhost:${port}`);
});
