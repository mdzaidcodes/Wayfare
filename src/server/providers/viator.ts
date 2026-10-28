import "server-only";
import { z } from "zod";
import type { ExperienceData } from "@/lib/schemas/evidence";
import { timeZoneNear } from "./airports";
import { TTL, type PlanGuard } from "./guard";
import { fetchJson, ProviderError } from "./http";
import type { ExperienceProvider, ExperienceQuery, ProviderResult } from "./types";

// Viator Partner API v2, affiliate Basic access (content only: search, one main image, from-price,
// product URL with affiliate attribution). Booking always happens on viator.com.

const Destination = z
  .object({
    destinationId: z.number(),
    name: z.string(),
    type: z.string().optional(),
    timeZone: z.string().optional(),
    center: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  })
  .passthrough();
type Destination = z.infer<typeof Destination>;

const Variant = z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() });
const Product = z
  .object({
    productCode: z.string(),
    title: z.string(),
    description: z.string().optional(),
    productUrl: z.string().optional(),
    images: z
      .array(z.object({ isCover: z.boolean().optional(), variants: z.array(Variant).optional() }).passthrough())
      .optional(),
    reviews: z.object({ totalReviews: z.number().optional(), combinedAverageRating: z.number().optional() }).passthrough().optional(),
    duration: z
      .object({
        fixedDurationInMinutes: z.number().optional(),
        variableDurationFromMinutes: z.number().optional(),
        variableDurationToMinutes: z.number().optional(),
      })
      .passthrough()
      .optional(),
    pricing: z
      .object({ summary: z.object({ fromPrice: z.number().optional() }).passthrough().optional(), currency: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function normalizeViatorProducts(
  raw: unknown[],
  dest: Destination,
  q: ExperienceQuery,
): ProviderResult<ExperienceData> {
  const items: ProviderResult<ExperienceData>["items"] = [];
  let bad = 0;
  const tz =
    dest.timeZone ?? (dest.center ? timeZoneNear(dest.center.latitude, dest.center.longitude) : undefined);
  for (const r of raw) {
    const p = Product.safeParse(r);
    if (!p.success) {
      bad++;
      continue;
    }
    const v = p.data;
    const d: ExperienceData = {
      title: v.title,
      interest: q.interest,
      productCode: v.productCode,
      bookable: true,
      // Meeting points aren't in Basic-access search results, so only the destination is known.
      location: { name: dest.name, timeZone: tz },
    };
    if (v.description) d.description = v.description.slice(0, 1200);
    const cover = v.images?.find((i) => i.isCover) ?? v.images?.[0];
    const variant = cover?.variants
      ?.filter((x) => /^https:\/\//.test(x.url))
      .sort((a, b) => Math.abs((a.width ?? 0) - 720) - Math.abs((b.width ?? 0) - 720))[0];
    if (variant) d.photo = { url: variant.url, width: variant.width, height: variant.height, attribution: "Viator" };
    const from = v.pricing?.summary?.fromPrice;
    if (from !== undefined) {
      d.price = { amount: from, currency: (v.pricing?.currency ?? q.currency).toUpperCase() };
      d.priceIsPerPerson = true;
      if (from === 0) d.isFree = true;
    }
    const dur = v.duration?.fixedDurationInMinutes ?? v.duration?.variableDurationToMinutes ?? v.duration?.variableDurationFromMinutes;
    if (dur) d.durationMinutes = Math.round(dur);
    if (v.reviews?.combinedAverageRating !== undefined) d.rating = v.reviews.combinedAverageRating;
    if (v.reviews?.totalReviews !== undefined) d.reviewCount = v.reviews.totalReviews;
    if (v.productUrl && /^https:\/\//.test(v.productUrl)) d.bookingUrl = v.productUrl;
    items.push({ data: d, source: "Viator", provider: "viator" });
  }
  return { items, dropped: bad ? [{ reason: "unexpected format from Viator", count: bad }] : [] };
}

export function findDestination(all: Destination[], query: string): Destination | undefined {
  const n = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const q = n(query.split(",")[0]);
  const ranked = all
    .filter((d) => n(d.name) === q || n(d.name).startsWith(q))
    .sort((a, b) => Number(n(b.name) === q) - Number(n(a.name) === q) || Number(b.type === "CITY") - Number(a.type === "CITY"));
  return ranked[0];
}

export function viatorProvider(key: string | undefined, base: string): ExperienceProvider {
  const headers = () => ({
    "exp-api-key": key ?? "",
    Accept: "application/json;version=2.0",
    "Accept-Language": "en-US",
    "Content-Type": "application/json",
  });
  const destinations = async (guard: PlanGuard): Promise<Destination[]> => {
    const raw = await guard
      .call("viator", "destinations", "all", TTL.destinations, () =>
        fetchJson<{ destinations?: unknown[] }>("Viator", `${base}/destinations`, { headers: headers(), secrets: [key], timeoutMs: 30_000 }),
      )
      .catch((e: unknown) => {
        // Sandbox and production keys aren't interchangeable, and a mismatch only says "Invalid API Key".
        if (e instanceof ProviderError && e.status === 401) {
          const other = base.includes("sandbox") ? "production (remove VIATOR_API_BASE)" : "the sandbox (VIATOR_API_BASE=https://api.sandbox.viator.com/partner)";
          throw new ProviderError("Viator", `the API key was rejected. If it's a key for ${other}, change that setting.`, 401);
        }
        throw e;
      });
    return (raw.destinations ?? []).flatMap((d) => {
      const p = Destination.safeParse(d);
      return p.success ? [p.data] : [];
    });
  };
  return {
    id: "viator",
    label: "Viator",
    available: () => Boolean(key),
    async search(q, guard) {
      if (!key) throw new ProviderError("Viator", "VIATOR_API_KEY is not set.");
      const dest = findDestination(await destinations(guard), q.destination);
      if (!dest) return { items: [], dropped: [{ reason: `Viator has no destination matching "${q.destination}"`, count: 1 }] };
      const body: Record<string, unknown> = {
        searchTerm: q.interest,
        currency: q.currency,
        productFiltering: {
          destination: String(dest.destinationId),
          dateRange: { from: q.startDate, to: q.endDate },
          ...(q.maxPricePerPerson ? { price: { to: Math.floor(q.maxPricePerPerson) } } : {}),
        },
        productSorting: { sort: "TRAVELER_RATING", order: "DESCENDING" },
        searchTypes: [{ searchType: "PRODUCTS", pagination: { start: 1, count: Math.min(20, q.limit ?? 10) } }],
      };
      const raw = await guard.call("viator", "search.freetext", JSON.stringify(body), TTL.experiences, () =>
        fetchJson<{ products?: { results?: unknown[] } }>("Viator", `${base}/search/freetext`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
          secrets: [key],
        }),
      );
      return normalizeViatorProducts(raw.products?.results ?? [], dest, q);
    },
  };
}
