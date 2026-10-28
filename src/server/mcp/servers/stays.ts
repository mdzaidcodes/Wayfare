import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EvidenceOf } from "@/lib/schemas/evidence";
import { daysBetween } from "@/lib/time";
import type { HotelQuery } from "../../providers/types";
import { fail, ok, safe, type ServerDeps } from "../context";

export function hotelSummary(r: EvidenceOf<"hotel">) {
  const d = r.data;
  return {
    evidenceId: r.id,
    name: d.name,
    totalPrice: d.totalPrice,
    pricePerNight: d.pricePerNight,
    rating: d.rating,
    reviewCount: d.reviewCount,
    starClass: d.starClass,
    photoCount: d.photos.length,
    hasLocation: Boolean(d.location.point),
    amenities: d.amenities?.slice(0, 12),
    freeCancellation: d.freeCancellation,
  };
}

export function hotelQueryOf(r: EvidenceOf<"hotel">, destination: string, currency: string): HotelQuery {
  return {
    destination,
    checkIn: r.data.checkIn,
    checkOut: r.data.checkOut,
    adults: r.data.adults,
    rooms: r.data.rooms,
    currency,
  };
}

export function createStaysServer(deps: ServerDeps): McpServer {
  const s = new McpServer({ name: "wayfare-stays", version: "0.1.0" });
  const { evidence, guard, providers, progress } = deps;
  const destinations = new Map<string, string>();

  s.registerTool(
    "search_hotels",
    {
      description:
        "Hotel search for the stay. Returns evidence IDs with total and nightly price, rating, stars and amenities. Hotel descriptions are not returned.",
      inputSchema: {
        destination: z.string().min(2).max(120),
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adults: z.number().int().min(1).max(9),
        rooms: z.number().int().min(1).max(9).default(1),
        currency: z.string().length(3),
        maxPricePerNight: z.number().positive().optional(),
        maxResults: z.number().int().min(1).max(30).default(20),
      },
    },
    safe(async (a) => {
      if (daysBetween(a.checkIn, a.checkOut) < 1) return fail("checkOut must be after checkIn");
      const active = providers.hotels.filter((p) => p.available());
      if (!active.length) return fail("Hotel search needs APIFY_TOKEN, which isn't set.");
      progress(`Checking hotels in ${a.destination}…`);
      const q: HotelQuery = { ...a, currency: a.currency.toUpperCase() };
      const hotels: ReturnType<typeof hotelSummary>[] = [];
      const problems: string[] = [];
      const dropped: { reason: string; count: number }[] = [];
      for (const p of active) {
        try {
          const r = await p.search(q, guard);
          dropped.push(...r.dropped);
          for (const item of r.items) {
            const rec = evidence.put({ kind: "hotel", source: item.source, provider: item.provider, data: item.data });
            destinations.set(rec.id, a.destination);
            hotels.push(hotelSummary(rec));
          }
        } catch (e) {
          problems.push(e instanceof Error ? e.message : `${p.label} failed`);
        }
      }
      if (!hotels.length && problems.length) return fail(problems.join("; "));
      progress(`${hotels.length} hotels found`);
      return ok({ count: hotels.length, hotels, dropped, problems });
    }),
  );

  s.registerTool(
    "get_hotel_offers",
    {
      description: "Per-site prices for one hotel (nightly, total, taxes, free cancellation, link).",
      inputSchema: {
        hotelEvidenceId: z.string(),
        destination: z.string().optional().describe("City used in the original search"),
      },
    },
    safe(async ({ hotelEvidenceId, destination }) => {
      const hotel = evidence.getOf(hotelEvidenceId, "hotel");
      if (!hotel) return fail(`Unknown hotel evidence ID ${hotelEvidenceId}`);
      const active = providers.hotels.filter((p) => p.available());
      if (!active.length) return fail("Per-site hotel prices need APIFY_TOKEN, which isn't set.");
      const dest = destination ?? destinations.get(hotelEvidenceId) ?? hotel.data.location.address ?? "";
      progress(`Comparing prices for ${hotel.data.name}…`);
      const currency = hotel.data.totalPrice?.currency ?? hotel.data.pricePerNight?.currency ?? "EUR";
      // Offers already captured with the hotel (booking-sources mode) are reused.
      const offers = hotel.data.offers?.length
        ? hotel.data.offers
        : await active[0].offers(hotelQueryOf(hotel, dest, currency), hotel.data, guard);
      const rec = evidence.put({
        kind: "hotel_offers",
        source: "Google Hotels",
        provider: active[0].id,
        data: { hotelEvidenceId, offers },
      });
      return ok({
        evidenceId: rec.id,
        sites: offers.map((o) => ({ seller: o.seller, totalPrice: o.totalPrice })),
        note: offers.length ? undefined : "No per-site prices were listed for this hotel.",
      });
    }),
  );

  return s;
}
