import { z } from "zod";
import { CurrencyCode, IanaTimeZone, IsoDate, IsoWithOffset, Location, Money } from "./common";

export const TripStatus = z.enum(["planning", "ready", "in_progress"]);
export type TripStatus = z.infer<typeof TripStatus>;

/** An assumption the Intake agent made, shown to the user as an editable chip. */
export const Assumption = z.object({
  field: z.string(),
  label: z.string(),
  value: z.string(),
});
export type Assumption = z.infer<typeof Assumption>;

export const TravelDates = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), departDate: IsoDate, returnDate: IsoDate }),
  z.object({
    type: z.literal("flexible"),
    /** Inclusive window the trip must fit in, e.g. all of March. */
    windowStart: IsoDate,
    windowEnd: IsoDate,
    description: z.string(),
  }),
]);
export type TravelDates = z.infer<typeof TravelDates>;

export const TripBrief = z.object({
  rawRequest: z.string(),
  destination: z
    .object({ name: z.string(), country: z.string().optional(), airportCodes: z.array(z.string()).optional() })
    .optional(),
  origin: z.object({ name: z.string(), airportCodes: z.array(z.string()).optional() }).optional(),
  nights: z.number().int().positive().max(60).optional(),
  dates: TravelDates.optional(),
  travelers: z.number().int().positive().max(9).optional(),
  rooms: z.number().int().positive().max(9).optional(),
  budget: Money.optional(),
  interests: z.array(z.string()),
  vibe: z.string().optional(),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
  assumptions: z.array(Assumption),
});
export type TripBrief = z.infer<typeof TripBrief>;

/** A brief with everything required for search filled in. */
export const CompleteBrief = TripBrief.extend({
  destination: TripBrief.shape.destination.unwrap(),
  origin: TripBrief.shape.origin.unwrap(),
  nights: z.number().int().positive().max(60),
  dates: z.object({ type: z.literal("fixed"), departDate: IsoDate, returnDate: IsoDate }),
  travelers: z.number().int().positive().max(9),
  rooms: z.number().int().positive().max(9),
  budget: Money,
});
export type CompleteBrief = z.infer<typeof CompleteBrief>;

export const BudgetCategory = z.enum(["flights", "stay", "activities"]);
export type BudgetCategory = z.infer<typeof BudgetCategory>;

export const BudgetPlan = z.object({
  total: Money,
  limits: z.object({ flights: Money, stay: Money, activities: Money }),
  /** Estimate for food, taxis, local transport. Never a booking. */
  reserve: Money,
  reservePercent: z.number().min(0).max(80),
  reasons: z.object({
    flights: z.string(),
    stay: z.string(),
    activities: z.string(),
    reserve: z.string(),
  }),
});
export type BudgetPlan = z.infer<typeof BudgetPlan>;

export const Selections = z.object({
  flightId: z.string().optional(),
  /** Seller name chosen in Compare prices; undefined = cheapest. */
  flightSeller: z.string().optional(),
  hotelId: z.string().optional(),
  hotelSeller: z.string().optional(),
  activityIds: z.array(z.string()),
});
export type Selections = z.infer<typeof Selections>;

export const ItineraryItemType = z.enum([
  "leave_for_airport",
  "airport_arrival",
  "flight",
  "arrival_buffer",
  "transfer",
  "bag_drop",
  "checkin",
  "activity",
  "travel",
  "meal",
  "checkout",
  "bag_storage",
  "free_time",
]);
export type ItineraryItemType = z.infer<typeof ItineraryItemType>;

export const ItineraryItem = z.object({
  id: z.string(),
  /** Local calendar date of the item, in its own time zone. */
  day: IsoDate,
  start: IsoWithOffset,
  end: IsoWithOffset,
  timeZone: IanaTimeZone,
  type: ItineraryItemType,
  title: z.string(),
  details: z.string().optional(),
  location: Location.optional(),
  evidenceId: z.string().optional(),
  /** Notes such as "Early check-in isn't guaranteed". */
  notes: z.array(z.string()).optional(),
  /** Duration came from a routing service evidence record. */
  travelTimeEvidenceId: z.string().optional(),
  done: z.boolean(),
});
export type ItineraryItem = z.infer<typeof ItineraryItem>;

export const Itinerary = z.object({
  days: z.array(IsoDate),
  items: z.array(ItineraryItem),
  generatedAt: IsoWithOffset,
});
export type Itinerary = z.infer<typeof Itinerary>;

export const ChecklistItem = z.object({
  type: z.enum(["flight", "hotel", "activity"]),
  evidenceId: z.string(),
  title: z.string(),
  seller: z.string(),
  link: z.string(),
  linkLabel: z.string(),
  booked: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const Settings = z.object({
  currency: CurrencyCode,
  reservePercent: z.number().min(0).max(80),
  airportBufferInternationalMin: z.number().int().nonnegative(),
  airportBufferDomesticMin: z.number().int().nonnegative(),
  arrivalBufferInternationalMin: z.number().int().nonnegative(),
  arrivalBufferDomesticMin: z.number().int().nonnegative(),
});
export type Settings = z.infer<typeof Settings>;

export { Location };
