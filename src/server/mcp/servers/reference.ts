import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { convert } from "@/lib/money";
import { searchAirports, AIRPORT_DATASET } from "../../providers/airports";
import { fetchRates } from "../../providers/frankfurter";
import { fail, ok, safe, type ServerDeps } from "../context";

const LocationArg = z
  .object({
    name: z.string().optional(),
    address: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    placeId: z.string().optional(),
  })
  .describe("A place: give placeId, or lat/lng, or an address/name");

export const toLocation = (l: z.infer<typeof LocationArg>) => ({
  name: l.name,
  address: l.address,
  placeId: l.placeId,
  point: l.lat !== undefined && l.lng !== undefined ? { lat: l.lat, lng: l.lng } : undefined,
});

export function createReferenceServer(deps: ServerDeps): McpServer {
  const s = new McpServer({ name: "wayfare-reference", version: "0.1.0" });
  const { evidence, guard, providers } = deps;

  s.registerTool(
    "convert_currency",
    {
      description: "Convert an amount using ECB reference rates (Frankfurter). Returns the rate, its date and an evidence ID.",
      inputSchema: { amount: z.number().nonnegative(), from: z.string().length(3), to: z.string().length(3) },
    },
    safe(async ({ amount, from, to }) => {
      const fx = await fetchRates(providers.frankfurterUrl, from.toUpperCase(), [to.toUpperCase()], guard);
      const rec = evidence.put({ kind: "fx", source: "Frankfurter", provider: "frankfurter", data: fx });
      const c = convert({ amount, currency: from.toUpperCase() }, to.toUpperCase(), fx);
      return ok({ evidenceId: rec.id, converted: c.money, rate: c.rate, rateDate: fx.date });
    }),
  );

  s.registerTool(
    "get_rates",
    {
      description: "ECB reference rates from one base currency to several others (Frankfurter).",
      inputSchema: { base: z.string().length(3), quotes: z.array(z.string().length(3)).min(1).max(30) },
    },
    safe(async ({ base, quotes }) => {
      const fx = await fetchRates(providers.frankfurterUrl, base.toUpperCase(), quotes.map((q) => q.toUpperCase()), guard);
      const rec = evidence.put({ kind: "fx", source: "Frankfurter", provider: "frankfurter", data: fx });
      return ok({ evidenceId: rec.id, date: fx.date, rates: fx.rates });
    }),
  );

  s.registerTool(
    "lookup_airport",
    {
      description: "Find airports by IATA code, city or airport name, from an open airport dataset.",
      inputSchema: { query: z.string().min(2).max(80) },
    },
    safe(async ({ query }) => {
      const found = searchAirports(query, 6);
      const airports = found.map((a) => {
        const rec = evidence.put({
          kind: "airport",
          source: AIRPORT_DATASET.name,
          provider: "airports",
          data: { code: a.code, name: a.name, city: a.city, country: a.country, timeZone: a.timeZone },
        });
        return { evidenceId: rec.id, code: a.code, name: a.name, city: a.city, country: a.country };
      });
      return ok({ airports, note: airports.length ? undefined : "No airport matched." });
    }),
  );

  s.registerTool(
    "geocode",
    {
      description: "Resolve a place name to coordinates and a place ID (Google Places).",
      inputSchema: { query: z.string().min(2).max(200) },
    },
    safe(async ({ query }) => {
      if (!providers.places.available()) return fail("Geocoding needs GOOGLE_MAPS_API_KEY, which isn't set.");
      const r = await providers.places.geocode(query, guard);
      if (!r) return ok({ found: false });
      const rec = evidence.put({ kind: "place", source: r.source, provider: r.provider, data: r.data });
      return ok({ found: true, evidenceId: rec.id, name: r.data.name, location: r.data.location });
    }),
  );

  s.registerTool(
    "travel_time",
    {
      description: "Travel duration between two places (Google Routes). Durations only, never prices.",
      inputSchema: {
        from: LocationArg,
        to: LocationArg,
        mode: z.enum(["drive", "transit", "walk"]).default("transit"),
        departAt: z.string().optional().describe("ISO time, improves transit estimates"),
      },
    },
    safe(async ({ from, to, mode, departAt }) => {
      if (!providers.routes.available()) return fail("Travel times need GOOGLE_MAPS_API_KEY, which isn't set.");
      const r = await providers.routes.travelTime(toLocation(from), toLocation(to), mode, guard, departAt);
      if (!r) return ok({ found: false, note: "No route returned by Google Routes." });
      const rec = evidence.put({ kind: "travel_time", source: r.source, provider: r.provider, data: r.data });
      return ok({ found: true, evidenceId: rec.id, minutes: r.data.durationMinutes, mode });
    }),
  );

  return s;
}
