import rateLimit from "express-rate-limit";

const message = (text: string) => ({ success: false, message: text });

// Normal browsing: 300 requests per 15 minutes per IP
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: message("Too many requests, please try again in a few minutes"),
});

// Sign-up and starting a payment: 20 per 15 minutes per IP
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: message("Too many attempts, please wait a few minutes and try again"),
});
