import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import kiwiFixture from "../../../test/fixtures/kiwi-search-flight.json";
import { fixtureProviders as providers, stubFetch, TEST_KEYS as SECRET_KEYS } from "../../../test/fixture-providers";
import { EvidenceStore } from "../evidence/store";
import { PlanGuard } from "../providers/guard";
import { createMcpHost, type McpHost } from "./host";

// Contract tests: real adapters and real MCP servers/clients, with provider HTTP answered from
// recorded fixtures. No network.

type Structured = Record<string, unknown> & { error?: string };
async function call(host: McpHost, server: keyof McpHost["clients"], name: string, args: Record<string, unknown>) {
  const r = await host.clients[server].callTool({ name, arguments: args });
  return { isError: Boolean(r.isError), s: r.structuredContent as Structured, text: JSON.stringify(r) };
}

let host: McpHost;
let evidence: EvidenceStore;
const progress: string[] = [];

beforeAll(async () => {
  stubFetch();
  evidence = new EvidenceStore(Buffer.from("t"));
  host = await createMcpHost({ evidence, guard: new PlanGuard("test", 100), providers: providers(), progress: (m) => progress.push(m) });
});
afterAll(async () => {
  await host.close();
  vi.unstubAllGlobals();
});

describe("MCP servers", () => {
  it("expose the planned tools", async () => {
    const names = async (s: keyof McpHost["clients"]) => (await host.clients[s].listTools()).tools.map((t) => t.name).sort();
    expect(await names("reference")).toEqual(["convert_currency", "geocode", "get_rates", "lookup_airport", "travel_time"]);
    expect(await names("flights")).toEqual(["get_flight_offers", "search_flights"]);
    expect(await names("stays")).toEqual(["get_hotel_offers", "search_hotels"]);
    expect(await names("experiences")).toEqual(["get_place_details", "search_attractions", "search_experiences"]);
  });

  it("search_flights returns evidence-backed round trips", async () => {
    const { s, isError } = await call(host, "flights", "search_flights", {
      from: "LHR", to: "LIS", departDate: "2026-12-10", returnDate: "2026-12-14", adults: 2, currency: "EUR",
    });
    expect(isError).toBe(false);
    const flights = s.flights as { evidenceId: string; totalPrice: { amount: number } }[];
    expect(flights.length).toBe(kiwiFixture.itineraries.length);
    for (const f of flights) expect(evidence.getOf(f.evidenceId, "flight")).toBeDefined();
    expect(progress.some((p) => p.includes("Checking flights from LHR"))).toBe(true);
  });

  it("get_flight_offers returns seller prices and links for that exact round trip", async () => {
    const { s: search } = await call(host, "flights", "search_flights", {
      from: "LHR", to: "LIS", departDate: "2026-12-10", returnDate: "2026-12-14", adults: 2, currency: "EUR",
    });
    const target = (search.flights as { evidenceId: string }[]).find((f) => {
      const d = evidence.getOf(f.evidenceId, "flight")!.data;
      return d.outbound.segments[0].flightNumber === "TP1369" && d.inbound.segments[0].flightNumber === "TP1358";
    })!;
    const { s } = await call(host, "flights", "get_flight_offers", { flightEvidenceId: target.evidenceId });
    const rec = evidence.getOf(s.evidenceId as string, "flight_offers")!;
    const offers = rec.data.offers;
    expect(offers.map((o) => o.seller)).toEqual(["TAP Air Portugal", "Trip.com", "eDreams", "Bad link"]);
    expect(offers[0]).toMatchObject({ totalPrice: { amount: 376, currency: "EUR" }, fareName: "Discount", bookingUrl: "https://www.google.com/travel/clk/tap" });
    expect(offers[1].totalPrice.amount).toBe(361);
    expect(offers[1].bookingUrl).toBe("https://www.google.com/travel/clk/trip");
    expect(offers[2].bookingUrl).toBeUndefined(); // missing → absent
    expect(offers[3].bookingUrl).toBeUndefined(); // unsafe → dropped
  });

  it("get_flight_offers refuses unknown evidence IDs", async () => {
    const r = await call(host, "flights", "get_flight_offers", { flightEvidenceId: "ev_madeup000" });
    expect(r.isError).toBe(true);
  });

  it("search_hotels normalizes and keeps missing fields absent; descriptions never reach the model", async () => {
    const r = await call(host, "stays", "search_hotels", {
      destination: "Lisbon", checkIn: "2026-12-10", checkOut: "2026-12-14", adults: 2, currency: "EUR",
    });
    expect(r.text).not.toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
    const hotels = r.s.hotels as { evidenceId: string }[];
    expect(hotels).toHaveLength(2);
    const memmo = evidence.getOf(hotels[0].evidenceId, "hotel")!.data;
    expect(memmo).toMatchObject({
      checkInTime: "15:00",
      checkOutTime: "12:00",
      totalPrice: { amount: 728, currency: "EUR" },
      taxesIncluded: true,
      starClass: 4,
      rating: 4.6,
      reviewCount: 1834,
    });
    expect(memmo.photos.map((p) => p.url)).toEqual([
      "https://lh3.googleusercontent.com/p/a=s1200",
      "https://lh3.googleusercontent.com/p/b=s1200",
      "https://lh3.googleusercontent.com/p/c=s1200",
    ]);
    expect(memmo.location.timeZone).toBe("Europe/Lisbon");
    const sparse = evidence.getOf(hotels[1].evidenceId, "hotel")!.data;
    for (const k of ["checkInTime", "rating", "starClass", "totalPrice", "amenities", "freeCancellation"] as const) {
      expect(sparse[k], k).toBeUndefined();
    }
    expect(sparse.photos).toEqual([]);
    expect(r.s.dropped).toEqual([{ reason: "hotel without a name", count: 1 }]);
  });

  it("get_hotel_offers returns per-site prices with taxes and cancellation where known", async () => {
    const { s: search } = await call(host, "stays", "search_hotels", {
      destination: "Lisbon", checkIn: "2026-12-10", checkOut: "2026-12-14", adults: 2, currency: "EUR",
    });
    const id = (search.hotels as { evidenceId: string }[])[0].evidenceId;
    const { s } = await call(host, "stays", "get_hotel_offers", { hotelEvidenceId: id });
    const offers = evidence.getOf(s.evidenceId as string, "hotel_offers")!.data.offers;
    expect(offers).toHaveLength(3);
    expect(offers[0]).toMatchObject({ seller: "Booking.com", totalPrice: { amount: 728 }, freeCancellation: true });
    expect(offers[1]).toMatchObject({ seller: "Expedia", pricePerNight: { amount: 190 }, totalPrice: { amount: 760 } });
    expect(offers[2].bookingUrl).toBeUndefined();
    expect(offers[2].freeCancellation).toBeUndefined();
  });

  it("search_experiences returns Viator products with one photo, per-person price and link", async () => {
    const r = await call(host, "experiences", "search_experiences", {
      destination: "Lisbon", interest: "food", startDate: "2026-12-10", endDate: "2026-12-14", currency: "EUR",
    });
    expect(r.text).not.toContain("admin mode");
    const list = r.s.experiences as { evidenceId: string }[];
    expect(list).toHaveLength(2);
    const tour = evidence.getOf(list[0].evidenceId, "experience")!.data;
    expect(tour).toMatchObject({
      price: { amount: 89, currency: "EUR" },
      priceIsPerPerson: true,
      durationMinutes: 210,
      rating: 4.9,
      photo: { url: "https://media-cdn.tripadvisor.com/media/photo-o/a-720.jpg" },
    });
    expect(tour.bookingUrl).toContain("viator.com");
    const minimal = evidence.getOf(list[1].evidenceId, "experience")!.data;
    expect(minimal.price).toBeUndefined();
    expect(minimal.photo).toBeUndefined();
  });

  it("search_attractions returns Google sights with hours and proxied photos, no price", async () => {
    const r = await call(host, "experiences", "search_attractions", { query: "sights in Lisbon", interest: "history" });
    const list = r.s.attractions as { evidenceId: string }[];
    expect(list).toHaveLength(2);
    const tower = evidence.getOf(list[0].evidenceId, "experience")!.data;
    expect(tower.openingHours?.periods).toEqual([
      { day: 2, open: "10:00", close: "17:30" },
      { day: 3, open: "10:00", close: "17:30" },
    ]);
    expect(tower.photo?.url).toBe("/api/photo?ref=places%2FChIJbelem%2Fphotos%2FAaBbCc&w=800");
    expect(tower.photo?.attribution).toBe("Ana R.");
    expect(tower.price).toBeUndefined();
    const view = evidence.getOf(list[1].evidenceId, "experience")!.data;
    expect(view.openingHours?.alwaysOpen).toBe(true);
  });

  it("reference tools: currency, airports, travel time", async () => {
    const fx = await call(host, "reference", "convert_currency", { amount: 100, from: "EUR", to: "GBP" });
    expect(fx.s).toMatchObject({ converted: { amount: 83.79, currency: "GBP" }, rateDate: "2026-10-26" });
    const ap = await call(host, "reference", "lookup_airport", { query: "LIS" });
    expect((ap.s.airports as { code: string }[])[0].code).toBe("LIS");
    const tt = await call(host, "reference", "travel_time", { from: { lat: 38.77, lng: -9.13 }, to: { placeId: "ChIJx" }, mode: "transit" });
    expect(tt.s).toMatchObject({ found: true, minutes: 23 });
  });

  it("never sends keys to the model or logs them", async () => {
    const all = JSON.stringify([...evidence["records"].values()]);
    for (const k of Object.values(SECRET_KEYS)) expect(all).not.toContain(k);
  });
});

