import { describe, expect, it } from "vitest";
import fixture from "../../../test/fixtures/kiwi-search-flight.json";
import { FlightData } from "@/lib/schemas/evidence";
import { normalizeKiwi } from "./kiwi";

describe("Kiwi contract (recorded fixture)", () => {
  const r = normalizeKiwi(fixture, 2);

  it("normalizes every round trip into the shared schema", () => {
    expect(r.items.length).toBe(fixture.itineraries.length);
    for (const i of r.items) expect(FlightData.safeParse(i.data).success).toBe(true);
  });

  it("attaches real offsets from airport time zones", () => {
    const first = r.items[0].data.outbound.segments[0];
    expect(first.departLocal).toBe(`${fixture.itineraries[0].outbound.departureTime}+00:00`);
    expect(first.from.timeZone).toBe("Europe/London");
  });

  it("keeps the price, per-person split and booking link", () => {
    const f = r.items[0].data;
    expect(f.bookingUrl).toBe(fixture.itineraries[0].bookingUrl);
    expect(f.bookingSeller).toBe("Kiwi.com");
    expect(f.totalPrice).toEqual({ amount: fixture.itineraries[0].price, currency: "EUR" });
    expect(f.pricePerPerson?.amount).toBe(fixture.itineraries[0].price / 2);
    expect(f.international).toBe(true);
  });

  it("computes layovers from real times across time zones", () => {
    const raw = structuredClone(fixture) as typeof fixture;
    const inb = raw.itineraries[0].inbound;
    const seg = inb.segments[0];
    inb.segments = [
      { ...seg, to: "BCN", toName: "Barcelona", toCountry: "Spain", departureTime: "2026-12-14T14:05:00", arrivalTime: "2026-12-14T17:05:00" },
      { ...seg, from: "BCN", fromCountry: "Spain", departureTime: "2026-12-14T18:45:00", arrivalTime: "2026-12-14T20:05:00" },
    ];
    inb.stops = 1;
    const f = normalizeKiwi(raw, 2).items[0].data;
    expect(f.inbound.stops).toBe(1);
    expect(f.inbound.layovers[0]).toMatchObject({ airport: { code: "BCN" }, minutes: 100 });
    expect(f.inbound.segments[0].arriveLocal).toBe("2026-12-14T17:05:00+01:00");
  });

  it("leaves missing fields absent and drops one-way results", () => {
    const raw = structuredClone(fixture) as { itineraries: Record<string, unknown>[] };
    const seg = (raw.itineraries[0].outbound as { segments: Record<string, unknown>[] }).segments[0];
    delete seg.flightNumber;
    delete raw.itineraries[1].inbound;
    delete raw.itineraries[2].bookingUrl;
    const out = normalizeKiwi(raw, 2);
    expect(out.items[0].data.outbound.segments[0].flightNumber).toBeUndefined();
    expect(out.items[1].data.bookingUrl).toBeUndefined();
    expect(out.dropped).toContainEqual({ reason: "one-way only (no return flight)", count: 1 });
  });

  it("drops results it can't place in time instead of guessing", () => {
    const raw = structuredClone(fixture) as { itineraries: { outbound: { segments: { from: string }[] } }[] };
    raw.itineraries[0].outbound.segments[0].from = "ZZQ";
    expect(normalizeKiwi(raw, 2).dropped[0].reason).toMatch(/no time zone known for airport ZZQ/);
  });
});
