import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Env } from "../env";
import type { EvidenceStore } from "../evidence/store";
import type { PlanGuard } from "../providers/guard";
import { ProviderError } from "../providers/http";
import { apifyFlightOffersProvider, apifyHotelsProvider } from "../providers/apify";
import { googlePlacesProvider, googleRoutesProvider } from "../providers/google";
import { kiwiProvider } from "../providers/kiwi";
import { viatorProvider } from "../providers/viator";
import type {
  ExperienceProvider,
  FlightOffersProvider,
  FlightSearchProvider,
  HotelProvider,
  PlacesProvider,
  RoutesProvider,
} from "../providers/types";

export interface Providers {
  flights: FlightSearchProvider[];
  flightOffers: FlightOffersProvider[];
  hotels: HotelProvider[];
  experiences: ExperienceProvider[];
  places: PlacesProvider;
  routes: RoutesProvider;
  frankfurterUrl: string;
}

export type ProgressFn = (message: string) => void;

export interface ServerDeps {
  evidence: EvidenceStore;
  guard: PlanGuard;
  providers: Providers;
  progress: ProgressFn;
  demo?: boolean;
}

export function providersFromEnv(env: Env): Providers {
  return {
    flights: [kiwiProvider(env.KIWI_MCP_URL)],
    flightOffers: [apifyFlightOffersProvider(env.APIFY_TOKEN, env.APIFY_FLIGHTS_ACTOR)],
    hotels: [apifyHotelsProvider(env.APIFY_TOKEN, env.APIFY_HOTELS_ACTOR)],
    experiences: [viatorProvider(env.VIATOR_API_KEY, env.VIATOR_API_BASE)],
    places: googlePlacesProvider(env.GOOGLE_MAPS_API_KEY),
    routes: googleRoutesProvider(env.GOOGLE_MAPS_API_KEY),
    frankfurterUrl: env.FRANKFURTER_URL,
  };
}

export function ok(structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
}

export function fail(message: string, extra: Record<string, unknown> = {}): CallToolResult {
  const structured = { error: message, ...extra };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
}

/** Wraps a handler so provider failures become tool errors the agent can read, never crashes. */
export function safe<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "unknown error";
      return fail(msg);
    }
  };
}