describe("missing providers", () => {
  it("returns a clear tool error instead of crashing", async () => {
    const h = await createMcpHost({
      evidence: new EvidenceStore(Buffer.from("t")),
      guard: new PlanGuard("t2", 10),
      providers: providers({}),
      progress: () => {},
    });
    const r = await h.clients.stays.callTool({
      name: "search_hotels",
      arguments: { destination: "Lisbon", checkIn: "2026-12-10", checkOut: "2026-12-14", adults: 2, currency: "EUR" },
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.structuredContent)).toContain("APIFY_TOKEN");
    const t = await h.clients.reference.callTool({ name: "travel_time", arguments: { from: { name: "a" }, to: { name: "b" } } });
    expect(JSON.stringify(t.structuredContent)).toContain("GOOGLE_MAPS_API_KEY");
    await h.close();
  });

  it("enforces MAX_PROVIDER_CALLS_PER_PLAN", async () => {
    const guard = new PlanGuard("t3", 0);
    const h = await createMcpHost({ evidence: new EvidenceStore(Buffer.from("t")), guard, providers: providers(), progress: () => {} });
    const r = await h.clients.reference.callTool({ name: "convert_currency", arguments: { amount: 1, from: "EUR", to: "USD" } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.structuredContent)).toContain("MAX_PROVIDER_CALLS_PER_PLAN");
    await h.close();
  });
});
