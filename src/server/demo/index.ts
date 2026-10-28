import "server-only";
// ALLOW_DEMO_DATA=true mode, for trying the app without keys. Recorded fixtures go through the real
// normalizers, MCP servers, agents runner, budget engine and scheduler; only the provider HTTP and
// the model are replaced. Every record is marked demo, and the UI shows a DEMO DATA banner.
import kiwiFixture from "../../../test/fixtures/kiwi-search-flight.json";
import fxFixture from "../../../test/fixtures/frankfurter-rates.json";
import hotelsFixture from "../../../test/fixtures/apify-google-hotels.json";
import flightsFixture from "../../../test/fixtures/apify-google-flights.json";
import viatorDest from "../../../test/fixtures/viator-destinations.json";
import viatorFree from "../../../test/fixtures/viator-freetext.json";
import placesFixture from "../../../test/fixtures/google-places-search.json";
import routesFixture from "../../../test/fixtures/google-routes.json";
import { normalizeKiwi } from "../providers/kiwi";
import { normalizeFlightOffers, normalizeHotels } from "../providers/apify";
import { normalizeFrankfurter } from "../providers/frankfurter";
import { normalizePlace, normalizeRoute } from "../providers/google";
import { normalizeViatorProducts } from "../providers/viator";
import { toIsoWithOffset } from "@/lib/time";
import type { Providers } from "../mcp/context";
import type { PlaceData } from "@/lib/schemas/evidence";
import { FakeModel, type Script } from "./scripted-model";

const now = () => toIsoWithOffset(new Date(), "UTC");
const label = <T extends { source: string }>(x: T) => ({ ...x, source: x.source });

export const DEMO_TRIP = { from: "LHR", to: "LIS", departDate: "2026-12-10", returnDate: "2026-12-14", travelers: 2 };

export function demoProviders(): Providers {
  return {
    flights: [{ id: "kiwi", label: "Kiwi.com (demo)", available: () => true, search: async (q) => normalizeKiwi(kiwiFixture, q.adults) }],
    flightOffers: [
      {
        id: "apify-google-flights",
        label: "Google Flights sellers (demo)",
        available: () => true,
        offersFor: async (q, f) => normalizeFlightOffers(flightsFixture, f, q.currency, now()),
      },
    ],
    hotels: [
      {
        id: "apify-google-hotels",
        label: "Google Hotels (demo)",
        available: () => true,
        search: async (q) => normalizeHotels(hotelsFixture, q, now()),
        offers: async (q, h) => normalizeHotels(hotelsFixture, q, now()).items.find((x) => x.data.name === h.name)?.data.offers ?? [],
      },
    ],
    experiences: [
      {
        id: "viator",
        label: "Viator (demo)",
        available: () => true,
        search: async (q) => normalizeViatorProducts(viatorFree.products.results, viatorDest.destinations[0], q),
      },
    ],
    places: {
      id: "google-places",
      label: "Google Places (demo)",
      available: () => true,
      geocode: async () => ({ data: { name: "Lisbon", location: { name: "Lisbon", point: { lat: 38.7223, lng: -9.1393 }, timeZone: "Europe/Lisbon" } }, source: "Google Places", provider: "google-places" }),
      searchAttractions: async () => ({
        items: placesFixture.places.map(normalizePlace).filter((p): p is PlaceData => Boolean(p)).map((data) => label({ data, source: "Google Places", provider: "google-places" })),
        dropped: [],
      }),
      details: async () => undefined,
    },
    routes: {
      id: "google-routes",
      label: "Google Routes (demo)",
      available: () => true,
      travelTime: async (from, to, mode) => normalizeRoute(routesFixture, from, to, mode),
    },
    frankfurterUrl: "demo",
  };
}

export const demoFx = () => normalizeFrankfurter(fxFixture, "EUR");

const ids = (r: Record<string, unknown> | undefined, key: string) => ((r?.[key] as { evidenceId: string }[]) ?? []).map((x) => x.evidenceId);

const blankIntake = {
  destination: null,
  origin: null,
  nights: null,
  dates: { type: "unknown", departDate: null, returnDate: null, windowStart: null, windowEnd: null, description: null },
  travelers: null,
  rooms: null,
  budget: null,
  interests: [] as string[],
  vibe: null,
  cabin: null,
  assumptions: [] as { field: string; label: string; value: string }[],
  question: null,
};

