"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { summarize, type BudgetContext, type BudgetSummary } from "@/lib/budget/engine";
import type { SignedEvidence } from "@/lib/schemas/api";
import type { EvidenceRecord } from "@/lib/schemas/evidence";
import { db, type ChecklistRow, type ItineraryRow, type OptionsRow, type SelectionsRow, type TripRow } from "./db";
import { budgetCtxOf, recordsMap } from "./planner";

export interface TripData {
  trip: TripRow;
  options: Partial<Record<OptionsRow["stage"], OptionsRow>>;
  selections: SelectionsRow;
  itinerary?: ItineraryRow;
  checklist?: ChecklistRow;
  signed: Map<string, SignedEvidence>;
  records: Map<string, EvidenceRecord>;
  ctx?: BudgetContext;
  summary?: BudgetSummary;
}

export function useTripData(tripId: string | undefined): TripData | null | undefined {
  const raw = useLiveQuery(async () => {
    if (!tripId) return null;
    const d = db();
    const trip = await d.trips.get(tripId);
    if (!trip) return null;
    const [opts, selections, itinerary, checklist] = await Promise.all([
      d.options.where("tripId").equals(tripId).toArray(),
      d.selections.get(tripId),
      d.itinerary.get(tripId),
      d.bookingChecklist.get(tripId),
    ]);
    return { trip, opts, selections: selections ?? { tripId, activityIds: [] }, itinerary, checklist };
  }, [tripId]);

  return useMemo(() => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    const options: TripData["options"] = {};
    const signed = new Map<string, SignedEvidence>();
    for (const o of raw.opts) {
      options[o.stage] = o;
      for (const s of [...(o.result?.records ?? []), ...(o.destinations?.records ?? []), ...o.extra]) signed.set(s.record.id, s);
    }
    for (const s of raw.itinerary?.records ?? []) signed.set(s.record.id, s);
    const records = recordsMap(signed.values());
    const ctx = raw.trip.brief?.budget ? budgetCtxOf(raw.trip.brief, records) : undefined;
    const booked = new Set(raw.checklist?.items.filter((i) => i.booked).map((i) => i.evidenceId));
    let summary: BudgetSummary | undefined;
    if (raw.trip.budgetPlan && ctx) {
      try {
        summary = summarize(raw.trip.budgetPlan, raw.selections, records, ctx, booked);
      } catch {
        summary = undefined;
      }
    }
    return { trip: raw.trip, options, selections: raw.selections, itinerary: raw.itinerary, checklist: raw.checklist, signed, records, ctx, summary };
  }, [raw]);
}
