import "server-only";
import type { FlightData, HotelData, HotelOffer, SellerOffer } from "@/lib/schemas/evidence";
import type { Money, Photo } from "@/lib/schemas/common";
import { toIsoWithOffset } from "@/lib/time";
import { timeZoneNear } from "./airports";
import { TTL, type PlanGuard } from "./guard";
import { fetchJson, ProviderError } from "./http";
import type { FlightOffersProvider, FlightQuery, HotelProvider, HotelQuery, ProviderResult } from "./types";

// Apify actors are third-party scrapers and can change shape. Parsing here is defensive: each field
// is read from the documented key (with a few known aliases), and anything unreadable is left absent.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const pick = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const url = (v: unknown) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};
/** 123, "123", "$1,234.50", "€ 99" → number. */
export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(/[^\d.,-]/g, "");
  if (!cleaned) return undefined;
  // "1.234,50" (EU) vs "1,234.50" (US)
  const normalized =
    cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

/** "3:00 PM", "15:00", "3 PM" → "15:00". */
export function toHHMM(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export async function runActor(token: string, actor: string, input: Obj, timeoutSec = 120): Promise<unknown[]> {
  const id = actor.replace("/", "~");
  const u = `https://api.apify.com/v2/acts/${encodeURIComponent(id)}/run-sync-get-dataset-items?timeout=${timeoutSec}&clean=true`;
  const items = await fetchJson<unknown>("Apify", u, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    timeoutMs: (timeoutSec + 15) * 1000,
    retries: 0,
    secrets: [token],
  });
  if (!Array.isArray(items)) throw new ProviderError("Apify", `actor ${actor} returned an unexpected response`);
  return items;
}

// ---------- Google Hotels (benthepythondev/google-hotels-scraper) ----------

function photosOf(row: Obj): Photo[] {
  const raw = pick(row, "images", "photos");
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const out: Photo[] = [];
  for (const p of list) {
    const u = isObj(p) ? url(pick(p, "url", "original", "originalImage", "image", "thumbnail")) : url(p);
    if (u && !out.some((x) => x.url === u)) out.push({ url: u, attribution: "Google Hotels" });
  }
  const thumb = url(row.thumbnail);
  if (out.length === 0 && thumb) out.push({ url: thumb, attribution: "Google Hotels" });
  return out;
}

export function normalizeHotelOffers(row: Obj, currency: string, fetchedAt: string): HotelOffer[] | undefined {
  const raw = pick(row, "bookingSources", "booking_sources", "prices");
  if (!Array.isArray(raw)) return undefined;
  const out: HotelOffer[] = [];
  for (const o of raw) {
    if (!isObj(o)) continue;
    const seller = str(pick(o, "vendorName", "source", "name", "seller"));
    const total = num(pick(o, "totalRate", "total", "totalPrice"));
    if (!seller || total === undefined) continue;
    const nightly = num(pick(o, "ratePerNight", "pricePerNight", "nightly"));
    const offer: HotelOffer = {
      seller,
      totalPrice: { amount: total, currency },
      fetchedAt,
    };
    if (nightly !== undefined) offer.pricePerNight = { amount: nightly, currency };
    const fc = bool(pick(o, "freeCancellation", "free_cancellation"));
    if (fc !== undefined) offer.freeCancellation = fc;
    const ti = bool(pick(o, "taxesIncluded", "includesTaxes"));
    if (ti !== undefined) offer.taxesIncluded = ti;
    const link = url(pick(o, "bookingUrl", "link", "url"));
    if (link) offer.bookingUrl = link;
    out.push(offer);
  }
  return out;
}

