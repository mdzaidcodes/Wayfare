import type { Money } from "./schemas/common";
import type { FxData } from "./schemas/evidence";

// Budget math runs in integer hundredths so sums never drift.
export const toMinor = (amount: number) => Math.round(amount * 100);
export const fromMinor = (minor: number) => minor / 100;

export const money = (amount: number, currency: string): Money => ({
  amount: fromMinor(toMinor(amount)),
  currency,
});

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: fromMinor(toMinor(a.amount) + toMinor(b.amount)), currency: a.currency };
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}

function assertSameCurrency(a: Money, b: Money) {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}. Convert first.`);
  }
}

export class UnsupportedCurrencyError extends Error {
  constructor(public readonly currency: string) {
    super(
      `${currency} isn't covered by the reference rates. Choose a supported currency or enter your own rate.`,
    );
    this.name = "UnsupportedCurrencyError";
  }
}

export interface Conversion {
  money: Money;
  /** Units of target per one unit of source. 1 when no conversion happened. */
  rate: number;
  rateDate?: string;
  rateOrigin?: string;
  converted: boolean;
  original: Money;
}

/** Converts using a reference-rate table expressed against `fx.base`. */
export function convert(m: Money, to: string, fx: FxData | undefined): Conversion {
  if (m.currency === to) {
    return { money: m, rate: 1, converted: false, original: m };
  }
  if (!fx) throw new UnsupportedCurrencyError(m.currency);
  const perBase = (c: string) => {
    if (c === fx.base) return 1;
    const r = fx.rates[c];
    if (!r) throw new UnsupportedCurrencyError(c);
    return r;
  };
  const rate = perBase(to) / perBase(m.currency);
  return {
    money: money(m.amount * rate, to),
    rate,
    rateDate: fx.date,
    rateOrigin: fx.origin,
    converted: true,
    original: m,
  };
}

export function formatMoney(m: Money, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: m.amount % 1 === 0 ? 0 : 2,
    }).format(m.amount);
  } catch {
    return `${m.amount.toFixed(2)} ${m.currency}`;
  }
}
