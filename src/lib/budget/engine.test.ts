import { describe, expect, it } from "vitest";
import { experience, flight, hotel } from "../../../test/builders";
import type { EvidenceRecord, FxData } from "../schemas/evidence";
import type { Selections } from "../schemas/trip";
import {
  checkSelections,
  costOf,
  enforcePlan,
  filterOptions,
  nothingFitsSuggestions,
  summarize,
  withReserve,
  type BudgetContext,
} from "./engine";

const reasons = { flights: "", stay: "", activities: "", reserve: "" };
const ctx: BudgetContext = { currency: "EUR", travelers: 2, nights: 4, rooms: 1 };
// 2000 total, 20% reserve = 400, spendable 1600 split 40/45/15 → 640 / 720 / 240
const plan = enforcePlan({ amount: 2000, currency: "EUR" }, 20, { flights: 40, stay: 45, activities: 15 }, reasons);
const none: Selections = { activityIds: [] };
const map = (...rs: EvidenceRecord[]) => new Map(rs.map((r) => [r.id, r]));

describe("enforcePlan", () => {
  it("splits so the parts sum exactly to the total", () => {
    expect(plan.reserve.amount).toBe(400);
    expect(plan.limits).toEqual({
      flights: { amount: 640, currency: "EUR" },
      stay: { amount: 720, currency: "EUR" },
      activities: { amount: 240, currency: "EUR" },
    });
    const odd = enforcePlan({ amount: 1000.01, currency: "EUR" }, 17, { flights: 1, stay: 1, activities: 1 }, reasons);
    const sum = odd.reserve.amount + odd.limits.flights.amount + odd.limits.stay.amount + odd.limits.activities.amount;
    expect(Math.round(sum * 100)).toBe(100001);
  });

  it("rescales when the reserve changes", () => {
    const p = withReserve(plan, 10);
    expect(p.reserve.amount).toBe(200);
    expect(p.limits.flights.amount + p.limits.stay.amount + p.limits.activities.amount).toBe(1800);
  });
});

describe("costOf", () => {
  it("uses the cheapest seller, and the chosen seller once picked", () => {
    const f = flight(600, {
      sellerOffers: [
        { seller: "Airline", totalPrice: { amount: 580, currency: "EUR" }, fetchedAt: "2026-03-01T12:00:00Z" },
        { seller: "OTA", totalPrice: { amount: 610, currency: "EUR" }, fetchedAt: "2026-03-01T12:00:00Z" },
      ],
    });
    const cheapest = costOf(f, ctx);
    expect(cheapest.known && cheapest.cost.amount).toBe(580);
    expect(cheapest.known && cheapest.seller).toBe("Airline");
    const ota = costOf(f, ctx, "OTA");
    expect(ota.known && ota.cost.amount).toBe(610);
  });

  it("computes hotel total from nightly price × nights × rooms when no total is given", () => {
    const c = costOf(hotel({ pricePerNight: { amount: 100, currency: "EUR" } }), { ...ctx, rooms: 2 });
    expect(c.known && c.cost.amount).toBe(800);
    expect(c.known && c.computed).toBe(true);
  });

  it("multiplies activity price by travelers and treats free as zero", () => {
    const paid = costOf(experience({ price: { amount: 35, currency: "EUR" } }), ctx);
    expect(paid.known && paid.cost.amount).toBe(70);
    const free = costOf(experience({ isFree: true }), ctx);
    expect(free.known && free.cost.amount).toBe(0);
    expect(costOf(experience({ bookingUrl: "https://www.viator.com/x" }), ctx).known).toBe(false);
    const sight = costOf(experience({}), ctx);
    expect(sight.known && sight.priceNotProvided).toBe(true);
  });

  it("converts to the trip currency and keeps the rate and date", () => {
    const fx: FxData = { base: "EUR", date: "2026-03-01", rates: { GBP: 0.85 }, origin: "Frankfurter (ECB)" };
    const c = costOf(flight(170, { currency: "GBP" }), { ...ctx, fx });
    expect(c.known && c.cost).toEqual({ amount: 200, currency: "EUR" });
    expect(c.known && c.conversion.rateDate).toBe("2026-03-01");
  });
});

