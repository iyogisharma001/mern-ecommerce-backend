import { Request, Response } from "express";
import { stripe } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { Checkout } from "../models/checkout.js";
import { Coupon } from "../models/coupon.js";
import { Product } from "../models/product.js";
import { ShippingInfoType } from "../types/types.js";
import { finalizeCheckout } from "../utils/features.js";
import ErrorHandler from "../utils/utility-class.js";

// Same pricing rules as the frontend cart (cartReducer.calculatePrice)
export const TAX_RATE = 0.18;
export const FREE_SHIPPING_ABOVE = 1000;
export const SHIPPING_CHARGE = 200;

// Country names the shipping form can send -> ISO 3166-1 alpha-2 codes.
// Add a line here when you add a country to the frontend's shipping form.
const COUNTRY_CODES: Record<string, string> = {
  india: "IN",
};

export const toCountryCode = (country: string) => {
  const value = country.trim();
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  return COUNTRY_CODES[value.toLowerCase()] ?? null;
};

export const createPaymentIntent = TryCatch(async (req, res, next) => {
  const user = req.user!;

  const {
    items,
    shippingInfo,
    coupon,
  }: {
    items: { productId: string; quantity: number }[] | undefined;
    shippingInfo: ShippingInfoType | undefined;
    coupon: string | undefined;
  } = req.body;

  if (!Array.isArray(items) || items.length === 0)
    return next(new ErrorHandler("Please send items", 400));

  if (
    !shippingInfo ||
    !shippingInfo.address ||
    !shippingInfo.city ||
    !shippingInfo.state ||
    !shippingInfo.country ||
    !shippingInfo.pinCode
  )
    return next(new ErrorHandler("Please send complete shipping info", 400));

  // Stripe only accepts 2-letter ISO country codes ("IN"), not "india"
  const countryCode = toCountryCode(String(shippingInfo.country));
  if (!countryCode)
    return next(new ErrorHandler("Unsupported shipping country", 400));

  // Merge repeated lines of the same product, otherwise [{p,3},{p,3}] with
  // stock 5 passes the per-line stock check twice and oversells
  const merged = new Map<string, number>();
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1)
      return next(new ErrorHandler("Invalid quantity", 400));
    const id = String(item.productId);
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  const mergedItems = [...merged].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));

  // Prices, names and photos come from the DATABASE, never from the client
  const products = await Product.find({
    _id: { $in: mergedItems.map((i) => i.productId) },
  });

  const orderItems = [];
  for (const item of mergedItems) {
    const product = products.find((p) => p._id.toString() === item.productId);
    if (!product) return next(new ErrorHandler("Product not found", 404));

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1)
      return next(new ErrorHandler("Invalid quantity", 400));

    if (quantity > product.stock)
      return next(
        new ErrorHandler(`Only ${product.stock} left of ${product.name}`, 400)
      );

    orderItems.push({
      productId: product._id,
      name: product.name,
      photo: product.photos[0]?.url || "",
      price: product.price,
      quantity,
    });
  }

  const subtotal = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);

  let discount = 0;
  if (coupon) {
    const found = await Coupon.findOne({ code: String(coupon) });
    if (!found) return next(new ErrorHandler("Invalid Coupon Code", 400));
    // A coupon can never make the total negative
    discount = Math.min(found.amount, subtotal);
  }

  const tax = Math.round(subtotal * TAX_RATE);
  const shippingCharges = subtotal > FREE_SHIPPING_ABOVE ? 0 : SHIPPING_CHARGE;
  const total = subtotal + tax + shippingCharges - discount;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: "inr",
    description: "MERN-Ecommerce",
    metadata: { userId: user._id },
    shipping: {
      name: user.name,
      address: {
        line1: shippingInfo.address,
        postal_code: String(shippingInfo.pinCode),
        city: shippingInfo.city,
        state: shippingInfo.state,
        country: countryCode,
      },
    },
  });

  await Checkout.create({
    paymentIntentId: paymentIntent.id,
    user: user._id,
    shippingInfo,
    orderItems,
    subtotal,
    tax,
    shippingCharges,
    discount,
    total,
  });

  return res.status(201).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
  });
});

/*
  Stripe webhook - creates the order even if the customer closes the tab
  right after paying, or gets redirected away for 3-D Secure.
  Set STRIPE_WEBHOOK_SECRET in .env and point Stripe to
  POST /api/v1/payment/webhook (event: payment_intent.succeeded).
  This route must receive the RAW body (see app.ts).
*/
export const stripeWebhook = async (req: Request, res: Response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return res.status(400).json({ message: "Webhook secret not configured" });

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"] as string,
      secret
    );
  } catch {
    return res.status(400).json({ message: "Invalid signature" });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;

    // Not created by our createPaymentIntent (e.g. another app on the same
    // Stripe account): retrying can never help, so acknowledge with 200
    if (!paymentIntent.metadata?.userId) {
      console.log(`Webhook: ignoring ${paymentIntent.id} (no metadata.userId)`);
      return res.status(200).json({ received: true, ignored: true });
    }

    try {
      await finalizeCheckout(paymentIntent.id);
    } catch (error) {
      // ErrorHandler = a business-rule failure (no Checkout, amount mismatch):
      // a retry would fail the same way, so log it and stop Stripe retrying
      if (error instanceof ErrorHandler) {
        console.log(
          `Webhook: could not create order for ${paymentIntent.id}: ${error.message}`
        );
        return res.status(200).json({ received: true, ignored: true });
      }

      // Real failure (DB/Stripe/network): 500 makes Stripe retry later
      console.log("Webhook order creation failed:", error);
      return res.status(500).json({ received: false });
    }
  }

  return res.status(200).json({ received: true });
};

export const newCoupon = TryCatch(async (req, res, next) => {
  const { code, amount } = req.body;

  if (!code || !amount)
    return next(new ErrorHandler("Please enter both coupon and amount", 400));

  if (Number(amount) <= 0)
    return next(new ErrorHandler("Amount must be greater than 0", 400));

  await Coupon.create({ code, amount });

  return res.status(201).json({
    success: true,
    message: `Coupon ${code} Created Successfully`,
  });
});

export const applyDiscount = TryCatch(async (req, res, next) => {
  const { coupon } = req.query;

  const discount = await Coupon.findOne({ code: String(coupon) });

  if (!discount) return next(new ErrorHandler("Invalid Coupon Code", 400));

  return res.status(200).json({
    success: true,
    discount: discount.amount,
  });
});

export const allCoupons = TryCatch(async (req, res, next) => {
  const coupons = await Coupon.find({});

  return res.status(200).json({
    success: true,
    coupons,
  });
});

export const getCoupon = TryCatch(async (req, res, next) => {
  const { id } = req.params;

  const coupon = await Coupon.findById(id);

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  return res.status(200).json({
    success: true,
    coupon,
  });
});

export const updateCoupon = TryCatch(async (req, res, next) => {
  const { id } = req.params;

  const { code, amount } = req.body;

  const coupon = await Coupon.findById(id);

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  if (code) coupon.code = code;
  if (amount !== undefined && amount !== "") {
    if (Number(amount) <= 0)
      return next(new ErrorHandler("Amount must be greater than 0", 400));
    coupon.amount = amount;
  }

  await coupon.save();

  return res.status(200).json({
    success: true,
    message: `Coupon ${coupon.code} Updated Successfully`,
  });
});

export const deleteCoupon = TryCatch(async (req, res, next) => {
  const { id } = req.params;

  const coupon = await Coupon.findByIdAndDelete(id);

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  return res.status(200).json({
    success: true,
    message: `Coupon ${coupon.code} Deleted Successfully`,
  });
});
