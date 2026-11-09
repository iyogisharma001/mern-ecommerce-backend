import mongoose from "mongoose";

/*
  A Checkout is created together with the Stripe PaymentIntent and holds the
  order exactly as the SERVER priced it. When Stripe confirms the payment,
  the real Order is built from this record - never from client-sent totals.
*/
const schema = new mongoose.Schema(
  {
    paymentIntentId: { type: String, required: true, unique: true },
    user: { type: String, ref: "User", required: true },
    shippingInfo: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
      pinCode: { type: Number, required: true },
    },
    orderItems: [
      {
        name: String,
        photo: String,
        price: Number,
        quantity: Number,
        productId: { type: mongoose.Types.ObjectId, ref: "Product" },
      },
    ],
    subtotal: { type: Number, required: true },
    tax: { type: Number, required: true },
    shippingCharges: { type: Number, required: true },
    discount: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  { timestamps: true }
);

// Unpaid checkouts are removed automatically after 2 days
schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 2 });

export const Checkout = mongoose.model("Checkout", schema);
