"use client";
import { z } from "zod";
import { SignedEvidence } from "@/lib/schemas/api";
import { db, type ChecklistRow, type ItineraryRow, type OptionsRow, type SelectionsRow, type TripRow } from "./db";

const now = () => new Date().toISOString();
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t_${Date.now()}_${Math.random().toString(36).slice(2)}`);

export async function createTrip(name = "New trip"): Promise<TripRow> {
  const t: TripRow = {
    id: uid(),
    name,
    createdAt: now(),
    updatedAt: now(),
    status: "planning",
    stage: "basics",
    intake: { text: "", form: {}, answers: [] },
  };
  await db().trips.add(t);
  await db().selections.put({ tripId: t.id, activityIds: [] });
  return t;
}

export async function updateTrip(id: string, patch: Partial<Omit<TripRow, "id" | "createdAt">>) {
  await db().trips.update(id, { ...patch, updatedAt: now() });
}

export async function renameTrip(id: string, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  await updateTrip(id, { name: clean });
}

export interface TripSnapshot {
  trip: TripRow;
  options: OptionsRow[];
  selections?: SelectionsRow;
  itinerary?: ItineraryRow;
  checklist?: ChecklistRow;
}

export async function snapshot(id: string): Promise<TripSnapshot | undefined> {
  const d = db();
  const trip = await d.trips.get(id);
  if (!trip) return undefined;
  return {
    trip,
    options: await d.options.where("tripId").equals(id).toArray(),
    selections: await d.selections.get(id),
    itinerary: await d.itinerary.get(id),
    checklist: await d.bookingChecklist.get(id),
  };
}

/** Deletes a trip and returns a snapshot so the caller can offer undo. */
export async function deleteTrip(id: string): Promise<TripSnapshot | undefined> {
  const d = db();
  const snap = await snapshot(id);
  await d.transaction("rw", [d.trips, d.options, d.selections, d.itinerary, d.bookingChecklist], async () => {
    await d.trips.delete(id);
    await d.options.where("tripId").equals(id).delete();
    await d.selections.delete(id);
    await d.itinerary.delete(id);
    await d.bookingChecklist.delete(id);
  });
  return snap;
}

export async function restoreTrip(s: TripSnapshot) {
  const d = db();
  await d.transaction("rw", [d.trips, d.options, d.selections, d.itinerary, d.bookingChecklist], async () => {
    await d.trips.put(s.trip);
    if (s.options.length) await d.options.bulkPut(s.options);
    if (s.selections) await d.selections.put(s.selections);
    if (s.itinerary) await d.itinerary.put(s.itinerary);
    if (s.checklist) await d.bookingChecklist.put(s.checklist);
  });
}

/** Replaces the local copy of a trip with a saved one (rows the saved copy lacks are removed). */
export async function replaceTrip(s: TripSnapshot) {
  const d = db();
  const id = s.trip.id;
  await d.transaction("rw", [d.trips, d.options, d.selections, d.itinerary, d.bookingChecklist], async () => {
    await d.options.where("tripId").equals(id).delete();
    await d.selections.delete(id);
    await d.itinerary.delete(id);
    await d.bookingChecklist.delete(id);
    await restoreTrip(s);
  });
}

export async function listTrips(): Promise<TripRow[]> {
  return db().trips.orderBy("createdAt").reverse().toArray();
}

// ---------- Export / import ----------

const ExportFile = z.object({
  app: z.literal("wayfare"),
  version: z.literal(1),
  exportedAt: z.string(),
  trips: z.array(
    z.object({
      trip: z.object({ id: z.string(), name: z.string(), createdAt: z.string(), updatedAt: z.string() }).passthrough(),
      options: z.array(z.object({ tripId: z.string(), stage: z.string() }).passthrough()),
      selections: z.object({ tripId: z.string() }).passthrough().optional(),
      itinerary: z.object({ tripId: z.string() }).passthrough().optional(),
      checklist: z.object({ tripId: z.string() }).passthrough().optional(),
    }),
  ),
});

export async function exportAll(): Promise<Blob> {
  const trips = await listTrips();
  const snaps = (await Promise.all(trips.map((t) => snapshot(t.id)))).filter(Boolean);
  const file = { app: "wayfare", version: 1, exportedAt: now(), trips: snaps };
  return new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
}

/** Imports trips from an export file. Existing trips with the same ID are kept; imported copies get new IDs. */
export async function importAll(text: string): Promise<{ imported: number; skipped: number }> {
  let parsed: z.infer<typeof ExportFile>;
  try {
    parsed = ExportFile.parse(JSON.parse(text));
  } catch {
    throw new Error("That file isn't a Wayfare export. Choose a file saved with Export.");
  }
  let imported = 0;
  let skipped = 0;
  for (const raw of parsed.trips) {
    const s = raw as unknown as TripSnapshot;
    // Evidence inside must still be well-formed; malformed trips are skipped, not half-imported.
    const recordsOk = s.options.every((o) =>
      (o.result?.records ?? []).concat(o.extra ?? [], o.destinations?.records ?? []).every((r) => SignedEvidence.safeParse(r).success),
    );
    if (!recordsOk) {
      skipped++;
      continue;
    }
    const exists = await db().trips.get(s.trip.id);
    const id = exists ? uid() : s.trip.id;
    const re = <T extends { tripId: string }>(x: T | undefined) => (x ? { ...x, tripId: id } : undefined);
    await restoreTrip({
      trip: { ...s.trip, id, name: exists ? `${s.trip.name} (imported)` : s.trip.name },
      options: s.options.map((o) => ({ ...o, tripId: id })),
      selections: re(s.selections),
      itinerary: re(s.itinerary),
      checklist: re(s.checklist),
    });
    imported++;
  }
  return { imported, skipped };
}
