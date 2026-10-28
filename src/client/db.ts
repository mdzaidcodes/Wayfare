"use client";
import Dexie, { type EntityTable } from "dexie";
import type { DestinationsResult, IntakeResponse, ItineraryResult, SignedEvidence, StageName, StageResult } from "@/lib/schemas/api";
import type { BudgetPlan, ChecklistItem, Selections, Settings, TripBrief, TripStatus } from "@/lib/schemas/trip";

// Everything lives in the user's browser (IndexedDB). No accounts, no server database.

export type StageKey = "basics" | "flights" | "stay" | "activities" | "itinerary";

export interface TripRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: TripStatus;
  stage: StageKey;
  brief?: TripBrief;
  budgetPlan?: BudgetPlan;
  /** Intake conversation so far. */
  intake: {
    text: string;
    form: Partial<TripBrief>;
    answers: { field: string; answer: string }[];
    last?: IntakeResponse;
  };
}

export interface OptionsRow {
  tripId: string;
  stage: StageName | "destinations";
  result?: StageResult;
  destinations?: DestinationsResult;
  /** Extra records fetched on demand (Compare prices). */
  extra: SignedEvidence[];
  fetchedAt: string;
}

export interface SelectionsRow extends Selections {
  tripId: string;
}

export interface ItineraryRow extends ItineraryResult {
  tripId: string;
}

export interface ChecklistRow {
  tripId: string;
  items: ChecklistItem[];
}

export interface SettingsRow extends Settings {
  id: "default";
}

export class WayfareDB extends Dexie {
  trips!: EntityTable<TripRow, "id">;
  options!: Dexie.Table<OptionsRow, [string, string]>;
  selections!: EntityTable<SelectionsRow, "tripId">;
  itinerary!: EntityTable<ItineraryRow, "tripId">;
  bookingChecklist!: EntityTable<ChecklistRow, "tripId">;
  settings!: EntityTable<SettingsRow, "id">;

  constructor(name = "wayfare") {
    super(name);
    this.version(1).stores({
      trips: "id, updatedAt, createdAt",
      options: "[tripId+stage], tripId",
      selections: "tripId",
      itinerary: "tripId",
      bookingChecklist: "tripId",
      settings: "id",
    });
  }
}

let instance: WayfareDB | undefined;
export function db(): WayfareDB {
  return (instance ??= new WayfareDB());
}
/** Tests only. */
export function setDb(d: WayfareDB) {
  instance = d;
}
