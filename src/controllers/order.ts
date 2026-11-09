import { redis, redisTTL } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { Checkout } from "../models/checkout.js";
import { Order } from "../models/order.js";
import { Product } from "../models/product.js";
import { finalizeCheckout, invalidateCache } from "../utils/features.js";
import ErrorHandler from "../utils/utility-class.js";

// Logged-in user's own orders (user comes from the verified token, not the URL)
export const myOrders = TryCatch(async (req, res, next) => {
  const user = req.user!._id;

  const key = `my-orders-${user}`;

  let orders;

  orders = await redis.get(key);

  if (orders) orders = JSON.parse(orders);
  else {
    orders = await Order.find({ user }).sort({ createdAt: -1 });
    await redis.setex(key, redisTTL, JSON.stringify(orders));
  }
  return res.status(200).json({
    success: true,
    orders,
  });
});

export const allOrders = TryCatch(async (req, res, next) => {
  const key = `all-orders`;

  let orders;

  orders = await redis.get(key);

  if (orders) orders = JSON.parse(orders);
  else {
    orders = await Order.find().populate("user", "name").sort({ createdAt: -1 });
    await redis.setex(key, redisTTL, JSON.stringify(orders));
  }
  return res.status(200).json({
    success: true,
    orders,
  });
});

// Only the order's owner or an admin can see it
export const getSingleOrder = TryCatch(async (req, res, next) => {
  const { id } = req.params;
  const key = `order-${id}`;

  let order;
  order = await redis.get(key);

  if (order) order = JSON.parse(order);
  else {
    order = await Order.findById(id).populate("user", "name");

    if (!order) return next(new ErrorHandler("Order Not Found", 404));

    await redis.setex(key, redisTTL, JSON.stringify(order));
  }

  // user is populated -> { _id, name }; may be null if the user was deleted
  const ownerId = order.user?._id ?? order.user;
  if (req.user!.role !== "admin" && String(ownerId) !== req.user!._id)
    return next(new ErrorHandler("Order Not Found", 404));

  return res.status(200).json({
    success: true,
    order,
  });
});

/*
  Called by the frontend after Stripe confirms the payment.
  Body: { paymentIntentId }. Prices/items are NOT accepted from the client -
  the order is built from the server-side Checkout after verifying with Stripe.
*/
export const newOrder = TryCatch(async (req, res, next) => {
  const { paymentIntentId } = req.body as { paymentIntentId?: string };

  if (!paymentIntentId)
    return next(new ErrorHandler("Payment ID is required", 400));

  const checkout = await Checkout.findOne({ paymentIntentId: String(paymentIntentId) });
  if (!checkout) return next(new ErrorHandler("Checkout not found", 404));

  if (checkout.user !== req.user!._id)
    return next(new ErrorHandler("Not allowed", 403));

  await finalizeCheckout(String(paymentIntentId));

  return res.status(201).json({
    success: true,
    message: "Order Placed Successfully",
  });
});

export const processOrder = TryCatch(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id);

  if (!order) return next(new ErrorHandler("Order Not Found", 404));

  switch (order.status) {
    case "Processing":
      order.status = "Shipped";
      break;
    case "Shipped":
      order.status = "Delivered";
      break;
    default:
      order.status = "Delivered";
      break;
  }

  await order.save();

  await invalidateCache({
    product: false,
    order: true,
    admin: true,
    userId: order.user,
    orderId: String(order._id),
  });

  return res.status(200).json({
    success: true,
    message: "Order Processed Successfully",
  });
});

export const deleteOrder = TryCatch(async (req, res, next) => {
  const { id } = req.params;

  // findByIdAndDelete is atomic: if two admins delete at once, only one gets
  // the order back, so stock can't be restored twice
  const order = await Order.findByIdAndDelete(id);
  if (!order) return next(new ErrorHandler("Order Not Found", 404));

  // Give the stock back only if it was taken and the goods haven't left yet
  // (Shipped/Delivered orders keep their stock reduction)
  const restock = order.status === "Processing" && order.stockReduced;
  if (restock)
    await Promise.all(
      order.orderItems.map((i) =>
        Product.updateOne(
          { _id: i.productId },
          { $inc: { stock: i.quantity || 0 } }
        )
      )
    );

  await invalidateCache({
    product: restock,
    productId: order.orderItems.map((i) => String(i.productId)),
    order: true,
    admin: true,
    userId: order.user,
    orderId: String(order._id),
  });

  return res.status(200).json({
    success: true,
    message: "Order Deleted Successfully",
  });
});
