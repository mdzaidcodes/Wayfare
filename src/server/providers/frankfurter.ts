import "server-only";
import { z } from "zod";
import type { FxData } from "@/lib/schemas/evidence";
import { TTL, type PlanGuard } from "./guard";
import { fetchJson, ProviderError } from "./http";

// Frankfurter: free ECB reference rates. The current API is /v2 (the v1 path in the original
// plan is older); rates come back as one row per pair.

const Row = z.object({ date: z.string(), base: z.string(), quote: z.string(), rate: z.number().positive() });

export function normalizeFrankfurter(raw: unknown, base: string): FxData {
  const rows = z.array(Row).parse(raw);
  if (rows.length === 0) throw new ProviderError("Frankfurter", `no rates for ${base}`);
  return {
    base,
    date: rows.map((r) => r.date).sort().at(-1)!,
    rates: Object.fromEntries(rows.map((r) => [r.quote, r.rate])),
    origin: "Frankfurter (ECB reference rates)",
  };
}

export async function fetchRates(
  baseUrl: string,
  base: string,
  quotes: string[],
  guard: PlanGuard,
): Promise<FxData> {
  const uniq = [...new Set(quotes.filter((q) => q !== base))].sort();
  if (uniq.length === 0) return { base, date: new Date().toISOString().slice(0, 10), rates: {}, origin: "none needed" };
  const url = `${baseUrl.replace(/\/v1\/?$/, "/v2").replace(/\/$/, "")}/rates?base=${base}&quotes=${uniq.join(",")}`;
  const raw = await guard.call("frankfurter", "rates", url, TTL.fx, () => fetchJson("Frankfurter", url, { timeoutMs: 8000 }));
  const fx = normalizeFrankfurter(raw, base);
  const missing = uniq.filter((q) => !fx.rates[q]);
  if (missing.length) {
    throw new ProviderError(
      "Frankfurter",
      `no reference rate for ${missing.join(", ")}. Choose a supported currency or enter your own rate.`,
    );
  }
  return fx;
}
