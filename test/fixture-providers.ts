// Test-only: real adapters whose HTTP is answered from recorded fixtures.
import { vi } from "vitest";
import kiwiFixture from "./fixtures/kiwi-search-flight.json";
import fxFixture from "./fixtures/frankfurter-rates.json";
import hotelsFixture from "./fixtures/apify-google-hotels.json";
import flightsFixture from "./fixtures/apify-google-flights.json";
import viatorDest from "./fixtures/viator-destinations.json";
import viatorFree from "./fixtures/viator-freetext.json";
import placesFixture from "./fixtures/google-places-search.json";
import routesFixture from "./fixtures/google-routes.json";
import { normalizeKiwi } from "@/server/providers/kiwi";
import { apifyFlightOffersProvider, apifyHotelsProvider } from "@/server/providers/apify";
import { googlePlacesProvider, googleRoutesProvider } from "@/server/providers/google";
import { viatorProvider } from "@/server/providers/viator";
import type { Providers } from "@/server/mcp/context";

export const TEST_KEYS = { apify: "apify_SECRET", google: "g_SECRET", viator: "v_SECRET" };

export function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const body = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("frankfurter")) return body(fxFixture);
  if (url.includes("google-hotels-scraper")) return body(hotelsFixture);
  if (url.includes("google-flights-api")) return body(flightsFixture);
  if (url.endsWith("/destinations")) return body(viatorDest);
  if (url.includes("/search/freetext")) return body(viatorFree);
  if (url.includes("places:searchText")) return body(placesFixture);
  if (url.includes("computeRoutes")) return body(routesFixture);
  return new Response(`unexpected ${url} ${init?.method ?? "GET"}`, { status: 500 });
}

export function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
}

export function fixtureProviders(keys: Partial<typeof TEST_KEYS> = TEST_KEYS): Providers {
  return {
    flights: [{ id: "kiwi", label: "Kiwi.com", available: () => true, search: async (q) => normalizeKiwi(kiwiFixture, q.adults) }],
    flightOffers: [apifyFlightOffersProvider(keys.apify, "lergassy/google-flights-api")],
    hotels: [apifyHotelsProvider(keys.apify, "benthepythondev/google-hotels-scraper")],
    experiences: [viatorProvider(keys.viator, "https://api.viator.com/partner")],
    places: googlePlacesProvider(keys.google),
    routes: googleRoutesProvider(keys.google),
    frankfurterUrl: "https://api.frankfurter.dev/v2",
  };
}
