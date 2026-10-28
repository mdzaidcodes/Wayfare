import { describe, expect, it } from "vitest";
import { addMoney, convert, formatMoney, sumMoney, UnsupportedCurrencyError } from "./money";

const fx = { base: "EUR", date: "2026-03-01", rates: { USD: 1.1, GBP: 0.85 }, origin: "Frankfurter (ECB)" };

describe("money", () => {
  it("adds without float drift", () => {
    expect(addMoney({ amount: 0.1, currency: "EUR" }, { amount: 0.2, currency: "EUR" }).amount).toBe(0.3);
    expect(sumMoney([{ amount: 19.99, currency: "EUR" }, { amount: 0.01, currency: "EUR" }], "EUR").amount).toBe(20);
    expect(() => addMoney({ amount: 1, currency: "EUR" }, { amount: 1, currency: "USD" })).toThrow(/mismatch/);
  });

  it("converts through the base currency and records rate and date", () => {
    const c = convert({ amount: 110, currency: "USD" }, "GBP", fx);
    expect(c.money).toEqual({ amount: 85, currency: "GBP" });
    expect(c.rateDate).toBe("2026-03-01");
    expect(c.converted).toBe(true);
    expect(convert({ amount: 5, currency: "EUR" }, "EUR", undefined).converted).toBe(false);
  });

  it("asks for a supported currency when a rate is missing", () => {
    expect(() => convert({ amount: 5, currency: "XAF" }, "EUR", fx)).toThrow(UnsupportedCurrencyError);
  });

  it("formats", () => {
    expect(formatMoney({ amount: 1200, currency: "EUR" }, "en-GB")).toBe("€1,200");
  });
});
