import "server-only";
import { z } from "zod";
import type { TripBrief } from "@/lib/schemas/trip";
import { addDays, daysBetween } from "@/lib/time";
import type { AgentSpec } from "../runner";

// Agent output schemas use .nullable() instead of .optional(): structured outputs require every key.

const DatesOut = z.object({
  type: z.enum(["fixed", "flexible", "unknown"]),
  departDate: z.string().nullable(),
  returnDate: z.string().nullable(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  description: z.string().nullable(),
});

export const IntakeOutput = z.object({
  destination: z.object({ name: z.string(), country: z.string().nullable(), airportCodes: z.array(z.string()) }).nullable(),
  origin: z.object({ name: z.string(), airportCodes: z.array(z.string()) }).nullable(),
  nights: z.number().int().positive().nullable(),
  dates: DatesOut,
  travelers: z.number().int().positive().nullable(),
  rooms: z.number().int().positive().nullable(),
  budget: z.object({ amount: z.number().positive(), currency: z.string() }).nullable(),
  interests: z.array(z.string()),
  vibe: z.string().nullable(),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]).nullable(),
  assumptions: z.array(z.object({ field: z.string(), label: z.string(), value: z.string() })),
  question: z
    .object({ field: z.string(), text: z.string(), chips: z.array(z.string()).max(5) })
    .nullable(),
});
export type IntakeOutput = z.infer<typeof IntakeOutput>;

export const intakeAgent = (today: string): AgentSpec<typeof IntakeOutput> => ({
  name: "intake",
  label: "Intake",
  instructions: `You turn a traveler's request into a structured trip brief. Today is ${today}.

Read the free text, the form fields and earlier answers. Fill only what the traveler said or clearly implied. Leave anything else null; never invent a destination, budget, dates or origin.
- If an answer is "You decide", choose a sensible value and record it in assumptions (field, short label, value).
- Dates: "fixed" when exact days are known; "flexible" for a window such as "sometime in March" (give windowStart/windowEnd and a short description); otherwise "unknown". Use YYYY-MM-DD and future dates only.
- Budget is the total for the whole trip in the stated currency (ISO code).
- Use lookup_airport only to resolve airport codes for origin or destination.
- question: set it only for the field named in "Ask about" below, as one short friendly question with up to 4 quick-reply chips. Otherwise null.
Answer with the structured output only. Do not ask anything outside the question field.`,
  output: IntakeOutput,
  tools: { reference: ["lookup_airport"] },
  maxTurns: 6,
  timeoutMs: 60_000,
});

export type MissingField = "origin" | "destination" | "dates" | "nights" | "travelers" | "budget";

/** What still has to be asked, in order. Decided in code so only necessary questions are asked. */
export function missingFields(b: TripBrief): MissingField[] {
  const out: MissingField[] = [];
  if (!b.origin) out.push("origin");
  // No destination is fine when the traveler described what they want; the Scout suggests places.
  if (!b.destination && !b.vibe && b.interests.length === 0) out.push("destination");
  if (!b.dates) out.push("dates");
  if (!b.nights && b.dates?.type !== "fixed") out.push("nights");
  if (!b.travelers) out.push("travelers");
  if (!b.budget) out.push("budget");
  return out;
}

export const FALLBACK_QUESTIONS: Record<MissingField, { text: string; chips: string[] }> = {
  origin: { text: "Where will you be flying from?", chips: [] },
  destination: { text: "Where would you like to go, or what kind of trip are you after?", chips: ["Beach", "City break", "Nature"] },
  dates: { text: "When do you want to travel?", chips: ["Next month", "In 3 months", "Flexible"] },
  nights: { text: "How many nights?", chips: ["3", "5", "7", "10"] },
  travelers: { text: "How many people are travelling?", chips: ["1", "2", "3", "4"] },
  budget: { text: "What's your total budget, including flights and hotel?", chips: [] },
};

export const YOU_DECIDE = "You decide";

/** Converts the agent's nullable output to the app's brief, merging the form (form values win). */
export function toBrief(out: IntakeOutput, rawRequest: string, form: Partial<TripBrief> = {}): TripBrief {
  let dates: TripBrief["dates"];
  const d = out.dates;
  if (d.type === "fixed" && d.departDate && d.returnDate && d.returnDate > d.departDate) {
    dates = { type: "fixed", departDate: d.departDate, returnDate: d.returnDate };
  } else if (d.type === "flexible" && d.windowStart && d.windowEnd) {
    dates = { type: "flexible", windowStart: d.windowStart, windowEnd: d.windowEnd, description: d.description ?? "Flexible" };
  }
  const brief: TripBrief = {
    rawRequest,
    destination: out.destination
      ? { name: out.destination.name, country: out.destination.country ?? undefined, airportCodes: out.destination.airportCodes }
      : undefined,
    origin: out.origin ? { name: out.origin.name, airportCodes: out.origin.airportCodes } : undefined,
    nights: out.nights ?? undefined,
    dates,
    travelers: out.travelers ?? undefined,
    rooms: out.rooms ?? undefined,
    budget: out.budget ? { amount: out.budget.amount, currency: out.budget.currency.toUpperCase() } : undefined,
    interests: out.interests,
    vibe: out.vibe ?? undefined,
    cabin: out.cabin ?? undefined,
    assumptions: out.assumptions,
  };
  for (const [k, v] of Object.entries(form)) {
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) (brief as Record<string, unknown>)[k] = v;
  }
  if (brief.dates?.type === "fixed") brief.nights = daysBetween(brief.dates.departDate, brief.dates.returnDate);
  return brief;
}

/** Resolves a flexible window to concrete dates (start of window), recorded as an editable assumption. */
export function resolveDates(b: TripBrief): TripBrief {
  if (b.dates?.type !== "flexible" || !b.nights) return b;
  const depart = b.dates.windowStart;
  const ret = addDays(depart, b.nights);
  if (ret > addDays(b.dates.windowEnd, 1)) return b;
  return {
    ...b,
    dates: { type: "fixed", departDate: depart, returnDate: ret },
    assumptions: [
      ...b.assumptions.filter((a) => a.field !== "dates"),
      { field: "dates", label: "Dates", value: `${depart} → ${ret} (within ${b.dates.description})` },
    ],
  };
}
