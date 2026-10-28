import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeModel, type Script } from "../../../test/fake-model";
import { fixtureProviders, stubFetch } from "../../../test/fixture-providers";
import { getEnv } from "../env";
import { EvidenceStore } from "../evidence/store";
import { createPlanContext, TokenBudgetExceeded, type PlanContext } from "../agents/context";
import { runIntake } from "./intake";
import { planBudget, runStage, sanitizeNote } from "./stages";
import { buildItinerary } from "./itinerary";
import { validateSchedule } from "@/lib/itinerary/scheduler";
import { costOf } from "@/lib/budget/engine";
import { withOffers } from "@/lib/budget/merge";
import type { BudgetPlan, TripBrief } from "@/lib/schemas/trip";
import type { EvidenceRecord } from "@/lib/schemas/evidence";

const env = getEnv({ OPENAI_API_KEY: "sk-test", APIFY_TOKEN: "a", GOOGLE_MAPS_API_KEY: "g", VIATOR_API_KEY: "v" });

const intakeOut = (o: Record<string, unknown>) => ({
  destination: null,
  origin: null,
  nights: null,
  dates: { type: "unknown", departDate: null, returnDate: null, windowStart: null, windowEnd: null, description: null },
  travelers: null,
  rooms: null,
  budget: null,
  interests: [],
  vibe: null,
  cabin: null,
  assumptions: [],
  question: null,
  ...o,
});

const ids = (r: Record<string, unknown>, key: string) => ((r[key] as { evidenceId: string }[]) ?? []).map((x) => x.evidenceId);