describe("selection blocking", () => {
  it("blocks a flight over its category limit", () => {
    const f = flight(641);
    const r = checkSelections(plan, { ...none, flightId: f.id }, map(f), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.overBy?.amount).toBe(1);
  });

  it("allows a selection exactly at the limit", () => {
    const f = flight(640);
    expect(checkSelections(plan, { ...none, flightId: f.id }, map(f), ctx).ok).toBe(true);
  });

  it("blocks activities that together exceed the activities limit", () => {
    const a = experience({ price: { amount: 60, currency: "EUR" } }); // 120 for 2
    const b = experience({ price: { amount: 61, currency: "EUR" } }); // 122 for 2
    const r = checkSelections(plan, { activityIds: [a.id, b.id] }, map(a, b), ctx);
    expect(r.ok).toBe(false);
  });

  it("blocks items with no verifiable price", () => {
    const a = experience({ bookingUrl: "https://www.viator.com/x" });
    expect(checkSelections(plan, { activityIds: [a.id] }, map(a), ctx).ok).toBe(false);
  });

  it("blocks a seller switch that pushes over the limit", () => {
    const f = flight(640, {
      sellerOffers: [{ seller: "Pricey", totalPrice: { amount: 700, currency: "EUR" }, fetchedAt: "2026-03-01T12:00:00Z" }],
    });
    expect(checkSelections(plan, { ...none, flightId: f.id }, map(f), ctx).ok).toBe(true);
    expect(checkSelections(plan, { ...none, flightId: f.id, flightSeller: "Pricey" }, map(f), ctx).ok).toBe(false);
  });

  it("blocks when the grand total plus reserve is exceeded even if each category fits", () => {
    // Category limits that sum above spendable can't come from enforcePlan, so build one by hand.
    const loose = { ...plan, limits: { ...plan.limits, flights: { amount: 1000, currency: "EUR" } } };
    const f = flight(900);
    const h = hotel({ totalPrice: { amount: 720, currency: "EUR" } });
    const r = checkSelections(loose, { activityIds: [], flightId: f.id, hotelId: h.id }, map(f, h), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/total budget/);
  });

  it("summarizes spent, selected and remaining", () => {
    const f = flight(500);
    const h = hotel({ totalPrice: { amount: 600, currency: "EUR" } });
    const s = summarize(plan, { activityIds: [], flightId: f.id, hotelId: h.id }, map(f, h), ctx, new Set([f.id]));
    expect(s.selected.amount).toBe(1100);
    expect(s.spent.amount).toBe(500);
    expect(s.remaining.amount).toBe(500); // 2000 - 1100 - 400
  });
});

describe("filterOptions", () => {
  it("hides options that would break the budget and sorts by cheapest", () => {
    const ok1 = flight(600);
    const ok2 = flight(300);
    const over = flight(900);
    const r = filterOptions([ok1, ok2, over], plan, none, new Map(), ctx);
    expect(r.fits.map((x) => x.record.id)).toEqual([ok2.id, ok1.id]);
    expect(r.overBudget.map((x) => x.record.id)).toEqual([over.id]);
  });

  it("filters on the cheapest seller price", () => {
    const f = flight(700, {
      sellerOffers: [{ seller: "Cheap", totalPrice: { amount: 620, currency: "EUR" }, fetchedAt: "2026-03-01T12:00:00Z" }],
    });
    expect(filterOptions([f], plan, none, new Map(), ctx).fits).toHaveLength(1);
  });

  it("accounts for activities already selected", () => {
    const picked = experience({ price: { amount: 100, currency: "EUR" } }); // 200
    const next = experience({ price: { amount: 25, currency: "EUR" } }); // 50 → 250 > 240
    const r = filterOptions([next], plan, { activityIds: [picked.id] }, map(picked), ctx);
    expect(r.fits).toHaveLength(0);
  });

  it("puts unpriced items aside instead of showing them as fitting", () => {
    const r = filterOptions([experience({ bookingUrl: "https://www.viator.com/x" })], plan, none, new Map(), ctx);
    expect(r.unpriced).toHaveLength(1);
    expect(r.fits).toHaveLength(0);
  });
});

describe("nothingFitsSuggestions", () => {
  it("gives concrete numbers from the cheapest real price", () => {
    const h = hotel({ totalPrice: { amount: 800, currency: "EUR" } }); // limit 720
    const s = nothingFitsSuggestions("stay", [h], plan, none, new Map(), ctx);
    expect(s[0]).toEqual({ type: "raise_budget", by: { amount: 100, currency: "EUR" } });
    expect(s).toContainEqual({ type: "shorten_trip", nights: 3, saves: { amount: 200, currency: "EUR" } });
    expect(s.map((x) => x.type)).toContain("other_destination");
  });
});
