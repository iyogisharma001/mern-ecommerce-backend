import { describe, expect, it } from "vitest";
import {
  calculateOrderTotals,
  calculatePercentage,
  escapeRegex,
  getMonthDiff,
  toCountryCode,
  validatePrice,
  validateStock,
} from "./helpers.js";

describe("calculateOrderTotals", () => {
  it("adds 18% GST and charges shipping on small orders", () => {
    expect(calculateOrderTotals([{ price: 500, quantity: 1 }])).toEqual({
      subtotal: 500,
      tax: 90,
      shippingCharges: 200,
      discount: 0,
      total: 790,
    });
  });

  it("gives free shipping only ABOVE the threshold", () => {
    expect(calculateOrderTotals([{ price: 1000, quantity: 1 }]).shippingCharges).toBe(200);
    expect(calculateOrderTotals([{ price: 1001, quantity: 1 }]).shippingCharges).toBe(0);
  });

  it("multiplies by quantity across several lines", () => {
    const totals = calculateOrderTotals([
      { price: 93499, quantity: 1 },
      { price: 1699, quantity: 2 },
    ]);
    expect(totals.subtotal).toBe(96897);
    expect(totals.tax).toBe(17441); // Math.round(96897 * 0.18)
    expect(totals.total).toBe(96897 + 17441);
  });

  it("applies a coupon but never discounts more than the subtotal", () => {
    expect(calculateOrderTotals([{ price: 2000, quantity: 1 }], 500).total).toBe(2000 + 360 - 500);
    const huge = calculateOrderTotals([{ price: 300, quantity: 1 }], 10_000);
    expect(huge.discount).toBe(300);
    expect(huge.total).toBe(54 + 200); // tax + shipping are still paid
  });

  it("ignores negative coupon amounts", () => {
    expect(calculateOrderTotals([{ price: 2000, quantity: 1 }], -50).discount).toBe(0);
  });
});

describe("toCountryCode", () => {
  it("maps the shipping form's country names to ISO codes", () => {
    expect(toCountryCode("india")).toBe("IN");
    expect(toCountryCode("  India ")).toBe("IN");
  });
  it("accepts 2-letter codes in any case", () => {
    expect(toCountryCode("in")).toBe("IN");
    expect(toCountryCode("US")).toBe("US");
  });
  it("rejects unknown countries", () => {
    expect(toCountryCode("narnia")).toBeNull();
    expect(toCountryCode("")).toBeNull();
  });
});

describe("validatePrice / validateStock", () => {
  it("accepts valid numbers, including numeric strings from forms", () => {
    expect(validatePrice("1499")).toBeNull();
    expect(validatePrice(0.5)).toBeNull();
    expect(validateStock("0")).toBeNull();
    expect(validateStock(25)).toBeNull();
  });
  it("rejects zero, negative or non-numeric prices", () => {
    expect(validatePrice(0)).not.toBeNull();
    expect(validatePrice(-10)).not.toBeNull();
    expect(validatePrice("abc")).not.toBeNull();
  });
  it("rejects negative or fractional stock", () => {
    expect(validateStock(-1)).not.toBeNull();
    expect(validateStock(2.5)).not.toBeNull();
    expect(validateStock("lots")).not.toBeNull();
  });
});

describe("calculatePercentage", () => {
  it("returns the real month-over-month change", () => {
    expect(calculatePercentage(150, 100)).toBe(50);
    expect(calculatePercentage(50, 100)).toBe(-50);
  });
  it("handles an empty previous month", () => {
    expect(calculatePercentage(10, 0)).toBe(100);
    expect(calculatePercentage(0, 0)).toBe(0);
  });
});

describe("getMonthDiff", () => {
  it("counts whole months across years", () => {
    expect(getMonthDiff(new Date(2026, 10, 14), new Date(2026, 10, 1))).toBe(0);
    expect(getMonthDiff(new Date(2026, 10, 14), new Date(2026, 9, 31))).toBe(1);
    expect(getMonthDiff(new Date(2026, 0, 5), new Date(2025, 11, 20))).toBe(1);
    expect(getMonthDiff(new Date(2026, 10, 1), new Date(2025, 10, 1))).toBe(12);
  });
});

describe("escapeRegex", () => {
  it("makes regex special characters literal", () => {
    expect(escapeRegex("a+b (c)")).toBe("a\\+b \\(c\\)");
    expect(new RegExp(escapeRegex("iPhone 13 Pro?")).test("iPhone 13 Pro?")).toBe(true);
  });
  it("neutralises catastrophic-backtracking patterns", () => {
    const evil = "(a+)+$";
    expect(new RegExp(escapeRegex(evil)).test("aaaaaaaaaaaaaaaaaaaaaaaa!")).toBe(false);
  });
});