let badFirst = true;
const scripts: { match: RegExp; agent: string; script: Script }[] = [
  {
    agent: "intake",
    match: /structured trip brief/,
    script: (_r, input) =>
      input.includes("Lisbon")
        ? {
            final: intakeOut({
              destination: { name: "Lisbon", country: "Portugal", airportCodes: ["LIS"] },
              origin: { name: "London", airportCodes: ["LHR"] },
              dates: { type: "fixed", departDate: "2026-12-10", returnDate: "2026-12-14", windowStart: null, windowEnd: null, description: null },
              travelers: 2,
              budget: { amount: 3000, currency: "eur" },
              interests: ["food", "history"],
            }),
          }
        : {
            final: intakeOut({
              nights: 7,
              vibe: "warm, beaches, good food, not too expensive",
              interests: ["beaches", "food"],
              question: { field: "origin", text: "Where are you flying from?", chips: ["London", "Manchester"] },
            }),
          },
  },
  {
    agent: "budget",
    match: /split a trip's total budget/,
    script: () => ({
      final: { weights: { flights: 30, stay: 50, activities: 20 }, reservePercent: 20, reasons: { flights: "a", stay: "b", activities: "c", reserve: "d" } },
    }),
  },
  {
    agent: "flight",
    match: /round-trip flights for a trip/,
    script: (r) => {
      if (!r.length) return { call: [{ name: "search_flights", args: { from: "LHR", to: "LIS", departDate: "2026-12-10", returnDate: "2026-12-14", adults: 2, currency: "EUR" } }] };
      const found = ids(r[0], "flights");
      if (badFirst) {
        badFirst = false;
        return { final: { ranked: [{ evidenceId: "ev_invented_001", note: "great" }, { evidenceId: found[0], note: "only €376!" }] } };
      }
      return { final: { ranked: found.slice(0, 3).map((evidenceId) => ({ evidenceId, note: "direct, sensible times" })) } };
    },
  },
  {
    agent: "stay",
    match: /hotels for a stay/,
    script: (r) =>
      !r.length
        ? { call: [{ name: "search_hotels", args: { destination: "Lisbon", checkIn: "2026-12-10", checkOut: "2026-12-14", adults: 2, rooms: 1, currency: "EUR" } }] }
        : { final: { ranked: ids(r[0], "hotels").map((evidenceId) => ({ evidenceId, note: "well located" })) } },
  },
  {
    agent: "experience",
    match: /things to do for each/,
    script: (r) =>
      !r.length
        ? {
            call: [
              { name: "search_experiences", args: { destination: "Lisbon", interest: "food", startDate: "2026-12-10", endDate: "2026-12-14", currency: "EUR" } },
              { name: "search_attractions", args: { query: "historic sights Lisbon", interest: "history" } },
              { name: "search_attractions", args: { query: "top attractions in Lisbon", interest: "must-see" } },
            ],
          }
        : {
            final: {
              groups: [
                // Same places as the history search, under new evidence IDs, and a free-form group name.
                { interest: "Must-see highlights", items: ids(r[2], "attractions").slice(0, 1).map((evidenceId) => ({ evidenceId, note: "a classic" })) },
                { interest: "food", items: ids(r[0], "experiences").map((evidenceId) => ({ evidenceId, note: "local favourite" })) },
                { interest: "history", items: ids(r[1], "attractions").map((evidenceId) => ({ evidenceId, note: "iconic" })) },
              ],
            },
          },
  },
  { agent: "verifier", match: /check a stage's options/, script: () => ({ final: { problems: [] } }) },
  { agent: "planner", match: /which day each chosen activity/, script: () => ({ final: { order: [] } }) },
];

let model: FakeModel;
let ctx: PlanContext;
const freshCtx = (over: Partial<typeof env> = {}) =>
  createPlanContext({ env: { ...env, ...over }, model, providers: fixtureProviders(), evidence: new EvidenceStore(Buffer.from("t")) });

beforeAll(async () => {
  stubFetch();
  model = new FakeModel(scripts);
  ctx = await freshCtx();
});
afterAll(async () => {
  await ctx.host.close();
  vi.unstubAllGlobals();
});

describe("Intake (M3)", () => {
  it("a precise request yields a complete brief and asks nothing", async () => {
    const r = await runIntake(ctx, { text: "London to Lisbon 10–14 Dec 2026, 2 of us, €3000, food and history", form: {}, answers: [], overrides: {} });
    expect(r.question).toBeNull();
    expect(r.ready).toBe(true);
    expect(r.brief).toMatchObject({ nights: 4, travelers: 2, rooms: 1, budget: { amount: 3000, currency: "EUR" } });
    expect(r.brief.assumptions.map((a) => a.field)).toEqual(["rooms", "cabin"]);
  });

  it("a vague request asks only for what's missing, one question at a time, with You decide", async () => {
    const r = await runIntake(ctx, { text: "Somewhere warm with beaches and good food, about a week, not too expensive", form: {}, answers: [], overrides: {} });
    expect(r.missing).toEqual(["origin", "dates", "travelers", "budget"]);
    expect(r.missing).not.toContain("destination"); // the vibe is enough; the Scout suggests places
    expect(r.question).toMatchObject({ field: "origin", text: "Where are you flying from?" });
    expect(r.question!.chips.at(-1)).toBe("You decide");
    expect(r.ready).toBe(false);
  });

  it("form fields override the agent and count as answered", async () => {
    const r = await runIntake(ctx, {
      text: "Somewhere warm with beaches",
      form: { origin: { name: "Manchester", airportCodes: ["MAN"] }, travelers: 2, budget: { amount: 2000, currency: "GBP" } },
      answers: [],
      overrides: {},
    });
    expect(r.missing).toEqual(["dates"]);
  });

  it("uses medium reasoning effort and never sends temperature or top_p", () => {
    expect(model.log.length).toBeGreaterThan(0);
    for (const l of model.log) {
      expect(l.modelSettings.reasoning?.effort).toBe("medium");
      expect(l.modelSettings.temperature).toBeUndefined();
      expect(l.modelSettings.topP).toBeUndefined();
    }
  });
});

const brief: TripBrief = {
  rawRequest: "x",
  destination: { name: "Lisbon", country: "Portugal", airportCodes: ["LIS"] },
  origin: { name: "London", airportCodes: ["LHR"] },
  dates: { type: "fixed", departDate: "2026-12-10", returnDate: "2026-12-14" },
  nights: 4,
  travelers: 2,
  rooms: 1,
  budget: { amount: 3000, currency: "EUR" },
  interests: ["food", "history"],
  cabin: "economy",
  assumptions: [],
};

describe("Scouts, Verifier, Orchestrator (M4)", () => {
  let plan: BudgetPlan;
  const records = new Map<string, EvidenceRecord>();

  it("budget planner's split is enforced in code", async () => {
    plan = await planBudget(ctx, brief);
    expect(plan.reserve.amount).toBe(600);
    expect(plan.limits.flights.amount + plan.limits.stay.amount + plan.limits.activities.amount).toBe(2400);
  });

  it("flights: rejects invented IDs and facts in notes, retries, and every option traces to evidence and fits", async () => {
    const r = await runStage(ctx, "flights", brief, plan);
    // The invented ID was caught by the runner's validation and the scout answered again.
    expect(ctx.trace.some((t) => t.agent === "flight-scout" && t.kind === "retry" && t.detail.includes("ev_invented_001"))).toBe(true);
    expect(r.options.length).toBeGreaterThanOrEqual(4);
    expect(r.options.length).toBeLessThanOrEqual(8);
    for (const rec of r.records) records.set(rec.record.id, rec.record);
    const merged = withOffers(records.values());
    for (const o of r.options) {
      const rec = merged.get(o.evidenceId)!;
      expect(rec.kind).toBe("flight");
      const c = costOf(rec as never, { currency: "EUR", travelers: 2, nights: 4, rooms: 1 });
      expect(c.known && c.cost.amount).toBeLessThanOrEqual(plan.limits.flights.amount);
      expect(o.note).not.toMatch(/€/);
    }
    expect(r.options.map((o) => o.evidenceId)).not.toContain("ev_invented_001");
    // Seller prices were fetched for the shortlist.
    expect(r.records.some((x) => x.record.kind === "flight_offers")).toBe(true);
  });

  it("stay and activities run, filtered by their limits", async () => {
    const [stay, acts] = await Promise.all([runStage(ctx, "stay", brief, plan), runStage(ctx, "activities", brief, plan)]);
    expect(stay.options.length).toBe(2);
    expect(stay.records.some((x) => x.record.kind === "hotel_offers")).toBe(true);
    // Highlights come first under one fixed name, and no option or place shows up twice.
    expect(acts.groups?.map((g) => g.interest)).toEqual(["Don't miss", "food", "history"]);
    const listed = acts.groups!.flatMap((g) => g.evidenceIds);
    expect(new Set(listed).size).toBe(listed.length);
    const places = listed.map((id) => acts.records.find((x) => x.record.id === id)!.record).map((r) => (r.kind === "experience" ? r.data.location.placeId ?? r.data.title : r.id));
    expect(new Set(places).size).toBe(places.length);
    // The bookable Viator item without a price is hidden; free-entry sights from Google stay.
    expect(acts.hidden.unpriced).toBe(1);
    for (const r of [...stay.records, ...acts.records]) records.set(r.record.id, r.record);
    // Records round-trip through the browser with valid signatures.
    const other = new EvidenceStore(Buffer.from("t"));
    expect(other.restore(stay.records).rejected).toEqual([]);
  });

  it("itinerary: built from choices, no overlaps, grand total recomputed", async () => {
    const flightId = [...records.values()].find((r) => r.kind === "flight")!.id;
    const hotelId = [...records.values()].find((r) => r.kind === "hotel")!.id;
    const activityIds = [...records.values()].filter((r) => r.kind === "experience").map((r) => r.id).slice(0, 3);
    const res = await buildItinerary(ctx, brief, plan, { flightId, hotelId, activityIds }, [...records.values()]);
    const types = new Set(res.itinerary.items.map((i) => i.type));
    for (const t of ["leave_for_airport", "airport_arrival", "flight", "arrival_buffer", "transfer", "checkin", "activity", "meal", "checkout"]) {
      expect(types.has(t as never), t).toBe(true);
    }
    expect(validateSchedule(res.itinerary.items, new Map())).toEqual([]);
    expect(res.grandTotal.amount).toBeGreaterThan(plan.reserve.amount);
    expect(res.records.some((r) => r.record.kind === "travel_time")).toBe(true);
  });

  it("enforces MAX_TOKENS_PER_PLAN", async () => {
    const small = await freshCtx({ MAX_TOKENS_PER_PLAN: 100 });
    small.tokens.add(100);
    await expect(planBudget(small, brief)).rejects.toBeInstanceOf(TokenBudgetExceeded);
    await small.host.close();
  });
});

describe("sanitizeNote", () => {
  it("removes notes carrying prices, times, numbers with units or links", () => {
    for (const n of ["only €376", "departs 07:15", "4.5 stars", "20 min from center", "see https://x.y"]) {
      expect(sanitizeNote(n).note).toBe("");
    }
    expect(sanitizeNote("direct, sensible times").note).toBe("direct, sensible times");
  });
});
