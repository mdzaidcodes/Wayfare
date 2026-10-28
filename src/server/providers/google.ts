import "server-only";
import { z } from "zod";
import type { Location, Photo } from "@/lib/schemas/common";
import type { OpeningHours, PlaceData, TravelTimeData } from "@/lib/schemas/evidence";
import { timeZoneNear } from "./airports";
import { TTL, type PlanGuard } from "./guard";
import { fetchJson, ProviderError } from "./http";
import type { Normalized, PlacesProvider, ProviderResult, RoutesProvider } from "./types";

// Google Places API (New) and Routes API. Photo URLs point at Wayfare's own proxy
// (/api/photo?ref=…), so the key never reaches the browser.

const LatLng = z.object({ latitude: z.number(), longitude: z.number() });
const Point = z.object({ day: z.number().int().min(0).max(6), hour: z.number().int(), minute: z.number().int() });
const GPlace = z
  .object({
    id: z.string(),
    displayName: z.object({ text: z.string() }).optional(),
    formattedAddress: z.string().optional(),
    location: LatLng.optional(),
    types: z.array(z.string()).optional(),
    rating: z.number().optional(),
    userRatingCount: z.number().optional(),
    utcOffsetMinutes: z.number().optional(),
    websiteUri: z.string().optional(),
    priceRange: z
      .object({
        startPrice: z.object({ currencyCode: z.string(), units: z.union([z.string(), z.number()]).optional(), nanos: z.number().optional() }).optional(),
      })
      .passthrough()
      .optional(),
    googleMapsUri: z.string().optional(),
    regularOpeningHours: z
      .object({
        periods: z.array(z.object({ open: Point, close: Point.optional() })).optional(),
      })
      .optional(),
    photos: z
      .array(
        z.object({
          name: z.string(),
          widthPx: z.number().optional(),
          heightPx: z.number().optional(),
          authorAttributions: z.array(z.object({ displayName: z.string().optional(), uri: z.string().optional() })).optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

const FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "rating",
  "userRatingCount",
  "utcOffsetMinutes",
  "websiteUri",
  "googleMapsUri",
  "regularOpeningHours",
  "photos",
  "priceRange",
];

const hhmm = (p: z.infer<typeof Point>) => `${String(p.hour % 24).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;

export function photoProxyUrl(photoName: string, maxWidth = 800): string {
  return `/api/photo?ref=${encodeURIComponent(photoName)}&w=${maxWidth}`;
}

export function normalizePlace(raw: unknown): PlaceData | undefined {
  const p = GPlace.safeParse(raw);
  if (!p.success || !p.data.displayName) return undefined;
  const g = p.data;
  const point = g.location ? { lat: g.location.latitude, lng: g.location.longitude } : undefined;
  const timeZone = point ? timeZoneNear(point.lat, point.lng) : undefined;
  const loc: Location = { name: g.displayName!.text, address: g.formattedAddress, point, placeId: g.id, timeZone };
  const d: PlaceData = { name: g.displayName!.text, location: loc };
  if (g.types) d.types = g.types;
  if (g.rating !== undefined) d.rating = g.rating;
  if (g.userRatingCount !== undefined) d.reviewCount = g.userRatingCount;
  if (g.websiteUri && /^https?:/.test(g.websiteUri)) d.websiteUrl = g.websiteUri;
  if (g.googleMapsUri && /^https?:/.test(g.googleMapsUri)) d.mapsUrl = g.googleMapsUri;
  // Google's price range is per person; only the lower bound is kept, shown as a from-price.
  const start = g.priceRange?.startPrice;
  if (start && /^[A-Z]{3}$/.test(start.currencyCode)) {
    const amount = Number(start.units ?? 0) + (start.nanos ?? 0) / 1e9;
    if (Number.isFinite(amount) && amount >= 0) d.priceFrom = { amount: Math.round(amount * 100) / 100, currency: start.currencyCode };
  }
  const periods = g.regularOpeningHours?.periods;
  if (periods && timeZone) {
    // A single period with no close means open 24 hours.
    if (periods.length === 1 && !periods[0].close) d.openingHours = { timeZone, periods: [], alwaysOpen: true };
    else {
      const oh: OpeningHours = {
        timeZone,
        periods: periods.filter((x) => x.close).map((x) => ({ day: x.open.day, open: hhmm(x.open), close: hhmm(x.close!) })),
      };
      d.openingHours = oh;
    }
  }
  if (g.photos?.length) {
    d.photos = g.photos.slice(0, 6).map(
      (ph): Photo => ({
        url: photoProxyUrl(ph.name),
        width: ph.widthPx,
        height: ph.heightPx,
        attribution: ph.authorAttributions?.map((a) => a.displayName).filter(Boolean).join(", ") || "Google",
      }),
    );
  }
  return d;
}

export function googlePlacesProvider(key: string | undefined): PlacesProvider {
  const headers = (mask: string) => ({
    "Content-Type": "application/json",
    "X-Goog-Api-Key": key ?? "",
    "X-Goog-FieldMask": mask,
  });
  const need = () => {
    if (!key) throw new ProviderError("Google Places", "GOOGLE_MAPS_API_KEY is not set.");
  };
  const textSearch = async (body: object, guard: PlanGuard, op: string) => {
    need();
    const raw = await guard.call("google", op, JSON.stringify(body), TTL.places, () =>
      fetchJson<{ places?: unknown[] }>("Google Places", "https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: headers(FIELDS.map((f) => `places.${f}`).join(",")),
        body: JSON.stringify(body),
        secrets: [key],
      }),
    );
    return raw.places ?? [];
  };
  return {
    id: "google-places",
    label: "Google Places",
    available: () => Boolean(key),
    async geocode(query, guard) {
      const [first] = await textSearch({ textQuery: query, pageSize: 1 }, guard, "places.geocode");
      const d = first ? normalizePlace(first) : undefined;
      return d && { data: d, source: "Google Places", provider: "google-places" };
    },
    async searchAttractions(query, near, guard, limit = 10): Promise<ProviderResult<PlaceData>> {
      const body: Record<string, unknown> = { textQuery: query, pageSize: Math.min(20, limit) };
      if (near?.point) {
        body.locationBias = {
          circle: { center: { latitude: near.point.lat, longitude: near.point.lng }, radius: 20000 },
        };
      }
      const raw = await textSearch(body, guard, "places.searchText");
      const items: Normalized<PlaceData>[] = [];
      for (const r of raw) {
        const d = normalizePlace(r);
        if (d) items.push({ data: d, source: "Google Places", provider: "google-places" });
      }
      return { items, dropped: raw.length > items.length ? [{ reason: "place without a name", count: raw.length - items.length }] : [] };
    },
    async details(placeId, guard) {
      need();
      if (!/^[A-Za-z0-9_-]+$/.test(placeId)) return undefined;
      const raw = await guard.call("google", "places.details", placeId, TTL.places, () =>
        fetchJson("Google Places", `https://places.googleapis.com/v1/places/${placeId}`, {
          headers: headers(FIELDS.join(",")),
          secrets: [key],
        }),
      );
      const d = normalizePlace(raw);
      return d && { data: d, source: "Google Places", provider: "google-places" };
    },
  };
}

