import { UploadApiResponse, v2 as cloudinary } from "cloudinary";
import { Redis } from "ioredis";
import mongoose, { Document } from "mongoose";
import { redis, stripe } from "../app.js";
import { Checkout } from "../models/checkout.js";
import { Order } from "../models/order.js";
import { Product } from "../models/product.js";
import { Review } from "../models/review.js";
import { InvalidateCacheProps, OrderItemType } from "../types/types.js";
import ErrorHandler from "./utility-class.js";

export const findAverageRatings = async (
  productId: mongoose.Types.ObjectId
) => {
  let totalRating = 0;

  const reviews = await Review.find({ product: productId });
  reviews.forEach((review) => {
    totalRating += review.rating;
  });

  // Keep one decimal (4.6 stays 4.6 instead of being floored to 4)
  const averageRating = reviews.length
    ? Math.round((totalRating / reviews.length) * 10) / 10
    : 0;

  return {
    numOfReviews: reviews.length,
    ratings: averageRating,
  };
};

const getBase64 = (file: Express.Multer.File) =>
  `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

export const uploadToCloudinary = async (files: Express.Multer.File[]) => {
  const promises = files.map(async (file) => {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      cloudinary.uploader.upload(getBase64(file), (error, result) => {
        if (error) return reject(error);
        resolve(result!);
      });
    });
  });

  const result = await Promise.all(promises);

  return result.map((i) => ({
    public_id: i.public_id,
    url: i.secure_url,
  }));
};

export const deleteFromCloudinary = async (publicIds: string[]) => {
  const promises = publicIds.map((id) => {
    return new Promise<void>((resolve, reject) => {
      cloudinary.uploader.destroy(id, (error, result) => {
        if (error) return reject(error);
        resolve();
      });
    });
  });

  await Promise.all(promises);
};

export const connectRedis = (redisURI: string) => {
  const redis = new Redis(redisURI);

  redis.on("connect", () => console.log("Redis Connected"));
  redis.on("error", (e) => console.log(e));

  return redis;
};

export const connectDB = (uri: string) => {
  mongoose
    .connect(uri, {
      dbName: "Ecommerce_24",
    })
    .then(async (c) => {
      console.log(`DB Connected to ${c.connection.host}`);

      // One-time backfill: orders from before the stockReduced field already
      // had their stock reduced. Without this, the schema default (false)
      // would make deleteOrder skip restocking them. Matches nothing once done.
      const { modifiedCount } = await Order.updateMany(
        { stockReduced: { $exists: false } },
        { $set: { stockReduced: true } }
      );
      if (modifiedCount)
        console.log(`Marked ${modifiedCount} old orders as stockReduced`);
    })
    .catch((e) => console.log(e));
};

export const invalidateCache = async ({
  product,
  order,
  admin,
  review,
  userId,
  orderId,
  productId,
}: InvalidateCacheProps) => {
  if (review) {
    await redis.del([`reviews-${productId}`]);
  }

  if (product) {
    const productKeys: string[] = [
      "latest-products",
      "categories",
      "all-products",
    ];

    if (typeof productId === "string") productKeys.push(`product-${productId}`);

    if (typeof productId === "object")
      productId.forEach((i) => productKeys.push(`product-${i}`));

    await redis.del(productKeys);
  }
  if (order) {
    const ordersKeys: string[] = [
      "all-orders",
      `my-orders-${userId}`,
      `order-${orderId}`,
    ];

    await redis.del(ordersKeys);
  }
  if (admin) {
    await redis.del([
      "admin-stats",
      "admin-pie-charts",
      "admin-bar-charts",
      "admin-line-charts",
    ]);
  }
};

// Atomic stock update that can never go below 0
export const reduceStock = async (orderItems: OrderItemType[]) => {
  for (const item of orderItems) {
    const result = await Product.updateOne(
      { _id: item.productId, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } }
    );

    // Someone bought the last units between payment and now: the customer
    // has already paid, so keep the order but clamp stock at 0
    if (result.modifiedCount === 0) {
      console.log(`Stock ran out for product ${item.productId}`);
      await Product.updateOne({ _id: item.productId }, { $set: { stock: 0 } });
    }
  }
};

// Real month-over-month change: 100 -> 150 is +50%, 100 -> 50 is -50%
export const calculatePercentage = (thisMonth: number, lastMonth: number) => {
  if (lastMonth === 0) return thisMonth > 0 ? 100 : 0;
  const percent = ((thisMonth - lastMonth) / lastMonth) * 100;
  return Number(percent.toFixed(0));
};

// Whole months between two dates, including the year
// (Nov 2025 -> Nov 2026 = 12, not 0)
export const getMonthDiff = (today: Date, date: Date) =>
  (today.getFullYear() - date.getFullYear()) * 12 +
  (today.getMonth() - date.getMonth());

// Makes user text safe to use inside a MongoDB $regex
export const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/*
  Turns a paid Stripe PaymentIntent into an Order. Safe to call more than once
  (from the client confirm call AND the webhook) - only one order is created.
*/
type OrderDoc = InstanceType<typeof Order>;

/*
  Reduces stock for an order exactly once, even across retries.
  The order is CLAIMED first with a conditional update (stockReduced false ->
  true), so of two concurrent retries only one gets past it. If reduceStock
  then throws, the claim is released so the next retry (webhook/client) tries
  again. No transactions, so this works on a standalone (non replica set) Mongo.
  Limitation: if reduceStock fails half-way, the items already reduced will be
  reduced again on retry (reduceStock clamps at 0, so it can't go negative).
*/
const reduceStockOnce = async (order: OrderDoc) => {
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, stockReduced: false },
    { $set: { stockReduced: true } }
  );
  if (!claimed) return; // already reduced, or another request is doing it

  try {
    await reduceStock(
      order.orderItems.map((i) => ({
        productId: String(i.productId),
        quantity: i.quantity!,
        name: i.name!,
        photo: i.photo!,
        price: i.price!,
      }))
    );
  } catch (error) {
    await Order.updateOne(
      { _id: order._id },
      { $set: { stockReduced: false } }
    );
    throw error;
  }

  await invalidateCache({
    product: true,
    admin: true,
    productId: order.orderItems.map((i) => String(i.productId)),
  });
};

export const finalizeCheckout = async (paymentIntentId: string) => {
  // Order already exists: still make sure its stock was reduced, in case an
  // earlier attempt created the order but failed before/while reducing stock
  const existing = await Order.findOne({ paymentIntentId });
  if (existing) {
    await reduceStockOnce(existing);
    return existing;
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (paymentIntent.status !== "succeeded")
    throw new ErrorHandler("Payment not completed", 400);

  const checkout = await Checkout.findOne({ paymentIntentId });
  if (!checkout) throw new ErrorHandler("Checkout not found", 404);

  if (paymentIntent.amount !== Math.round(checkout.total * 100))
    throw new ErrorHandler("Paid amount does not match order", 400);

  let order;
  try {
    order = await Order.create({
      shippingInfo: checkout.shippingInfo,
      orderItems: checkout.orderItems,
      user: checkout.user,
      subtotal: checkout.subtotal,
      tax: checkout.tax,
      shippingCharges: checkout.shippingCharges,
      discount: checkout.discount,
      total: checkout.total,
      paymentIntentId,
    });
  } catch (error) {
    // Another request created it at the same moment; reduceStockOnce makes
    // sure exactly one of the two reduces the stock
    if ((error as { code?: number }).code === 11000) {
      const other = (await Order.findOne({ paymentIntentId }))!;
      await reduceStockOnce(other);
      return other;
    }
    throw error;
  }

  // Show the new order right away, even if the stock step below fails
  await invalidateCache({
    order: true,
    admin: true,
    userId: order.user,
  });

  await reduceStockOnce(order);

  return order;
};

export const getInventories = async ({
  categories,
  productsCount,
}: {
  categories: string[];
  productsCount: number;
}) => {
  const categoriesCountPromise = categories.map((category) =>
    Product.countDocuments({ category })
  );

  const categoriesCount = await Promise.all(categoriesCountPromise);

  const categoryCount: Record<string, number>[] = [];

  categories.forEach((category, i) => {
    categoryCount.push({
      [category]: productsCount
        ? Math.round((categoriesCount[i] / productsCount) * 100)
        : 0,
    });
  });

  return categoryCount;
};

interface MyDocument extends Document {
  createdAt: Date;
  discount?: number;
  total?: number;
}
type FuncProps = {
  length: number;
  docArr: MyDocument[];
  today: Date;
  property?: "discount" | "total";
};

export const getChartData = ({
  length,
  docArr,
  today,
  property,
}: FuncProps) => {
  const data: number[] = new Array(length).fill(0);

  docArr.forEach((i) => {
    const monthDiff = getMonthDiff(today, i.createdAt);

    if (monthDiff >= 0 && monthDiff < length) {
      if (property) {
        data[length - monthDiff - 1] += i[property] || 0;
      } else {
        data[length - monthDiff - 1] += 1;
      }
    }
  });

  return data;
};
