import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { FlightData, FlightLeg, FlightSegment } from "@/lib/schemas/evidence";
import { minutesBetween, toIsoWithOffset, zoned } from "@/lib/time";
import { airportByCode } from "./airports";
import { TTL, type PlanGuard } from "./guard";
import { ProviderError } from "./http";
import type { FlightQuery, FlightSearchProvider, ProviderResult } from "./types";

// Kiwi.com's official remote MCP server (no key). Wayfare's flights MCP server is a client of it.

const KiwiSegment = z.object({
  from: z.string(),
  to: z.string(),
  fromName: z.string().optional(),
  toName: z.string().optional(),
  fromCity: z.string().optional(),
  toCity: z.string().optional(),
  fromCountry: z.string().optional(),
  toCountry: z.string().optional(),
  departureTime: z.string(),
  arrivalTime: z.string(),
  carrier: z.string().optional(),
  carrierName: z.string().optional(),
  flightNumber: z.string().optional(),
  cabinClass: z.string().optional(),
});
const KiwiLeg = z.object({
  durationSeconds: z.number().optional(),
  stops: z.number().optional(),
  cabinClass: z.string().optional(),
  segments: z.array(KiwiSegment).min(1),
});
const KiwiItinerary = z.object({
  id: z.string().optional(),
  price: z.number(),
  bookingUrl: z.string().optional(),
  totalDurationSeconds: z.number().optional(),
  outbound: KiwiLeg,
  inbound: KiwiLeg.optional(),
});
export const KiwiResult = z.object({
  currency: z.string(),
  passengers: z.object({ adults: z.number() }).optional(),
  itineraries: z.array(z.unknown()),
});

const CABIN: Record<NonNullable<FlightQuery["cabin"]>, string> = {
  economy: "M",
  premium_economy: "W",
  business: "C",
  first: "F",
};

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

class MissingZone extends Error {}

/** Kiwi gives local times without offsets; the airport's time zone turns them into real instants. */
function localToIso(local: string, code: string): string {
  const a = airportByCode(code);
  if (!a) throw new MissingZone(code);
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  return toIsoWithOffset(zoned(date, time, a.timeZone), a.timeZone);
}

function leg(l: z.infer<typeof KiwiLeg>): FlightLeg {
  const segments: FlightSegment[] = l.segments.map((s) => {
    const fromA = airportByCode(s.from);
    const toA = airportByCode(s.to);
    return {
      airline: s.carrierName ?? s.carrier ?? "Not provided by source",
      airlineCode: s.carrier,
      flightNumber: s.flightNumber,
      from: { code: s.from, name: s.fromName, city: s.fromCity, country: s.fromCountry, timeZone: fromA?.timeZone },
      to: { code: s.to, name: s.toName, city: s.toCity, country: s.toCountry, timeZone: toA?.timeZone },
      departLocal: localToIso(s.departureTime, s.from),
      arriveLocal: localToIso(s.arrivalTime, s.to),
    };
  });
  const layovers = segments.slice(0, -1).map((s, i) => ({
    airport: s.to,
    minutes: minutesBetween(new Date(s.arriveLocal), new Date(segments[i + 1].departLocal)),
  }));
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    segments,
    durationMinutes: l.durationSeconds
      ? Math.round(l.durationSeconds / 60)
      : minutesBetween(new Date(first.departLocal), new Date(last.arriveLocal)),
    stops: l.stops ?? segments.length - 1,
    layovers,
  };
}

export function normalizeKiwi(raw: unknown, adults: number): ProviderResult<FlightData> {
  const parsed = KiwiResult.parse(raw);
  const items: ProviderResult<FlightData>["items"] = [];
  const drops = new Map<string, number>();
  const drop = (reason: string) => drops.set(reason, (drops.get(reason) ?? 0) + 1);
  for (const it of parsed.itineraries) {
    const p = KiwiItinerary.safeParse(it);
    if (!p.success) {
      drop("unexpected format from Kiwi.com");
      continue;
    }
    if (!p.data.inbound) {
      drop("one-way only (no return flight)");
      continue;
    }
    try {
      const outbound = leg(p.data.outbound);
      const inbound = leg(p.data.inbound);
      const countries = new Set(
        [...outbound.segments, ...inbound.segments].flatMap((s) => [s.from.country, s.to.country]).filter(Boolean),
      );
      const total = { amount: p.data.price, currency: parsed.currency };
      const url = p.data.bookingUrl && /^https?:\/\//.test(p.data.bookingUrl) ? p.data.bookingUrl : undefined;
      items.push({
        source: "Kiwi.com",
        provider: "kiwi",
        data: {
          outbound,
          inbound,
          travelers: adults,
          totalPrice: total,
          pricePerPerson: { amount: Math.round((p.data.price / adults) * 100) / 100, currency: parsed.currency },
          cabin: p.data.outbound.cabinClass,
          international: countries.size > 1 ? true : countries.size === 1 ? false : undefined,
          bookingUrl: url,
          bookingSeller: url ? "Kiwi.com" : undefined,
        },
      });
    } catch (e) {
      if (e instanceof MissingZone) drop(`no time zone known for airport ${e.message}`);
      else drop("unexpected format from Kiwi.com");
    }
  }
  return { items, dropped: [...drops].map(([reason, count]) => ({ reason, count })) };
}

export function kiwiProvider(url: string): FlightSearchProvider {
  return {
    id: "kiwi",
    label: "Kiwi.com",
    available: () => true,
    async search(q, guard: PlanGuard) {
      const args: Record<string, unknown> = {
        flyFrom: q.from,
        flyTo: q.to,
        departureDate: ddmmyyyy(q.departDate),
        returnDate: ddmmyyyy(q.returnDate),
        adults: q.adults,
        currency: q.currency,
        sort: "price",
      };
      if (q.cabin) args.cabinClass = CABIN[q.cabin];
      const raw = await guard.call("kiwi", "search-flight", JSON.stringify(args), TTL.flights, async () => {
        const client = new Client({ name: "wayfare", version: "0.1.0" });
        try {
          await client.connect(new StreamableHTTPClientTransport(new URL(url)));
          const r = await client.callTool({ name: "search-flight", arguments: args }, undefined, { timeout: 45_000 });
          if (r.isError) {
            const text = Array.isArray(r.content) ? r.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "";
            throw new ProviderError("Kiwi.com", text.slice(0, 200) || "search failed");
          }
          return r.structuredContent ?? JSON.parse((r.content as { text: string }[])[0]?.text ?? "{}");
        } catch (e) {
          if (e instanceof ProviderError) throw e;
          throw new ProviderError("Kiwi.com", e instanceof Error ? e.message : "connection failed", undefined, true);
        } finally {
          await client.close().catch(() => {});
        }
      });
      return normalizeKiwi(raw, q.adults);
    },
  };
}
