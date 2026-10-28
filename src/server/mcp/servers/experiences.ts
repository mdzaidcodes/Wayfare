import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EvidenceOf, ExperienceData, PlaceData } from "@/lib/schemas/evidence";
import { fail, ok, safe, type ServerDeps } from "../context";

export function experienceSummary(r: EvidenceOf<"experience">) {
  const d = r.data;
  return {
    evidenceId: r.id,
    title: d.title,
    interest: d.interest,
    price: d.price,
    isFree: d.isFree,
    priceIsPerPerson: d.priceIsPerPerson,
    durationMinutes: d.durationMinutes,
    rating: d.rating,
    reviewCount: d.reviewCount,
    hasOpeningHours: Boolean(d.openingHours),
    hasPhoto: Boolean(d.photo),
    bookable: Boolean(d.bookingUrl || d.bookable),
    source: r.source,
  };
}

/** A Google place as a selectable sight: a from-price only when Google lists one, no booking link. */
export function placeToExperience(p: PlaceData, interest: string): ExperienceData {
  const d: ExperienceData = { title: p.name, interest, location: p.location };
  if (p.photos?.[0]) d.photo = p.photos[0];
  if (p.openingHours) d.openingHours = p.openingHours;
  if (p.rating !== undefined) d.rating = p.rating;
  if (p.reviewCount !== undefined) d.reviewCount = p.reviewCount;
  if (p.priceFrom) {
    d.price = p.priceFrom;
    d.priceIsPerPerson = true;
    if (p.priceFrom.amount === 0) d.isFree = true;
  }
  return d;
}

export function createExperiencesServer(deps: ServerDeps): McpServer {
  const s = new McpServer({ name: "wayfare-experiences", version: "0.1.0" });
  const { evidence, guard, providers, progress } = deps;

  s.registerTool(
    "search_experiences",
    {
      description:
        "Bookable tours and activities for one interest (Viator). Prices are from-prices per person. Descriptions are not returned.",
      inputSchema: {
        destination: z.string().min(2).max(120),
        interest: z.string().min(2).max(80),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        currency: z.string().length(3),
        maxPricePerPerson: z.number().positive().optional(),
        limit: z.number().int().min(1).max(20).default(8),
      },
    },
    safe(async (a) => {
      const active = providers.experiences.filter((p) => p.available());
      if (!active.length) return fail("Bookable activities need VIATOR_API_KEY, which isn't set. Try search_attractions.");
      progress(`Looking for ${a.interest} in ${a.destination}…`);
      const out: ReturnType<typeof experienceSummary>[] = [];
      const dropped: { reason: string; count: number }[] = [];
      for (const p of active) {
        const r = await p.search({ ...a, currency: a.currency.toUpperCase() }, guard);
        dropped.push(...r.dropped);
        for (const item of r.items) {
          const rec = evidence.put({ kind: "experience", source: item.source, provider: item.provider, data: item.data });
          out.push(experienceSummary(rec));
        }
      }
      return ok({ count: out.length, experiences: out, dropped });
    }),
  );

  s.registerTool(
    "search_attractions",
    {
      description:
        "Sights and places for one interest (Google Places), with opening hours and rating. Entry prices only when Google lists a price range (per person).",
      inputSchema: {
        query: z.string().min(2).max(120).describe('e.g. "beaches in Lisbon"'),
        interest: z.string().min(2).max(80),
        near: z.object({ lat: z.number(), lng: z.number() }).optional(),
        limit: z.number().int().min(1).max(20).default(8),
      },
    },
    safe(async ({ query, interest, near, limit }) => {
      if (!providers.places.available()) return fail("Sights need GOOGLE_MAPS_API_KEY, which isn't set.");
      progress(`Finding ${interest} spots…`);
      const r = await providers.places.searchAttractions(query, near ? { point: near } : undefined, guard, limit);
      const out = r.items.map((item) => {
        const rec = evidence.put({
          kind: "experience",
          source: item.source,
          provider: item.provider,
          data: placeToExperience(item.data, interest),
        });
        return experienceSummary(rec);
      });
      return ok({ count: out.length, attractions: out, dropped: r.dropped });
    }),
  );

  s.registerTool(
    "get_place_details",
    {
      description: "Opening hours, rating and photos for one Google place ID.",
      inputSchema: { placeId: z.string().min(5).max(300) },
    },
    safe(async ({ placeId }) => {
      if (!providers.places.available()) return fail("Place details need GOOGLE_MAPS_API_KEY, which isn't set.");
      const r = await providers.places.details(placeId, guard);
      if (!r) return ok({ found: false });
      const rec = evidence.put({ kind: "place", source: r.source, provider: r.provider, data: r.data });
      return ok({
        found: true,
        evidenceId: rec.id,
        name: r.data.name,
        hasOpeningHours: Boolean(r.data.openingHours),
        rating: r.data.rating,
      });
    }),
  );

  return s;
}
