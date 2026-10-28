import { z } from "zod";
import {
  CurrencyCode,
  HttpUrl,
  IanaTimeZone,
  IsoDate,
  IsoWithOffset,
  LocalTime,
  Location,
  Money,
  Photo,
} from "./common";

// Every optional field here means "absent when the source doesn't provide it".
// Adapters must never fill these from guesses or model output.

export const SellerOffer = z.object({
  seller: z.string().min(1),
  totalPrice: Money,
  fareName: z.string().optional(),
  bookingUrl: HttpUrl.optional(),
  fetchedAt: IsoWithOffset,
});
export type SellerOffer = z.infer<typeof SellerOffer>;

export const Airport = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  timeZone: IanaTimeZone.optional(),
});
export type Airport = z.infer<typeof Airport>;

export const FlightSegment = z.object({
  airline: z.string().min(1),
  airlineCode: z.string().optional(),
  flightNumber: z.string().optional(),
  from: Airport,
  to: Airport,
  departLocal: IsoWithOffset,
  arriveLocal: IsoWithOffset,
});
export type FlightSegment = z.infer<typeof FlightSegment>;

export const FlightLeg = z.object({
  segments: z.array(FlightSegment).min(1),
  durationMinutes: z.number().int().positive(),
  stops: z.number().int().nonnegative(),
  layovers: z.array(z.object({ airport: Airport, minutes: z.number().int().nonnegative() })),
});
export type FlightLeg = z.infer<typeof FlightLeg>;

export const FlightData = z.object({
  outbound: FlightLeg,
  inbound: FlightLeg,
  travelers: z.number().int().positive(),
  /** Total for all travelers, round trip. */
  totalPrice: Money,
  pricePerPerson: Money.optional(),
  cabin: z.string().optional(),
  international: z.boolean().optional(),
  /** Exact-itinerary deep link, when the source gives one. */
  bookingUrl: HttpUrl.optional(),
  bookingSeller: z.string().optional(),
  sellerOffers: z.array(SellerOffer).optional(),
});
export type FlightData = z.infer<typeof FlightData>;

export const HotelOffer = z.object({
  seller: z.string().min(1),
  pricePerNight: Money.optional(),
  totalPrice: Money,
  taxesIncluded: z.boolean().optional(),
  freeCancellation: z.boolean().optional(),
  bookingUrl: HttpUrl.optional(),
  fetchedAt: IsoWithOffset,
});
export type HotelOffer = z.infer<typeof HotelOffer>;

export const HotelData = z.object({
  name: z.string().min(1),
  photos: z.array(Photo),
  pricePerNight: Money.optional(),
  /** Total for the stay (all rooms, all nights). */
  totalPrice: Money.optional(),
  taxesIncluded: z.boolean().optional(),
  checkInTime: LocalTime.optional(),
  checkOutTime: LocalTime.optional(),
  rating: z.number().min(0).max(10).optional(),
  ratingScale: z.number().positive().optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  starClass: z.number().min(0).max(7).optional(),
  location: Location,
  amenities: z.array(z.string()).optional(),
  freeCancellation: z.boolean().optional(),
  bookingUrl: HttpUrl.optional(),
  /** Untrusted provider text. Rendered as plain text, never given to the model as instructions. */
  description: z.string().optional(),
  checkIn: IsoDate,
  checkOut: IsoDate,
  adults: z.number().int().positive(),
  rooms: z.number().int().positive(),
  offers: z.array(HotelOffer).optional(),
});
export type HotelData = z.infer<typeof HotelData>;

export const WeeklyPeriod = z.object({
  /** 0 = Sunday … 6 = Saturday, in the place's local time. */
  day: z.number().int().min(0).max(6),
  open: LocalTime,
  /** May be <= open, meaning it closes after midnight. "24:00" isn't used; 00:00 means midnight. */
  close: LocalTime,
});
export type WeeklyPeriod = z.infer<typeof WeeklyPeriod>;

