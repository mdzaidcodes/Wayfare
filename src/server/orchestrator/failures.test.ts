import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeModel, type Script } from "../../../test/fake-model";
import { fixtureProviders, stubFetch } from "../../../test/fixture-providers";
import { getEnv } from "../env";
import { EvidenceStore } from "../evidence/store";
import { createPlanContext } from "../agents/context";
import { AgentFailedError } from "../agents/runner";
import { ProviderError } from "../providers/http";
import { enforcePlan } from "@/lib/budget/engine";
import type { Providers } from "../mcp/context";
import type { TripBrief } from "@/lib/schemas/trip";
import type { StageResult } from "@/lib/schemas/api";
import { runStage } from "./stages";

// Failure injection (M10): provider down, nothing found, seller source down, model inventing IDs.

const env = getEnv({ OPENAI_API_KEY: "sk-test", APIFY_TOKEN: "a", GOOGLE_MAPS_API_KEY: "g", VIATOR_API_KEY: "v" });
const brief: TripBrief = {
  rawRequest: "x",
  destination: { name: "Lisbon", airportCodes: ["LIS"] },
  origin: { name: "London", airportCodes: ["LHR"] },
  dates: { type: "fixed", departDate: "2026-12-10", returnDate: "2026-12-14" },
  nights: 4,
  travelers: 2,
  rooms: 1,
  budget: { amount: 3000, currency: "EUR" },
  interests: ["food"],
  assumptions: [],
};
const plan = enforcePlan(brief.budget!, 20, { flights: 30, stay: 50, activities: 20 }, { flights: "", stay: "", activities: "", reserve: "" });

const ids = (r: Record<string, unknown> | undefined, k: string) => ((r?.[k] as { evidenceId: string }[]) ?? []).map((x) => x.evidenceId);
const flightScript: Script = (r) =>
  !r.length
    ? { call: [{ name: "search_flights", args: { from: "LHR", to: "LIS", departDate: "2026-12-10", returnDate: "2026-12-14", adults: 2, currency: "EUR" } }] }
    : { final: { ranked: ids(r[0], "flights").map((evidenceId) => ({ evidenceId, note: "" })) } };
const scripts = (flight: Script = flightScript) => [
  { agent: "flight", match: /round-trip flights for a trip/, script: flight },
  { agent: "verifier", match: /check a stage's options/, script: () => ({ final: { problems: [] } }) },
];

async function ctxWith(providers: Providers, flight?: Script) {
  return createPlanContext({ env, model: new FakeModel(scripts(flight)), providers, evidence: new EvidenceStore(Buffer.from("t")) });
}

beforeAll(stubFetch);
afterAll(() => vi.unstubAllGlobals());

describe("failure injection", () => {
  it("flight provider down: the stage says what failed and offers next steps, no crash", async () => {
    const p = fixtureProviders();
    p.flights = [{ id: "kiwi", label: "Kiwi.com", available: () => true, search: async () => { throw new ProviderError("Kiwi.com", "HTTP 503 – service unavailable", 503, true); } }];
    const ctx = await ctxWith(p);
    const r = await runStage(ctx, "flights", brief, plan);
    expect(r.options).toEqual([]);
    expect(r.problems.join(" ")).toMatch(/No flights were found/);
    expect(r.nothingFits?.map((s) => s.type)).toEqual(expect.arrayContaining(["shift_dates", "other_destination"]));
    await ctx.host.close();
  });

  it("no flights for the route: explains and suggests alternatives", async () => {
    const p = fixtureProviders();
    p.flights = [{ id: "kiwi", label: "Kiwi.com", available: () => true, search: async () => ({ items: [], dropped: [] }) }];
    const ctx = await ctxWith(p);
    const r = await runStage(ctx, "flights", brief, plan);
    expect(r.problems).toContain("No flights were found for this route and these dates.");
    expect(r.nothingFits?.length).toBeGreaterThan(0);
    await ctx.host.close();
  });

  it("seller-price source down: options still shown, with the failure named", async () => {
    const p = fixtureProviders();
    p.flightOffers = [{ id: "apify-google-flights", label: "x", available: () => true, offersFor: async () => { throw new ProviderError("Apify", "actor run failed (timed out)"); } }];
    const ctx = await ctxWith(p);
    const r = await runStage(ctx, "flights", brief, plan);
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.problems.join(" ")).toMatch(/Apify: actor run failed/);
    await ctx.host.close();
  });

  it("missing key for seller prices: options shown, problem explains the key", async () => {
    const ctx = await ctxWith(fixtureProviders({ google: "g", viator: "v" }));
    const r = await runStage(ctx, "flights", brief, plan);
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.problems.join(" ")).toMatch(/APIFY_TOKEN/);
    await ctx.host.close();
  });

  it("flight options are sent before the slow per-site price check finishes", async () => {
    const p = fixtureProviders();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = p.flightOffers[0];
    p.flightOffers = [{ ...real, offersFor: async (...args: Parameters<typeof real.offersFor>) => (await gate, real.offersFor(...args)) }];
    const ctx = await ctxWith(p);
    let early: StageResult | undefined;
    const done = runStage(ctx, "flights", brief, plan, undefined, undefined, (r) => {
      early = r;
      release();
    });
    const final = await done;
    expect(early?.pendingOffers).toBe(true);
    expect(early?.options.length).toBeGreaterThan(0);
    expect(early?.records.some((r) => r.record.kind === "flight_offers")).toBe(false);
    expect(final.pendingOffers).toBeUndefined();
    expect(final.records.some((r) => r.record.kind === "flight_offers")).toBe(true);
    await ctx.host.close();
  });

  it("a model that keeps inventing IDs is stopped after retries with a clear error", async () => {
    const liar: Script = (r) => (!r.length ? flightScript(r, "") : { final: { ranked: [{ evidenceId: "ev_fakefake01", note: "" }] } });
    const ctx = await ctxWith(fixtureProviders(), liar);
    await expect(runStage(ctx, "flights", brief, plan)).rejects.toBeInstanceOf(AgentFailedError);
    expect(ctx.trace.filter((t) => t.kind === "retry").length).toBeGreaterThanOrEqual(2);
    await ctx.host.close();
  });
});
