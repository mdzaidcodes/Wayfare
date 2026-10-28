import "server-only";
import { z } from "zod";
import type { AgentSpec } from "../runner";
import type { PlanContext } from "../context";
import type { EvidenceKind } from "@/lib/schemas/evidence";

// Scouts return evidence IDs plus short commentary. They never state prices, times, ratings, URLs
// or photos as text; the UI renders those from evidence records.

const NO_FACTS =
  "Write notes as short plain reasons (e.g. \"direct, good arrival time\"). Never write prices, times, ratings, links or numbers from the data in notes.";

function idsExist(ids: string[], kind: EvidenceKind, ctx: PlanContext): string[] {
  return ids.filter((id) => !ctx.evidence.getOf(id, kind)).map((id) => `${id} is not an evidence ID returned by your tools`);
}

export const Ranked = z.object({ evidenceId: z.string(), note: z.string().max(160) });

// ---------- Destination Scout ----------
export const DestinationOutput = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string(),
        country: z.string(),
        airportCode: z.string(),
        why: z.string().max(200),
        flightEvidenceId: z.string(),
        hotelEvidenceId: z.string(),
      }),
    )
    .max(3),
});
export const destinationScout: AgentSpec<typeof DestinationOutput> = {
  name: "destination-scout",
  label: "Destination Scout",
  instructions: `You suggest up to 3 destinations for a traveler who didn't name one, and check each against real prices.
For each idea: find its main airport with lookup_airport, run search_flights for the trip dates and travelers, then search_hotels with a nightly cap that fits the budget.
Keep a destination only if a flight and a hotel together leave room for activities and daily spending. For each kept destination, return the evidence ID of its cheapest suitable flight and hotel.
Prefer places that match what the traveler described. ${NO_FACTS}
Answer with the structured output only.`,
  output: DestinationOutput,
  tools: { reference: ["lookup_airport"], flights: ["search_flights"], stays: ["search_hotels"] },
  maxTurns: 24,
  timeoutMs: 240_000,
  validate: (o, ctx) => [
    ...idsExist(o.candidates.map((c) => c.flightEvidenceId), "flight", ctx),
    ...idsExist(o.candidates.map((c) => c.hotelEvidenceId), "hotel", ctx),
  ],
};

// ---------- Budget Planner ----------
export const BudgetOutput = z.object({
  weights: z.object({ flights: z.number().min(0), stay: z.number().min(0), activities: z.number().min(0) }),
  reservePercent: z.number().min(5).max(40),
  reasons: z.object({ flights: z.string().max(200), stay: z.string().max(200), activities: z.string().max(200), reserve: z.string().max(200) }),
});
export const budgetPlanner: AgentSpec<typeof BudgetOutput> = {
  name: "budget-planner",
  label: "Budget Planner",
  instructions: `You propose how to split a trip's total budget across flights, stay and activities, plus a spending reserve for food, taxis and local transport.
Give relative weights (any positive numbers; code scales them to the total) and a reserve percent (default 20 unless the trip clearly needs more or less).
Base the split on the destination, trip length, travelers and interests. If the user's currency differs from what's typical there, you may use convert_currency to sanity-check costs.
Each reason is one short sentence. Answer with the structured output only.`,
  output: BudgetOutput,
  tools: { reference: ["convert_currency"] },
  maxTurns: 4,
  timeoutMs: 60_000,
  validate: (o) => (o.weights.flights + o.weights.stay + o.weights.activities > 0 ? [] : ["weights must not all be zero"]),
};

// ---------- Flight Scout ----------
export const FlightScoutOutput = z.object({ ranked: z.array(Ranked).max(12) });
export const flightScout: AgentSpec<typeof FlightScoutOutput> = {
  name: "flight-scout",
  label: "Flight Scout",
  instructions: `You find round-trip flights for a trip and rank them.
Call search_flights once with the trip's route, dates, travelers and currency (try a nearby alternative airport only if the first search returns nothing).
Return up to 10 evidence IDs from the results, best first. Prefer options under the flight limit; weigh price, total duration, stops, layover length and sensible departure and arrival times. ${NO_FACTS}
Answer with the structured output only.`,
  output: FlightScoutOutput,
  tools: { flights: ["search_flights"], reference: ["lookup_airport"] },
  maxTurns: 6,
  timeoutMs: 150_000,
  validate: (o, ctx) => idsExist(o.ranked.map((r) => r.evidenceId), "flight", ctx),
};

