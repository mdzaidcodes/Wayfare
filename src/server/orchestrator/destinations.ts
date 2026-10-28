import "server-only";
import { costOf, enforcePlan } from "@/lib/budget/engine";
import { toMinor } from "@/lib/money";
import type { DestinationsResult } from "@/lib/schemas/api";
import type { TripBrief } from "@/lib/schemas/trip";
import { addDays } from "@/lib/time";
import type { PlanContext } from "../agents/context";
import { runAgent } from "../agents/runner";
import { destinationScout } from "../agents/defs/scouts";
import { ensureFx } from "./stages";

const DEFAULT_WEIGHTS = { flights: 40, stay: 45, activities: 15 };

/**
 * Only when no destination was given. The Scout proposes places with a flight and hotel it found;
 * code then checks each against the budget from those evidence records before it is shown.
 */
export async function suggestDestinations(ctx: PlanContext, brief: TripBrief): Promise<DestinationsResult> {
  if (!brief.origin || !brief.budget || !brief.travelers || !brief.dates || !brief.nights) {
    throw new Error("Destination ideas need a starting point, dates, nights, travelers and a budget first.");
  }
  if (!ctx.providers.hotels.some((p) => p.available())) {
    return {
      candidates: [],
      records: [],
      rejected: [],
      problems: ["Suggesting destinations needs hotel prices to check affordability, which require APIFY_TOKEN. Name a destination instead, or add the key."],
    };
  }
  const depart = brief.dates.type === "fixed" ? brief.dates.departDate : brief.dates.windowStart;
  const ret = brief.dates.type === "fixed" ? brief.dates.returnDate : addDays(depart, brief.nights);
  const rooms = brief.rooms ?? Math.ceil(brief.travelers / 2);
  const plan = enforcePlan(brief.budget, 20, DEFAULT_WEIGHTS, { flights: "", stay: "", activities: "", reserve: "" });
  ctx.progress({ type: "step", agent: "Destination Scout", message: "Looking for places that match and fit your budget…", at: new Date().toISOString() });
  const out = await runAgent(
    destinationScout,
    `Traveler wants: ${JSON.stringify(brief.vibe ?? brief.rawRequest)}. Interests: ${brief.interests.join(", ") || "none given"}.
From ${brief.origin.name}, ${depart} to ${ret} (${brief.nights} nights), ${brief.travelers} traveler(s), ${rooms} room(s).
Total budget ${brief.budget.amount} ${brief.budget.currency}; aim for flights under ${plan.limits.flights.amount} and the whole stay under ${plan.limits.stay.amount} (${brief.budget.currency}).`,
    ctx,
  );

  const records = out.candidates.flatMap((c) => [ctx.evidence.get(c.flightEvidenceId), ctx.evidence.get(c.hotelEvidenceId)]).filter((r) => r !== undefined);
  const fx = await ensureFx(ctx, records, brief.budget.currency).catch(() => undefined);
  const bctx = { currency: brief.budget.currency, fx: fx?.data, travelers: brief.travelers, nights: brief.nights, rooms };
  const result: DestinationsResult = { candidates: [], records: [], rejected: [], problems: [] };
  const spendable = toMinor(brief.budget.amount) - toMinor(plan.reserve.amount);

  for (const c of out.candidates) {
    const f = ctx.evidence.getOf(c.flightEvidenceId, "flight");
    const h = ctx.evidence.getOf(c.hotelEvidenceId, "hotel");
    if (!f || !h) {
      result.rejected.push({ name: c.name, reason: "its prices couldn't be traced to a search result" });
      continue;
    }
    const fc = costOf(f, bctx);
    const hc = costOf(h, bctx);
    if (!fc.known || !hc.known) {
      result.rejected.push({ name: c.name, reason: "a price wasn't provided by the source" });
      continue;
    }
    const core = toMinor(fc.cost.amount) + toMinor(hc.cost.amount);
    // Must leave the reserve plus at least a little room for activities.
    if (core > spendable * 0.92) {
      result.rejected.push({ name: c.name, reason: "real flight and hotel prices don't fit the budget" });
      continue;
    }
    result.candidates.push({
      name: c.name,
      country: c.country,
      airportCode: c.airportCode,
      why: c.why,
      flightEvidenceId: f.id,
      hotelEvidenceId: h.id,
      coreCost: { amount: core / 100, currency: brief.budget.currency },
    });
    result.records.push(ctx.evidence.sign(f), ctx.evidence.sign(h));
  }
  if (fx) result.records.push(ctx.evidence.sign(fx));
  return result;
}
