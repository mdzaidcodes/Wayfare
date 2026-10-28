// Builds src/server/data/airports.json from the open mwgg/Airports dataset (MIT), keeping only
// airports with an IATA code. Run: npx tsx scripts/build-airports.mts
import fs from "node:fs";
const SRC = "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json";
const raw = (await (await fetch(SRC)).json()) as Record<string, { iata: string; name: string; city: string; country: string; lat: number; lon: number; tz: string }>;
const rows = Object.values(raw)
  .filter((a) => /^[A-Z]{3}$/.test(a.iata) && a.tz)
  .map((a) => [a.iata, a.name, a.city, a.country, Math.round(a.lat * 1e4) / 1e4, Math.round(a.lon * 1e4) / 1e4, a.tz]);
fs.mkdirSync("src/server/data", { recursive: true });
fs.writeFileSync(
  "src/server/data/airports.json",
  JSON.stringify({ source: SRC, fetched: new Date().toISOString().slice(0, 10), columns: ["iata", "name", "city", "country", "lat", "lon", "tz"], rows }),
);
console.log(`${rows.length} airports`);
