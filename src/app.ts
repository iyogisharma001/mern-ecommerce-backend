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

// Stripe webhook needs the raw body for signature checks -> before express.json()
app.post(
  "/api/v1/payment/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json());
app.use(morgan("dev"));
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

// Using Routes
app.use("/api/v1/user", userRoute);
app.use("/api/v1/product", productRoute);
app.use("/api/v1/order", orderRoute);
app.use("/api/v1/payment", paymentRoute);
app.use("/api/v1/dashboard", dashboardRoute);

app.use("/uploads", express.static("uploads"));
app.use(errorMiddleware);

app.listen(port, () => {
  console.log(`Express is working on http://localhost:${port}`);
});