export const OpeningHours = z.object({
  timeZone: IanaTimeZone,
  periods: z.array(WeeklyPeriod),
  alwaysOpen: z.boolean().optional(),
});
export type OpeningHours = z.infer<typeof OpeningHours>;

export const TimeSlot = z.object({ start: IsoWithOffset, end: IsoWithOffset.optional() });
export type TimeSlot = z.infer<typeof TimeSlot>;

export const ExperienceData = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  photo: Photo.optional(),
  /** Absent = not provided. Free = amount 0 with isFree true. */
  price: Money.optional(),
  isFree: z.boolean().optional(),
  priceIsPerPerson: z.boolean().optional(),
  durationMinutes: z.number().int().positive().optional(),
  openingHours: OpeningHours.optional(),
  timeSlots: z.array(TimeSlot).optional(),
  location: Location,
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  interest: z.string().optional(),
  bookingUrl: HttpUrl.optional(),
  /** Sold as a ticket or tour (e.g. Viator), even if this record has no link. */
  bookable: z.boolean().optional(),
  productCode: z.string().optional(),
});
export type ExperienceData = z.infer<typeof ExperienceData>;

export const FxData = z.object({
  base: CurrencyCode,
  date: IsoDate,
  rates: z.record(CurrencyCode, z.number().positive()),
  /** "Frankfurter (ECB)" or "user" when the user entered their own rate. */
  origin: z.string(),
});
export type FxData = z.infer<typeof FxData>;

export const TravelTimeData = z.object({
  from: Location,
  to: Location,
  mode: z.enum(["drive", "transit", "walk"]),
  durationMinutes: z.number().int().nonnegative(),
  distanceMeters: z.number().nonnegative().optional(),
});
export type TravelTimeData = z.infer<typeof TravelTimeData>;

export const PlaceData = z.object({
  name: z.string(),
  location: Location,
  types: z.array(z.string()).optional(),
  rating: z.number().optional(),
  reviewCount: z.number().int().optional(),
  openingHours: OpeningHours.optional(),
  photos: z.array(Photo).optional(),
  websiteUrl: HttpUrl.optional(),
  mapsUrl: HttpUrl.optional(),
  /** Lower end of Google's per-person price range, when Google has one. */
  priceFrom: Money.optional(),
});
export type PlaceData = z.infer<typeof PlaceData>;

export const EvidenceKind = z.enum([
  "flight",
  "hotel",
  "hotel_offers",
  "flight_offers",
  "experience",
  "place",
  "airport",
  "fx",
  "travel_time",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

const base = {
  id: z.string().regex(/^ev_[A-Za-z0-9_-]{6,}$/),
  /** Human label shown in the badge, e.g. "Google Hotels". */
  source: z.string().min(1),
  /** Adapter id, e.g. "apify-google-hotels". */
  provider: z.string().min(1),
  fetchedAt: IsoWithOffset,
  demo: z.boolean().optional(),
};

export const EvidenceRecord = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("flight"), data: FlightData }),
  z.object({ ...base, kind: z.literal("hotel"), data: HotelData }),
  z.object({
    ...base,
    kind: z.literal("hotel_offers"),
    data: z.object({ hotelEvidenceId: z.string(), offers: z.array(HotelOffer) }),
  }),
  z.object({
    ...base,
    kind: z.literal("flight_offers"),
    data: z.object({ flightEvidenceId: z.string(), offers: z.array(SellerOffer) }),
  }),
  z.object({ ...base, kind: z.literal("experience"), data: ExperienceData }),
  z.object({ ...base, kind: z.literal("place"), data: PlaceData }),
  z.object({ ...base, kind: z.literal("airport"), data: Airport }),
  z.object({ ...base, kind: z.literal("fx"), data: FxData }),
  z.object({ ...base, kind: z.literal("travel_time"), data: TravelTimeData }),
]);
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;
export type EvidenceOf<K extends EvidenceKind> = Extract<EvidenceRecord, { kind: K }>;