// ---------- Stay Scout ----------
export const StayScoutOutput = z.object({ ranked: z.array(Ranked).max(12) });
export const stayScout: AgentSpec<typeof StayScoutOutput> = {
  name: "stay-scout",
  label: "Stay Scout",
  instructions: `You find hotels for a stay and rank them by fit.
Call search_hotels once with the destination, dates, guests, rooms, currency and a nightly cap derived from the stay limit.
Return up to 10 evidence IDs, best first. Weigh total price against the limit, rating and review count, star class, location data and the traveler's interests. ${NO_FACTS}
Answer with the structured output only.`,
  output: StayScoutOutput,
  tools: { stays: ["search_hotels"] },
  maxTurns: 5,
  timeoutMs: 200_000,
  validate: (o, ctx) => idsExist(o.ranked.map((r) => r.evidenceId), "hotel", ctx),
};

// ---------- Experience Scout ----------
export const ExperienceScoutOutput = z.object({
  groups: z.array(z.object({ interest: z.string(), items: z.array(Ranked).max(8) })).max(10),
});
export const experienceScout: AgentSpec<typeof ExperienceScoutOutput> = {
  name: "experience-scout",
  label: "Experience Scout",
  instructions: `You find things to do for each of the traveler's interests at the destination, during the trip dates.
For each interest, call search_experiences (bookable tours) and search_attractions (sights, with opening hours). Use geocode once for the destination center if you need a location for search_attractions.
Whatever the interests, also:
- Find the destination's signature sights and experiences, the ones most first-time visitors put at the top of their list (search_attractions for "top attractions in <destination>", plus search_experiences for the best-known tickets or tours). Return them as the first group, named "Don't miss".
- Look for theme parks, amusement parks and water parks in or near the destination (search_attractions for "theme parks near <destination>" and search_experiences with interest "theme park tickets"). If any exist, return them as a group named "Theme parks"; if none do, leave the group out.
Return several options per group so the traveler can mix, best first, using evidence IDs from the results. List each option in one group only. Prefer well-reviewed options with known durations and hours, and include free sights. ${NO_FACTS}
Answer with the structured output only.`,
  output: ExperienceScoutOutput,
  tools: { experiences: ["search_experiences", "search_attractions", "get_place_details"], reference: ["geocode"] },
  maxTurns: 16,
  timeoutMs: 180_000,
  validate: (o, ctx) => idsExist(o.groups.flatMap((g) => g.items.map((i) => i.evidenceId)), "experience", ctx),
};

// ---------- Verifier ----------
export const VerifierOutput = z.object({
  problems: z.array(z.object({ evidenceId: z.string(), issue: z.string().max(200) })),
});
export const verifierAgent: AgentSpec<typeof VerifierOutput> = {
  name: "verifier",
  label: "Verifier",
  instructions: `You check a stage's options before a traveler sees them. You get each option's evidence record (the source data) and the scout's note.
Report a problem when a note states or implies a fact the evidence doesn't support (a price, time, rating, amenity, distance or claim), when an option doesn't match the trip (wrong dates, route, city or traveler count), or when a field the card needs is missing in a way the note hides.
Return an empty list when everything checks out. Answer with the structured output only.`,
  output: VerifierOutput,
  tools: {},
  maxTurns: 2,
  timeoutMs: 60_000,
};

// ---------- Itinerary Planner ----------
export const ItineraryPlanOutput = z.object({
  order: z.array(z.object({ evidenceId: z.string(), preferredDay: z.string().nullable() })),
});
export const itineraryPlanner: AgentSpec<typeof ItineraryPlanOutput> = {
  name: "itinerary-planner",
  label: "Itinerary Planner",
  instructions: `You plan which day each chosen activity happens on, for a trip with fixed flights and hotel.
Use each activity's opening hours, time slots, duration and area. Group nearby places on the same day (travel_time can help) and keep arrival and departure days light.
Return every activity's evidence ID once, in the order you'd do them, with preferredDay (YYYY-MM-DD within the trip) or null if any day works. Code builds the exact timetable and checks hours, so don't write times.
Answer with the structured output only.`,
  output: ItineraryPlanOutput,
  tools: { reference: ["travel_time"] },
  maxTurns: 8,
  timeoutMs: 120_000,
  validate: (o, ctx) => idsExist(o.order.map((x) => x.evidenceId), "experience", ctx),
};