const MODE: Record<TravelTimeData["mode"], string> = { drive: "DRIVE", transit: "TRANSIT", walk: "WALK" };

export function googleRoutesProvider(key: string | undefined): RoutesProvider {
  return {
    id: "google-routes",
    label: "Google Routes",
    available: () => Boolean(key),
    async travelTime(from, to, mode, guard, departAt) {
      if (!key) throw new ProviderError("Google Routes", "GOOGLE_MAPS_API_KEY is not set.");
      const wp = (l: Location) =>
        l.placeId
          ? { placeId: l.placeId }
          : l.point
            ? { location: { latLng: { latitude: l.point.lat, longitude: l.point.lng } } }
            : l.address || l.name
              ? { address: l.address ?? l.name }
              : undefined;
      const origin = wp(from);
      const destination = wp(to);
      if (!origin || !destination) return undefined;
      const body: Record<string, unknown> = { origin, destination, travelMode: MODE[mode] };
      // Transit requests don't accept a routing preference.
      if (mode === "drive") body.routingPreference = "TRAFFIC_UNAWARE";
      if (departAt && mode === "transit" && Date.parse(departAt) > Date.now()) body.departureTime = new Date(departAt).toISOString();
      const raw = await guard.call("google", `routes.${mode}`, JSON.stringify(body), TTL.routes, () =>
        fetchJson<{ routes?: { duration?: string; distanceMeters?: number }[] }>(
          "Google Routes",
          "https://routes.googleapis.com/directions/v2:computeRoutes",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": key,
              "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
            },
            body: JSON.stringify(body),
            secrets: [key],
          },
        ),
      );
      return normalizeRoute(raw, from, to, mode);
    },
  };
}

export function normalizeRoute(
  raw: { routes?: { duration?: string; distanceMeters?: number }[] },
  from: Location,
  to: Location,
  mode: TravelTimeData["mode"],
): Normalized<TravelTimeData> | undefined {
  const r = raw.routes?.[0];
  const secs = r?.duration ? Number(r.duration.replace(/s$/, "")) : NaN;
  if (!Number.isFinite(secs)) return undefined;
  const d: TravelTimeData = { from, to, mode, durationMinutes: Math.max(1, Math.round(secs / 60)) };
  if (r?.distanceMeters !== undefined) d.distanceMeters = r.distanceMeters;
  return { data: d, source: "Google Routes", provider: "google-routes" };
}

/** Streams a place photo for the proxy route. Returns the upstream response (image bytes). */
export async function fetchPlacePhoto(key: string, ref: string, maxWidth: number): Promise<Response> {
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(ref)) {
    throw new ProviderError("Google Places", "invalid photo reference");
  }
  const w = Math.min(1600, Math.max(100, Math.round(maxWidth)));
  const res = await fetch(`https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${w}`, {
    headers: { "X-Goog-Api-Key": key },
    redirect: "follow",
  });
  if (!res.ok) throw new ProviderError("Google Places", `photo HTTP ${res.status}`, res.status);
  return res;
}
