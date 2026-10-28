// The one place that builds outbound booking links. Site URL formats aren't guaranteed by the
// sites, so each builder is covered by tests and falls back to the site's home page when it can't
// build a prefilled link.

export type Cabin = "economy" | "premium_economy" | "business" | "first";

export interface FlightSearch {
  from: string; // IATA
  to: string; // IATA
  departDate: string; // YYYY-MM-DD
  returnDate: string;
  adults: number;
  cabin?: Cabin;
  currency?: string;
}

export interface HotelSearch {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  currency?: string;
}

export interface BookingLink {
  url: string;
  label: string;
  site: string;
  /** "exact" links open the specific flight/hotel/activity; "search" opens prefilled results; "home" is the fallback. */
  kind: "exact" | "search" | "home";
}

export const PRICE_MAY_DIFFER = "Prices on the booking site may differ from what you saw here.";

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const HOMES = {
  "Google Flights": "https://www.google.com/travel/flights",
  Kayak: "https://www.kayak.com/flights",
  Skyscanner: "https://www.skyscanner.net/",
  "Booking.com": "https://www.booking.com/",
} as const;

function validFlight(s: FlightSearch): boolean {
  return (
    IATA.test(s.from) &&
    IATA.test(s.to) &&
    DATE.test(s.departDate) &&
    DATE.test(s.returnDate) &&
    s.returnDate >= s.departDate &&
    Number.isInteger(s.adults) &&
    s.adults >= 1 &&
    s.adults <= 9
  );
}

const home = (site: keyof typeof HOMES): BookingLink => ({
  url: HOMES[site],
  label: `Open ${site}`,
  site,
  kind: "home",
});

const CABIN_WORDS: Record<Cabin, string> = {
  economy: "economy",
  premium_economy: "premium economy",
  business: "business class",
  first: "first class",
};

export function googleFlightsLink(s: FlightSearch): BookingLink {
  if (!validFlight(s)) return home("Google Flights");
  const who = `${s.adults} adult${s.adults > 1 ? "s" : ""}`;
  const cabin = s.cabin && s.cabin !== "economy" ? ` in ${CABIN_WORDS[s.cabin]}` : "";
  const q = `Flights to ${s.to} from ${s.from} on ${s.departDate} through ${s.returnDate} for ${who}${cabin}`;
  const u = new URL(HOMES["Google Flights"]);
  u.searchParams.set("q", q);
  if (s.currency) u.searchParams.set("curr", s.currency);
  return { url: u.toString(), label: "Search on Google Flights", site: "Google Flights", kind: "search" };
}

const KAYAK_CABIN: Record<Cabin, string> = {
  economy: "",
  premium_economy: "/premium",
  business: "/business",
  first: "/first",
};

export function kayakLink(s: FlightSearch): BookingLink {
  if (!validFlight(s)) return home("Kayak");
  const url = `https://www.kayak.com/flights/${s.from}-${s.to}/${s.departDate}/${s.returnDate}${KAYAK_CABIN[s.cabin ?? "economy"]}/${s.adults}adults?sort=bestflight_a`;
  return { url, label: "Search on Kayak", site: "Kayak", kind: "search" };
}

const SKY_CABIN: Record<Cabin, string> = {
  economy: "economy",
  premium_economy: "premiumeconomy",
  business: "business",
  first: "first",
};

const yymmdd = (d: string) => d.slice(2).replaceAll("-", "");

export function skyscannerLink(s: FlightSearch): BookingLink {
  if (!validFlight(s)) return home("Skyscanner");
  const u = new URL(
    `https://www.skyscanner.net/transport/flights/${s.from.toLowerCase()}/${s.to.toLowerCase()}/${yymmdd(s.departDate)}/${yymmdd(s.returnDate)}/`,
  );
  u.searchParams.set("adultsv2", String(s.adults));
  u.searchParams.set("cabinclass", SKY_CABIN[s.cabin ?? "economy"]);
  u.searchParams.set("rtn", "1");
  if (s.currency) u.searchParams.set("currency", s.currency);
  return { url: u.toString(), label: "Search on Skyscanner", site: "Skyscanner", kind: "search" };
}

export function bookingComLink(s: HotelSearch): BookingLink {
  const ok =
    s.destination.trim().length > 0 &&
    DATE.test(s.checkIn) &&
    DATE.test(s.checkOut) &&
    s.checkOut > s.checkIn &&
    s.adults >= 1 &&
    s.rooms >= 1;
  if (!ok) return home("Booking.com");
  const u = new URL("https://www.booking.com/searchresults.html");
  u.searchParams.set("ss", s.destination.trim());
  u.searchParams.set("checkin", s.checkIn);
  u.searchParams.set("checkout", s.checkOut);
  u.searchParams.set("group_adults", String(s.adults));
  u.searchParams.set("no_rooms", String(s.rooms));
  u.searchParams.set("group_children", "0");
  if (s.currency) u.searchParams.set("selected_currency", s.currency);
  return { url: u.toString(), label: "Search on Booking.com", site: "Booking.com", kind: "search" };
}

/** Accepts only absolute http(s) URLs from providers. */
export function safeExternalUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Exact provider link first, then the three prefilled search sites. */
export function flightLinks(s: FlightSearch, exact?: { url?: string; seller?: string }): BookingLink[] {
  const links: BookingLink[] = [];
  const url = safeExternalUrl(exact?.url);
  if (url) links.push({ url, label: "Book this flight", site: exact?.seller ?? "Provider", kind: "exact" });
  links.push(googleFlightsLink(s), kayakLink(s), skyscannerLink(s));
  return links;
}

export function hotelLinks(s: HotelSearch, exact?: { url?: string; seller?: string }): BookingLink[] {
  const links: BookingLink[] = [];
  const url = safeExternalUrl(exact?.url);
  if (url) links.push({ url, label: "Book this hotel", site: exact?.seller ?? "Provider", kind: "exact" });
  links.push(bookingComLink(s));
  return links;
}

/** Link for one seller in Compare prices: exact when the seller gave one, otherwise a prefilled search. */
export function sellerLink(
  seller: string,
  url: string | undefined,
  fallback: BookingLink,
): BookingLink {
  const exact = safeExternalUrl(url);
  return exact ? { url: exact, label: "Book here", site: seller, kind: "exact" } : fallback;
}

export function activityLink(url: string | undefined, site: string): BookingLink | undefined {
  const exact = safeExternalUrl(url);
  return exact ? { url: exact, label: `Book on ${site}`, site, kind: "exact" } : undefined;
}
