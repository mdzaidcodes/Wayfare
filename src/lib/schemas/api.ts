import { z } from "zod";
import { Money } from "./common";
import { EvidenceRecord } from "./evidence";
import { BudgetPlan, Itinerary, Selections, TripBrief } from "./trip";

// Shapes exchanged between the browser and the API. Facts always travel inside signed evidence
// records; everything else is IDs, notes and computed totals.

export const SignedEvidence = z.object({ record: EvidenceRecord, sig: z.string() });
export type SignedEvidence = z.infer<typeof SignedEvidence>;

export const StageName = z.enum(["flights", "stay", "activities"]);
export type StageName = z.infer<typeof StageName>;

export const Suggestion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("raise_budget"), by: Money }),
  z.object({ type: z.literal("shorten_trip"), nights: z.number(), saves: Money }),
  z.object({ type: z.literal("shift_dates") }),
  z.object({ type: z.literal("other_destination") }),
]);
export type Suggestion = z.infer<typeof Suggestion>;

export const StageResult = z.object({
  stage: StageName,
  /** Every record the UI needs: options, their seller offers, FX. */
  records: z.array(SignedEvidence),
  /** Ranked option IDs that fit the budget (cheapest seller), with the scout's note. */
  options: z.array(z.object({ evidenceId: z.string(), note: z.string() })),
  groups: z.array(z.object({ interest: z.string(), evidenceIds: z.array(z.string()) })).optional(),
  hidden: z.object({ overBudget: z.number(), unpriced: z.number(), failedVerification: z.number() }),
  nothingFits: z.array(Suggestion).optional(),
  problems: z.array(z.string()),
  fxEvidenceId: z.string().optional(),
  /** True on the early result sent before prices from other booking sites are in. */
  pendingOffers: z.boolean().optional(),
});
export type StageResult = z.infer<typeof StageResult>;

export const IntakeRequest = z.object({
  text: z.string().max(2000).default(""),
  form: TripBrief.partial().default({}),
  answers: z.array(z.object({ field: z.string(), answer: z.string().max(300) })).max(20).default([]),
  /** Assumption chips the user edited. */
  overrides: TripBrief.partial().default({}),
});
export type IntakeRequest = z.infer<typeof IntakeRequest>;

export const IntakeResponse = z.object({
  brief: TripBrief,
  missing: z.array(z.string()),
  question: z.object({ field: z.string(), text: z.string(), chips: z.array(z.string()) }).nullable(),
  ready: z.boolean(),
});
export type IntakeResponse = z.infer<typeof IntakeResponse>;

export const DestinationCandidate = z.object({
  name: z.string(),
  country: z.string(),
  airportCode: z.string(),
  why: z.string(),
  flightEvidenceId: z.string(),
  hotelEvidenceId: z.string(),
  /** Cheapest flight + hotel, in the user's currency, computed from evidence. */
  coreCost: Money,
});
export type DestinationCandidate = z.infer<typeof DestinationCandidate>;

export const DestinationsResult = z.object({
  candidates: z.array(DestinationCandidate),
  records: z.array(SignedEvidence),
  rejected: z.array(z.object({ name: z.string(), reason: z.string() })),
  problems: z.array(z.string()),
});
export type DestinationsResult = z.infer<typeof DestinationsResult>;

export const PlanRequest = z.object({ brief: TripBrief, reservePercent: z.number().min(0).max(80).optional() });

export const StageRequest = z.object({
  brief: TripBrief,
  budgetPlan: BudgetPlan,
  selections: Selections.default({ activityIds: [] }),
  records: z.array(SignedEvidence).max(400).default([]),
});
export type StageRequest = z.infer<typeof StageRequest>;

export const CompareRequest = z.object({
  evidence: SignedEvidence,
  destination: z.string().optional(),
});

export const ItineraryRequest = z.object({
  brief: TripBrief,
  budgetPlan: BudgetPlan,
  selections: Selections,
  records: z.array(SignedEvidence).max(400),
});

export const ItineraryResult = z.object({
  itinerary: Itinerary,
  unscheduled: z.array(z.object({ evidenceId: z.string(), title: z.string(), reason: z.string() })),
  records: z.array(SignedEvidence),
  grandTotal: Money,
  problems: z.array(z.string()),
});
export type ItineraryResult = z.infer<typeof ItineraryResult>;