export function normalizeHotels(rows: unknown[], q: HotelQuery, fetchedAt: string): ProviderResult<HotelData> {
  const items: ProviderResult<HotelData>["items"] = [];
  let noName = 0;
  for (const row of rows) {
    if (!isObj(row)) continue;
    const name = str(pick(row, "hotelName", "name", "title"));
    if (!name) {
      noName++;
      continue;
    }
    const currency = str(row.currency)?.toUpperCase() ?? q.currency;
    const lat = num(pick(row, "gpsLatitude", "latitude", "lat"));
    const lng = num(pick(row, "gpsLongitude", "longitude", "lng"));
    const point = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    const money = (v: unknown): Money | undefined => {
      const n = num(v);
      return n !== undefined && n >= 0 ? { amount: n, currency } : undefined;
    };
    const d: HotelData = {
      name,
      photos: photosOf(row),
      location: {
        name,
        address: str(pick(row, "address", "location")),
        point,
        timeZone: point ? timeZoneNear(point.lat, point.lng) : undefined,
      },
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      adults: q.adults,
      rooms: q.rooms,
    };
    const pn = money(row.pricePerNight);
    const total = money(pick(row, "totalRate", "totalPrice"));
    if (pn) d.pricePerNight = pn;
    if (total) d.totalPrice = total;
    // The actor documents pricePerNight and totalRate as including taxes and fees.
    if (pn || total) d.taxesIncluded = true;
    const ci = toHHMM(row.checkInTime);
    const co = toHHMM(row.checkOutTime);
    if (ci) d.checkInTime = ci;
    if (co) d.checkOutTime = co;
    const rating = num(pick(row, "overallRating", "rating"));
    if (rating !== undefined && rating <= 5) {
      d.rating = rating;
      d.ratingScale = 5;
    }
    const rc = num(pick(row, "reviewCount", "reviews"));
    if (rc !== undefined) d.reviewCount = Math.round(rc);
    const stars = num(pick(row, "hotelClass", "starRating", "stars"));
    if (stars !== undefined && stars > 0 && stars <= 7) d.starClass = stars;
    const am = row.amenities;
    if (Array.isArray(am)) d.amenities = am.map((a) => (isObj(a) ? str(a.name) : str(a))).filter((x): x is string => !!x);
    const fc = bool(row.freeCancellation);
    if (fc !== undefined) d.freeCancellation = fc;
    const link = url(pick(row, "url", "link"));
    if (link) d.bookingUrl = link;
    const desc = str(pick(row, "hotelDescription", "description"));
    if (desc) d.description = desc.slice(0, 1500);
    const offers = normalizeHotelOffers(row, currency, fetchedAt);
    if (offers) {
      d.offers = offers;
      if (offers.some((o) => o.freeCancellation) && d.freeCancellation === undefined) d.freeCancellation = true;
    }
    items.push({ data: d, source: "Google Hotels", provider: "apify-google-hotels" });
  }
  return { items, dropped: noName ? [{ reason: "hotel without a name", count: noName }] : [] };
}

export function apifyHotelsProvider(token: string | undefined, actor: string): HotelProvider {
  const input = (q: HotelQuery, extra: Obj) => ({
    searches: [q.destination],
    checkInDate: q.checkIn,
    checkOutDate: q.checkOut,
    adults: q.adults,
    currency: q.currency,
    maxResults: q.maxResults ?? 20,
    sortBy: "relevance",
    ...(q.maxPricePerNight ? { maxPrice: Math.floor(q.maxPricePerNight) } : {}),
    ...extra,
  });
  return {
    id: "apify-google-hotels",
    label: "Google Hotels (via Apify)",
    available: () => Boolean(token),
    async search(q, guard: PlanGuard) {
      if (!token) throw new ProviderError("Apify", "APIFY_TOKEN is not set, so hotel search is unavailable.");
      const body = input(q, { includeBookingSources: false });
      const rows = await guard.call(
        "apify",
        "google-hotels.search",
        JSON.stringify(body),
        TTL.hotels,
        () => runActor(token, actor, body),
        (r) => r.length,
      );
      return normalizeHotels(rows, q, toIsoWithOffset(new Date(), "UTC"));
    },
    async offers(q, hotel, guard: PlanGuard) {
      if (!token) throw new ProviderError("Apify", "APIFY_TOKEN is not set, so per-site hotel prices are unavailable.");
      // Search for the exact hotel by name near the destination, with booking sources on.
      const body = input({ ...q, destination: `${hotel.name} ${q.destination}`, maxResults: 3 }, { includeBookingSources: true });
      const rows = await guard.call(
        "apify",
        "google-hotels.offers",
        JSON.stringify(body),
        TTL.offers,
        () => runActor(token, actor, body),
        (r) => r.length,
      );
      const now = toIsoWithOffset(new Date(), "UTC");
      const match = normalizeHotels(rows, q, now).items.find((h) => sameHotel(h.data, hotel));
      return match?.data.offers ?? [];
    },
  };
}

