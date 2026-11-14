/*
  Pure business rules: no database, no network, no app imports.
  Kept separate so they can be unit tested (see src/utils/helpers.test.ts).
*/

// ---------- Pricing (the frontend shows the same numbers: src/config.ts) ----------
export const TAX_RATE = 0.18;
export const FREE_SHIPPING_ABOVE = 1000;
export const SHIPPING_CHARGE = 200;

export type PricedItem = { price: number; quantity: number };

export const calculateOrderTotals = (items: PricedItem[], couponAmount = 0) => {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  // A coupon can never make the order cost less than its tax + shipping
  const discount = Math.max(0, Math.min(couponAmount, subtotal));
  const tax = Math.round(subtotal * TAX_RATE);
  const shippingCharges = subtotal > FREE_SHIPPING_ABOVE ? 0 : SHIPPING_CHARGE;
  const total = subtotal + tax + shippingCharges - discount;
  return { subtotal, tax, shippingCharges, discount, total };
};

// ---------- Shipping country ----------
// Country names the shipping form can send -> ISO 3166-1 alpha-2 codes (Stripe
// rejects "india"). Add a line here when you add a country to the form.
const COUNTRY_CODES: Record<string, string> = {
  india: "IN",
};

export const toCountryCode = (country: string) => {
  const value = country.trim();
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  return COUNTRY_CODES[value.toLowerCase()] ?? null;
};

// ---------- Product validation (form fields arrive as strings) ----------
export const validatePrice = (price: unknown) => {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0)
    return "Price must be a number greater than 0";
  return null;
};

export const validateStock = (stock: unknown) => {
  const value = Number(stock);
  if (!Number.isInteger(value) || value < 0)
    return "Stock must be a whole number, 0 or more";
  return null;
};

// ---------- Dashboard maths ----------
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

// ---------- Search ----------
// Makes user text safe to use inside a MongoDB $regex (prevents ReDoS)
export const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
