import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EvidenceOf, FlightData } from "@/lib/schemas/evidence";
import type { FlightQuery } from "../../providers/types";
import { fail, ok, safe, type ServerDeps } from "../context";

/** Compact facts the Flight Scout uses to rank. No free text from providers. */
export function flightSummary(r: EvidenceOf<"flight">) {
  const leg = (l: FlightData["outbound"]) => ({
    from: l.segments[0].from.code,
    to: l.segments[l.segments.length - 1].to.code,
    depart: l.segments[0].departLocal,
    arrive: l.segments[l.segments.length - 1].arriveLocal,
    durationMinutes: l.durationMinutes,
    stops: l.stops,
    longestLayoverMinutes: Math.max(0, ...l.layovers.map((x) => x.minutes)),
    airlines: [...new Set(l.segments.map((s) => s.airline))],
  });
  return {
    evidenceId: r.id,
    totalPrice: r.data.totalPrice,
    outbound: leg(r.data.outbound),
    inbound: leg(r.data.inbound),
    hasExactBookingLink: Boolean(r.data.bookingUrl),
  };
}

/** Recovers the search behind a stored flight, so seller lookups use the same route, dates and travelers. */
export function queryOf(f: FlightData): FlightQuery {
  return {
    from: f.outbound.segments[0].from.code,
    to: f.outbound.segments[f.outbound.segments.length - 1].to.code,
    departDate: f.outbound.segments[0].departLocal.slice(0, 10),
    returnDate: f.inbound.segments[0].departLocal.slice(0, 10),
    adults: f.travelers,
    currency: f.totalPrice.currency,
  };
}

export function createFlightsServer(deps: ServerDeps): McpServer {
  const s = new McpServer({ name: "wayfare-flights", version: "0.1.0" });
  const { evidence, guard, providers, progress } = deps;

  s.registerTool(
    "search_flights",
    {
      description:
        "Round-trip flight search. Returns evidence IDs with price (total for all travelers), times (local, with offsets), duration and stops.",
      inputSchema: {
        from: z.string().min(2).max(100).describe("IATA code or city"),
        to: z.string().min(2).max(100).describe("IATA code or city"),
        departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adults: z.number().int().min(1).max(9),
        cabin: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
        currency: z.string().length(3),
        maxResults: z.number().int().min(1).max(30).default(15),
      },
    },
    safe(async (a) => {
      const q: FlightQuery = { ...a, currency: a.currency.toUpperCase() };
      const active = providers.flights.filter((p) => p.available());
      if (!active.length) return fail("No flight provider is available.");
      progress(`Checking flights from ${a.from} to ${a.to}…`);
      const results = await Promise.allSettled(active.map((p) => p.search(q, guard)));
      const flights: ReturnType<typeof flightSummary>[] = [];
      const problems: string[] = [];
      const dropped: { reason: string; count: number }[] = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          problems.push(`${active[i].label}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
          return;
        }
        dropped.push(...r.value.dropped);
        for (const item of r.value.items) {
          const rec = evidence.put({ kind: "flight", source: item.source, provider: item.provider, data: item.data });
          flights.push(flightSummary(rec));
        }
      });
      if (!flights.length && problems.length) return fail(problems.join("; "));
      flights.sort((x, y) => x.totalPrice.amount - y.totalPrice.amount);
      progress(`${flights.length} flight options found`);
      return ok({ count: flights.length, flights: flights.slice(0, a.maxResults), dropped, problems });
    }),
  );

  s.registerTool(
    "get_flight_offers",
    {
      description: "Per-seller prices and booking links for one flight already found by search_flights.",
      inputSchema: { flightEvidenceId: z.string() },
    },
    safe(async ({ flightEvidenceId }) => {
      const flight = evidence.getOf(flightEvidenceId, "flight");
      if (!flight) return fail(`Unknown flight evidence ID ${flightEvidenceId}`);
      const active = providers.flightOffers.filter((p) => p.available());
      if (!active.length) return fail("Seller prices need APIFY_TOKEN, which isn't set. Showing the search price only.");
      progress("Comparing prices across booking sites…");
      for (const p of active) {
        const offers = await p.offersFor(queryOf(flight.data), flight.data, guard);
        if (offers) {
          const rec = evidence.put({
            kind: "flight_offers",
            source: "Google Flights",
            provider: p.id,
            data: { flightEvidenceId, offers },
          });
          return ok({ evidenceId: rec.id, sellers: offers.map((o) => ({ seller: o.seller, totalPrice: o.totalPrice })) });
        }
      }
      return ok({ evidenceId: null, sellers: [], note: "The seller source didn't list this exact round trip." });
    }),
  );

  return s;
}
