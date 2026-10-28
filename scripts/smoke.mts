// Live smoke test per provider. Hits real APIs and costs real credits, so it never runs in CI.
//   npm run smoke                      → every provider whose key is set
//   npm run smoke -- viator            → one provider
//   npm run smoke -- apify-hotels --record   → also overwrite its fixture in test/fixtures/
import fs from "node:fs";
import { getEnv } from "@/server/env";
import { PlanGuard } from "@/server/providers/guard";
import { kiwiProvider } from "@/server/providers/kiwi";
import { fetchRates } from "@/server/providers/frankfurter";
import { apifyFlightOffersProvider, apifyHotelsProvider, runActor } from "@/server/providers/apify";
import { googlePlacesProvider, googleRoutesProvider } from "@/server/providers/google";
import { viatorProvider } from "@/server/providers/viator";

const env = getEnv();
const args = process.argv.slice(2);
const record = args.includes("--record");
const only = args.filter((a) => !a.startsWith("--"));
const guard = new PlanGuard("smoke", 50);

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const depart = inDays(45);
const ret = inDays(49);
const save = (file: string, data: unknown) => {
  if (record) fs.writeFileSync(`test/fixtures/${file}`, JSON.stringify(data, null, 2));
};

const checks: Record<string, { needs?: string; run: () => Promise<string> }> = {
  kiwi: {
    run: async () => {
      const r = await kiwiProvider(env.KIWI_MCP_URL).search(
        { from: "LHR", to: "LIS", departDate: depart, returnDate: ret, adults: 2, currency: "EUR" },
        guard,
      );
      const f = r.items[0]?.data;
      return `${r.items.length} round trips, first ${f?.totalPrice.amount} ${f?.totalPrice.currency}, link ${f?.bookingUrl ? "yes" : "no"}; dropped ${JSON.stringify(r.dropped)}`;
    },
  },
  frankfurter: {
    run: async () => {
      const fx = await fetchRates(env.FRANKFURTER_URL, "EUR", ["USD", "GBP"], guard);
      return `EUR→USD ${fx.rates.USD} on ${fx.date}`;
    },
  },
  "apify-hotels": {
    needs: env.APIFY_TOKEN,
    run: async () => {
      const input = { searches: ["Lisbon"], checkInDate: depart, checkOutDate: ret, adults: 2, currency: "EUR", maxResults: 3, includeBookingSources: true };
      const rows = await runActor(env.APIFY_TOKEN!, env.APIFY_HOTELS_ACTOR, input);
      save("apify-google-hotels.json", rows);
      const p = apifyHotelsProvider(env.APIFY_TOKEN, env.APIFY_HOTELS_ACTOR);
      const r = await p.search({ destination: "Lisbon", checkIn: depart, checkOut: ret, adults: 2, rooms: 1, currency: "EUR", maxResults: 3 }, guard);
      const h = r.items[0]?.data;
      return `${r.items.length} hotels; first "${h?.name}" ${h?.photos.length} photos, total ${h?.totalPrice?.amount ?? "n/a"}, check-in ${h?.checkInTime ?? "n/a"}; raw keys: ${Object.keys((rows[0] as object) ?? {}).join(",")}`;
    },
  },
  "apify-flights": {
    needs: env.APIFY_TOKEN,
    run: async () => {
      const input = { origin: "LHR", destination: "LIS", departureDate: depart, returnDate: ret, adults: 2, currency: "EUR", maxResults: 10, resolveReturnFlights: true, resolveBookingOptions: true, maxBookingResolutions: 3 };
      const rows = await runActor(env.APIFY_TOKEN!, env.APIFY_FLIGHTS_ACTOR, input, 150);
      save("apify-google-flights.json", rows);
      const first = rows[0] as Record<string, unknown> | undefined;
      const opts = (first?.bookingOptions as unknown[]) ?? [];
      void apifyFlightOffersProvider;
      return `${rows.length} rows; bookingOptions on first: ${opts.length}; option keys: ${Object.keys((opts[0] as object) ?? {}).join(",")}`;
    },
  },
  viator: {
    needs: env.VIATOR_API_KEY,
    run: async () => {
      const r = await viatorProvider(env.VIATOR_API_KEY, env.VIATOR_API_BASE).search(
        { destination: "Lisbon", interest: "food", startDate: depart, endDate: ret, currency: "EUR", limit: 3 },
        guard,
      );
      const e = r.items[0]?.data;
      return `${r.items.length} products; first "${e?.title}" from ${e?.price?.amount ?? "n/a"}, photo ${e?.photo ? "yes" : "no"}`;
    },
  },
  google: {
    needs: env.GOOGLE_MAPS_API_KEY,
    run: async () => {
      const places = googlePlacesProvider(env.GOOGLE_MAPS_API_KEY);
      const r = await places.searchAttractions("viewpoints in Lisbon", undefined, guard, 3);
      const p = r.items[0]?.data;
      const routes = googleRoutesProvider(env.GOOGLE_MAPS_API_KEY);
      const t = p ? await routes.travelTime({ name: "Lisbon Airport", point: { lat: 38.7742, lng: -9.1342 } }, p.location, "transit", guard) : undefined;
      return `${r.items.length} places; first "${p?.name}" hours ${p?.openingHours ? "yes" : "no"}, photos ${p?.photos?.length ?? 0}; airport→place ${t?.data.durationMinutes ?? "n/a"} min`;
    },
  },
};

let failed = 0;
for (const [name, c] of Object.entries(checks)) {
  if (only.length && !only.includes(name)) continue;
  if ("needs" in c && !c.needs) {
    console.log(`– ${name}: skipped (key not set)`);
    continue;
  }
  try {
    console.log(`✔ ${name}: ${await c.run()}`);
  } catch (e) {
    failed++;
    console.log(`✘ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(failed ? 1 : 0);