const intakeScript: Script = (_r, input) => {
  const named = /lisbon/i.test(input);
  const answered = /Earlier answers:\n-/.test(input);
  if (!named && !answered) {
    return { final: { ...blankIntake, nights: 4, vibe: input.match(/Request: "([^"]*)"/)?.[1] ?? "somewhere warm", interests: ["food", "history"], question: { field: "origin", text: "Where are you flying from?", chips: ["London", "Manchester"] } } };
  }
  return {
    final: {
      ...blankIntake,
      destination: named ? { name: "Lisbon", country: "Portugal", airportCodes: ["LIS"] } : null,
      origin: { name: "London", airportCodes: ["LHR"] },
      dates: { type: "fixed", departDate: DEMO_TRIP.departDate, returnDate: DEMO_TRIP.returnDate, windowStart: null, windowEnd: null, description: null },
      travelers: 2,
      budget: { amount: 3000, currency: "EUR" },
      interests: ["food", "history"],
      vibe: named ? null : "warm, good food",
      assumptions: answered
        ? [
            { field: "dates", label: "Dates", value: `${DEMO_TRIP.departDate} → ${DEMO_TRIP.returnDate}` },
            { field: "budget", label: "Budget", value: "3000 EUR" },
          ]
        : [],
    },
  };
};

export function demoModel(): FakeModel {
  return new FakeModel([
    { agent: "intake", match: /structured trip brief/, script: intakeScript },
    {
      agent: "destination",
      match: /suggest up to 3 destinations/,
      script: (r) =>
        r.length < 2
          ? {
              call: [
                { name: "search_flights", args: { from: "LHR", to: "LIS", departDate: DEMO_TRIP.departDate, returnDate: DEMO_TRIP.returnDate, adults: 2, currency: "EUR" } },
                { name: "search_hotels", args: { destination: "Lisbon", checkIn: DEMO_TRIP.departDate, checkOut: DEMO_TRIP.returnDate, adults: 2, rooms: 1, currency: "EUR" } },
              ],
            }
          : { final: { candidates: [{ name: "Lisbon", country: "Portugal", airportCode: "LIS", why: "Mild winter sun, great food and walkable old quarters.", flightEvidenceId: ids(r[0], "flights")[0], hotelEvidenceId: ids(r[1], "hotels").at(-1) }] } },
    },
    {
      agent: "budget",
      match: /split a trip's total budget/,
      script: () => ({ final: { weights: { flights: 30, stay: 50, activities: 20 }, reservePercent: 20, reasons: { flights: "Short-haul return fares are modest.", stay: "Central hotels take the biggest share.", activities: "A few paid tours plus free sights.", reserve: "Food, trams and taxis in Lisbon." } } }),
    },
    {
      agent: "flight",
      match: /round-trip flights for a trip/,
      script: (r) =>
        !r.length
          ? { call: [{ name: "search_flights", args: { from: "LHR", to: "LIS", departDate: DEMO_TRIP.departDate, returnDate: DEMO_TRIP.returnDate, adults: 2, currency: "EUR" } }] }
          : { final: { ranked: ids(r[0], "flights").map((evidenceId) => ({ evidenceId, note: "direct, sensible times" })) } },
    },
    {
      agent: "stay",
      match: /hotels for a stay/,
      script: (r) =>
        !r.length
          ? { call: [{ name: "search_hotels", args: { destination: "Lisbon", checkIn: DEMO_TRIP.departDate, checkOut: DEMO_TRIP.returnDate, adults: 2, rooms: 1, currency: "EUR" } }] }
          : { final: { ranked: ids(r[0], "hotels").map((evidenceId) => ({ evidenceId, note: "central, well reviewed" })) } },
    },
    {
      agent: "experience",
      match: /things to do for each/,
      script: (r) =>
        !r.length
          ? {
              call: [
                { name: "search_experiences", args: { destination: "Lisbon", interest: "food", startDate: DEMO_TRIP.departDate, endDate: DEMO_TRIP.returnDate, currency: "EUR" } },
                { name: "search_attractions", args: { query: "historic sights in Lisbon", interest: "history" } },
                { name: "search_attractions", args: { query: "top attractions in Lisbon", interest: "must-see" } },
              ],
            }
          : {
              final: {
                // The highlights search returns some of the same places as the history search, as real searches do.
                groups: [
                  { interest: "Don't miss", items: ids(r[2], "attractions").slice(0, 1).map((evidenceId) => ({ evidenceId, note: "a classic first visit" })) },
                  { interest: "food", items: ids(r[0], "experiences").map((evidenceId) => ({ evidenceId, note: "local favourite" })) },
                  { interest: "history", items: ids(r[1], "attractions").map((evidenceId) => ({ evidenceId, note: "iconic sight" })) },
                ],
              },
            },
    },
    { agent: "verifier", match: /check a stage's options/, script: () => ({ final: { problems: [] } }) },
    { agent: "planner", match: /which day each chosen activity/, script: () => ({ final: { order: [] } }) },
  ]);
}