function sameHotel(a: HotelData, b: HotelData): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n(a.name) !== n(b.name)) return false;
  if (a.location.point && b.location.point) {
    return Math.abs(a.location.point.lat - b.location.point.lat) < 0.01 && Math.abs(a.location.point.lng - b.location.point.lng) < 0.01;
  }
  return true;
}

// ---------- Google Flights seller offers (lergassy/google-flights-api) ----------

const flightNos = (o: Obj): string[] => {
  const v = pick(o, "flightNumbers", "flight_numbers");
  if (Array.isArray(v)) return v.map((x) => String(x).replace(/\s+/g, "").toUpperCase());
  const legs = o.legs;
  if (Array.isArray(legs)) {
    return legs
      .map((l) => (isObj(l) ? str(pick(l, "flightNumber", "flight_number")) : undefined))
      .filter((x): x is string => !!x)
      .map((x) => x.replace(/\s+/g, "").toUpperCase());
  }
  return [];
};

const legNos = (f: FlightData["outbound"]) =>
  f.segments.map((s) => `${s.flightNumber ?? ""}`.replace(/\s+/g, "").toUpperCase()).filter(Boolean);

const sameList = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);

export function normalizeFlightOffers(rows: unknown[], flight: FlightData, currency: string, fetchedAt: string): SellerOffer[] | undefined {
  const out = legNos(flight.outbound);
  const back = legNos(flight.inbound);
  if (!out.length || !back.length) return undefined;
  for (const row of rows) {
    if (!isObj(row) || !sameList(flightNos(row), out)) continue;
    // Booking options cover the outbound plus its cheapest return; only trust them when that
    // return is the same one the user is looking at.
    const returns = Array.isArray(row.returnOptions) ? row.returnOptions.filter(isObj) : [];
    const cheapestReturn = [...returns].sort((a, b) => (num(a.price) ?? Infinity) - (num(b.price) ?? Infinity))[0];
    if (!cheapestReturn || !sameList(flightNos(cheapestReturn), back)) return undefined;
    const opts = Array.isArray(row.bookingOptions) ? row.bookingOptions.filter(isObj) : [];
    const offers: SellerOffer[] = [];
    for (const o of opts) {
      const seller = str(pick(o, "seller", "vendor", "name", "bookWith", "airline"));
      const price = num(pick(o, "price", "totalPrice", "total"));
      if (!seller || price === undefined) continue;
      const offer: SellerOffer = {
        seller,
        totalPrice: { amount: price, currency: str(o.currency)?.toUpperCase() ?? currency },
        fetchedAt,
      };
      const fare = str(pick(o, "fareName", "fare", "fareType", "brand"));
      if (fare) offer.fareName = fare;
      const link = url(pick(o, "bookingUrl", "deepLink", "link", "url"));
      if (link) offer.bookingUrl = link;
      offers.push(offer);
    }
    return offers;
  }
  return undefined;
}

export function apifyFlightOffersProvider(token: string | undefined, actor: string): FlightOffersProvider {
  return {
    id: "apify-google-flights",
    label: "Google Flights sellers (via Apify)",
    available: () => Boolean(token),
    async offersFor(q: FlightQuery, flight: FlightData, guard: PlanGuard) {
      if (!token) throw new ProviderError("Apify", "APIFY_TOKEN is not set, so per-seller flight prices are unavailable.");
      const o = flight.outbound.segments[0].from.code;
      const d = flight.outbound.segments[flight.outbound.segments.length - 1].to.code;
      const body = {
        origin: o,
        destination: d,
        departureDate: q.departDate,
        returnDate: q.returnDate,
        adults: q.adults,
        cabinClass: (q.cabin ?? "economy").replace("_", " "),
        currency: q.currency,
        maxResults: 60,
        resolveReturnFlights: true,
        resolveBookingOptions: true,
        maxBookingResolutions: 10,
      };
      const rows = await guard.call(
        "apify",
        "google-flights.offers",
        JSON.stringify(body),
        TTL.offers,
        () => runActor(token, actor, body, 150),
        (r) => r.length,
      );
      // Prices for all travelers, round trip ("Round-trip prices are the total for both directions").
      return normalizeFlightOffers(rows, flight, q.currency, toIsoWithOffset(new Date(), "UTC"));
    },
  };
}
