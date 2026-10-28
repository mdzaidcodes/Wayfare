import "server-only";
import data from "../data/airports.json";
import type { Airport } from "@/lib/schemas/evidence";

// Bundled open dataset (mwgg/Airports, built by scripts/build-airports.mts): IATA code, name,
// city, country, coordinates and IANA time zone.

export interface AirportRow extends Airport {
  lat: number;
  lng: number;
  timeZone: string;
}

type Row = [string, string, string, string, number, number, string];

const byCode = new Map<string, AirportRow>();
const all: AirportRow[] = [];
for (const [iata, name, city, country, lat, lng, tz] of data.rows as Row[]) {
  const row: AirportRow = { code: iata, name, city, country, lat, lng, timeZone: tz };
  byCode.set(iata, row);
  all.push(row);
}

export const AIRPORT_DATASET = { name: "mwgg/Airports (open data)", fetched: data.fetched };

export function airportByCode(code: string): AirportRow | undefined {
  return byCode.get(code.trim().toUpperCase());
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Matches an IATA code, a city, or an airport name. Exact code or city matches come first. */
export function searchAirports(query: string, limit = 8): AirportRow[] {
  const q = norm(query);
  if (!q) return [];
  if (/^[a-z]{3}$/.test(q)) {
    const exact = byCode.get(q.toUpperCase());
    if (exact) return [exact];
  }
  const scored: { a: AirportRow; s: number }[] = [];
  for (const a of all) {
    const city = norm(a.city ?? "");
    const name = norm(a.name ?? "");
    let s = 0;
    if (city === q) s = 3;
    else if (name.includes(q)) s = 2;
    else if (city.startsWith(q)) s = 1;
    if (s) scored.push({ a, s: s + (name.includes("international") ? 0.5 : 0) });
  }
  return scored.sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);
}

/** Time zone of the nearest airport, used to place hotels and sights in local time. */
export function timeZoneNear(lat: number, lng: number, maxKm = 300): string | undefined {
  let best: AirportRow | undefined;
  let bestD = Infinity;
  for (const a of all) {
    const d = haversineKm(lat, lng, a.lat, a.lng);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best && bestD <= maxKm ? best.timeZone : undefined;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
