import "server-only";
import type {
  ExperienceData,
  FlightData,
  HotelData,
  HotelOffer,
  OpeningHours,
  PlaceData,
  SellerOffer,
  TravelTimeData,
} from "@/lib/schemas/evidence";
import type { Location } from "@/lib/schemas/common";
import type { PlanGuard } from "./guard";

// Adapter interfaces. MCP servers depend only on these, so a broken provider can be swapped
// without touching the servers or the agents.

export interface Normalized<T> {
  data: T;
  source: string;
  provider: string;
}

export interface ProviderResult<T> {
  items: Normalized<T>[];
  /** Items the adapter dropped, with why (e.g. "no time zone for airport XYZ"). Shown in progress. */
  dropped: { reason: string; count: number }[];
}

export interface FlightQuery {
  from: string;
  to: string;
  departDate: string;
  returnDate: string;
  adults: number;
  cabin?: "economy" | "premium_economy" | "business" | "first";
  currency: string;
}

export interface FlightSearchProvider {
  id: string;
  label: string;
  available(): boolean;
  search(q: FlightQuery, guard: PlanGuard): Promise<ProviderResult<FlightData>>;
}

export interface FlightOffersProvider {
  id: string;
  label: string;
  available(): boolean;
  /** Per-seller offers for one specific round trip, or undefined when the source can't match it. */
  offersFor(q: FlightQuery, flight: FlightData, guard: PlanGuard): Promise<SellerOffer[] | undefined>;
}

export interface HotelQuery {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  currency: string;
  maxPricePerNight?: number;
  maxResults?: number;
}

export interface HotelProvider {
  id: string;
  label: string;
  available(): boolean;
  search(q: HotelQuery, guard: PlanGuard): Promise<ProviderResult<HotelData>>;
  offers(q: HotelQuery, hotel: HotelData, guard: PlanGuard): Promise<HotelOffer[]>;
}

export interface ExperienceQuery {
  destination: string;
  interest: string;
  startDate: string;
  endDate: string;
  currency: string;
  maxPricePerPerson?: number;
  limit?: number;
}

export interface ExperienceProvider {
  id: string;
  label: string;
  available(): boolean;
  search(q: ExperienceQuery, guard: PlanGuard): Promise<ProviderResult<ExperienceData>>;
}

export interface PlacesProvider {
  id: string;
  label: string;
  available(): boolean;
  geocode(query: string, guard: PlanGuard): Promise<Normalized<PlaceData> | undefined>;
  searchAttractions(query: string, near: Location | undefined, guard: PlanGuard, limit?: number): Promise<ProviderResult<PlaceData>>;
  details(placeId: string, guard: PlanGuard): Promise<Normalized<PlaceData> | undefined>;
}

export interface RoutesProvider {
  id: string;
  label: string;
  available(): boolean;
  travelTime(
    from: Location,
    to: Location,
    mode: TravelTimeData["mode"],
    guard: PlanGuard,
    departAt?: string,
  ): Promise<Normalized<TravelTimeData> | undefined>;
}

export type { OpeningHours };
