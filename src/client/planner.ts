"use client";
import { checkSelections, withReserve, type BudgetContext } from "@/lib/budget/engine";
import { withOffers } from "@/lib/budget/merge";
import { buildChecklist } from "@/lib/checklist";
import type {
  DestinationCandidate,
  DestinationsResult,
  IntakeResponse,
  ItineraryResult,
  SignedEvidence,
  StageName,
  StageResult,
} from "@/lib/schemas/api";
import type { EvidenceRecord, FxData } from "@/lib/schemas/evidence";
import type { BudgetPlan, Selections, TripBrief } from "@/lib/schemas/trip";
import { postStream, type ApiErrorBody } from "@/lib/sse-client";
import { db, type OptionsRow, type StageKey, type TripRow } from "./db";
import { addStep, finishRun, startRun, type Step } from "./runs";
import { updateTrip } from "./trips";

// Client-side actions. All facts come back inside signed evidence records and are stored as-is.

const nowIso = () => new Date().toISOString();

async function stream(tripId: string, job: string, url: string, body: unknown, on: (event: string, data: unknown) => Promise<void> | void) {
  const controller = startRun(tripId, job);
  const pending: Promise<void>[] = [];
  try {
    await postStream(
      url,
      body,
      (m) => {
        if (m.event === "progress") {
          const d = m.data as { message: string; agent?: string; at: string; type: string };
          addStep(tripId, { message: d.message, agent: d.agent, at: d.at, warning: d.type === "warning" } satisfies Step);
        } else {
          const r = on(m.event, m.data);
          if (r) pending.push(r);
        }
      },
      controller.signal,
    );
    await Promise.all(pending);
    finishRun(tripId);
  } catch (e) {
    await Promise.allSettled(pending);
    if ((e as Error)?.name === "AbortError") return finishRun(tripId);
    const err = (e && typeof e === "object" && "message" in e ? e : { code: "unknown", message: String(e), nextStep: "Try again." }) as ApiErrorBody;
    finishRun(tripId, err);
    throw err;
  }
}

export function cancelRun(tripId: string) {
  startRun(tripId, "cancelled").abort();
  finishRun(tripId);
}

// ---------- Records ----------

export async function allSigned(tripId: string): Promise<Map<string, SignedEvidence>> {
  const rows = await db().options.where("tripId").equals(tripId).toArray();
  const m = new Map<string, SignedEvidence>();
  for (const r of rows) for (const s of [...(r.result?.records ?? []), ...(r.destinations?.records ?? []), ...r.extra]) m.set(s.record.id, s);
  const it = await db().itinerary.get(tripId);
  for (const s of it?.records ?? []) m.set(s.record.id, s);
  return m;
}

export function recordsMap(signed: Iterable<SignedEvidence>): Map<string, EvidenceRecord> {
  return withOffers([...signed].map((s) => s.record));
}

export function latestFx(records: Map<string, EvidenceRecord>): FxData | undefined {
  let best: Extract<EvidenceRecord, { kind: "fx" }> | undefined;
  for (const r of records.values()) if (r.kind === "fx" && (!best || r.fetchedAt > best.fetchedAt)) best = r;
  if (!best) return undefined;
  // Combine rates from every FX record with the same base (each stage may fetch different quotes).
  const rates: Record<string, number> = {};
  for (const r of records.values()) if (r.kind === "fx" && r.data.base === best.data.base) Object.assign(rates, r.data.rates);
  return { ...best.data, rates };
}

export function budgetCtxOf(brief: TripBrief, records: Map<string, EvidenceRecord>): BudgetContext {
  return {
    currency: brief.budget?.currency ?? "EUR",
    fx: latestFx(records),
    travelers: brief.travelers ?? 1,
    nights: brief.nights ?? 1,
    rooms: brief.rooms ?? 1,
  };
}

// ---------- Intake ----------

export async function sendIntake(trip: TripRow, input: { text?: string; form?: Partial<TripBrief>; answer?: { field: string; answer: string }; overrides?: Partial<TripBrief> }) {
  const intake = {
    text: input.text ?? trip.intake.text,
    form: input.form ?? trip.intake.form,
    answers: input.answer ? [...trip.intake.answers.filter((a) => a.field !== input.answer!.field), input.answer] : trip.intake.answers,
  };
  await updateTrip(trip.id, { intake: { ...trip.intake, ...intake } });
  await stream(trip.id, "intake", "/api/intake", { ...intake, overrides: input.overrides ?? {} }, async (event, data) => {
    if (event !== "result") return;
    const r = data as IntakeResponse;
    const fresh = await db().trips.get(trip.id);
    if (!fresh) return;
    const name = fresh.name === "New trip" && r.brief.destination ? `${r.brief.destination.name} trip` : fresh.name;
    await updateTrip(trip.id, { name, brief: r.brief, intake: { ...fresh.intake, ...intake, last: r } });
  });
}

/** Edits an assumption chip (or any brief field) directly, without asking the model again. */
export async function editBrief(trip: TripRow, patch: Partial<TripBrief>, assumptionField?: string) {
  if (!trip.brief) return;
  const brief: TripBrief = {
    ...trip.brief,
    ...patch,
    assumptions: assumptionField ? trip.brief.assumptions.filter((a) => a.field !== assumptionField) : trip.brief.assumptions,
  };
  await updateTrip(trip.id, { brief, intake: { ...trip.intake, form: { ...trip.intake.form, ...patch } } });
}

// ---------- Destinations ----------

export async function findDestinations(trip: TripRow) {
  if (!trip.brief) return;
  await stream(trip.id, "destinations", "/api/destinations", { brief: trip.brief }, async (event, data) => {
    if (event !== "result") return;
    const row: OptionsRow = { tripId: trip.id, stage: "destinations", destinations: data as DestinationsResult, extra: [], fetchedAt: nowIso() };
    await db().options.put(row);
  });
}

export async function chooseDestination(trip: TripRow, c: DestinationCandidate) {
  if (!trip.brief) return;
  const brief: TripBrief = { ...trip.brief, destination: { name: c.name, country: c.country, airportCodes: [c.airportCode] } };
  await updateTrip(trip.id, { brief, name: trip.name === "New trip" ? `${c.name} trip` : trip.name });
}

// ---------- Planning ----------

/**
 * Progress stays on the Basics screen; the trip moves to Flights once the flight options arrive (or
 * once planning ends, if flights failed). Stay and activities keep loading in the background.
 */
export async function startPlanning(trip: TripRow, reservePercent?: number) {
  if (!trip.brief) return;
  let moved = false;
  const toFlights = async () => {
    if (moved) return;
    moved = true;
    await updateTrip(trip.id, { stage: "flights" });
  };
  // Results from an earlier plan would show the old trip's options while the new ones load.
  await db().options.where("tripId").equals(trip.id).filter((o) => o.stage !== "destinations").delete();
  await db().selections.put({ tripId: trip.id, activityIds: [] });
  await updateTrip(trip.id, { stage: "basics" });
  try {
    await stream(trip.id, "plan", "/api/plan", { brief: trip.brief, reservePercent }, async (event, data) => {
      if (event === "budget") await updateTrip(trip.id, { budgetPlan: data as BudgetPlan });
      if (event === "stage") {
        const r = data as StageResult;
        await db().options.put({ tripId: trip.id, stage: r.stage, result: r, extra: [], fetchedAt: nowIso() });
        if (r.stage === "flights") await toFlights();
      }
      if (event === "stage_error") {
        const e = data as ApiErrorBody & { stage: StageName };
        addStep(trip.id, { message: `${e.stage}: ${e.message} ${e.nextStep}`, at: nowIso(), warning: true });
      }
    });
  } finally {
    if ((await db().trips.get(trip.id))?.budgetPlan) await toFlights();
  }
}

export async function refreshStage(trip: TripRow, stage: StageName) {
  if (!trip.brief || !trip.budgetPlan) return;
  const sel = (await db().selections.get(trip.id)) ?? { tripId: trip.id, activityIds: [] };
  const signed = await allSigned(trip.id);
  // Send the records behind the user's other choices so the budget check knows about them.
  const keep = [sel.flightId, sel.hotelId, ...sel.activityIds].filter(Boolean) as string[];
  const records = [...signed.values()].filter((s) => keep.includes(s.record.id) || s.record.kind === "fx" || isOffersFor(s.record, keep));
  await stream(trip.id, `refresh-${stage}`, `/api/stage/${stage}`, { brief: trip.brief, budgetPlan: trip.budgetPlan, selections: stripTrip(sel), records }, async (event, data) => {
    if (event !== "stage") return;
    const r = data as StageResult;
    await db().options.put({ tripId: trip.id, stage, result: r, extra: [], fetchedAt: nowIso() });
  });
}

const isOffersFor = (r: EvidenceRecord, ids: string[]) =>
  (r.kind === "flight_offers" && ids.includes(r.data.flightEvidenceId)) || (r.kind === "hotel_offers" && ids.includes(r.data.hotelEvidenceId));

const stripTrip = ({ tripId: _t, ...s }: Selections & { tripId: string }): Selections => {
  void _t;
  return s;
};

export async function comparePrices(trip: TripRow, stage: "flights" | "stay", item: SignedEvidence) {
  await stream(trip.id, `compare-${item.record.id}`, "/api/compare", { evidence: item, destination: trip.brief?.destination?.name }, async (event, data) => {
    if (event !== "result") return;
    const r = data as { records: SignedEvidence[]; note?: string };
    const row = await db().options.get([trip.id, stage]);
    if (!row) return;
    await db().options.put({ ...row, extra: [...row.extra.filter((x) => !r.records.some((n) => n.record.id === x.record.id)), ...r.records] });
    if (r.note) addStep(trip.id, { message: r.note, at: nowIso() });
  });
}

export async function changeReserve(trip: TripRow, reservePercent: number) {
  if (!trip.budgetPlan) return;
  await updateTrip(trip.id, { budgetPlan: withReserve(trip.budgetPlan, reservePercent) });
}

// ---------- Selection (budget enforced in code) ----------

export type SelectResult = { ok: true } | { ok: false; reason: string };

export async function select(trip: TripRow, next: Partial<Selections>): Promise<SelectResult> {
  if (!trip.brief || !trip.budgetPlan) return { ok: false, reason: "Set up the budget first." };
  const cur = (await db().selections.get(trip.id)) ?? { tripId: trip.id, activityIds: [] };
  const merged = { ...cur, ...next };
  const records = recordsMap((await allSigned(trip.id)).values());
  const verdict = checkSelections(trip.budgetPlan, stripTrip(merged), records, budgetCtxOf(trip.brief, records));
  if (!verdict.ok) {
    const over = verdict.overBy ? ` It's over by ${verdict.overBy.amount.toFixed(2)} ${verdict.overBy.currency}.` : "";
    return { ok: false, reason: `${verdict.reason}${over}` };
  }
  await db().selections.put(merged);
  await updateTrip(trip.id, {});
  return { ok: true };
}

export async function toggleActivity(trip: TripRow, id: string): Promise<SelectResult> {
  const cur = (await db().selections.get(trip.id)) ?? { tripId: trip.id, activityIds: [] };
  const has = cur.activityIds.includes(id);
  if (has) {
    await db().selections.put({ ...cur, activityIds: cur.activityIds.filter((x) => x !== id) });
    return { ok: true };
  }
  return select(trip, { activityIds: [...cur.activityIds, id] });
}

// ---------- Itinerary ----------

export async function buildTripItinerary(trip: TripRow) {
  if (!trip.brief || !trip.budgetPlan) return;
  const sel = await db().selections.get(trip.id);
  if (!sel?.flightId || !sel.hotelId) throw { code: "incomplete", message: "Pick a flight and a hotel first.", nextStep: "Go back to Flights and Stay." } satisfies ApiErrorBody;
  const signed = await allSigned(trip.id);
  const ids = [sel.flightId, sel.hotelId, ...sel.activityIds];
  const records = [...signed.values()].filter((s) => ids.includes(s.record.id) || s.record.kind === "fx" || isOffersFor(s.record, ids));
  await updateTrip(trip.id, { stage: "itinerary" as StageKey });
  await stream(trip.id, "itinerary", "/api/itinerary", { brief: trip.brief, budgetPlan: trip.budgetPlan, selections: stripTrip(sel), records }, async (event, data) => {
    if (event !== "result") return;
    const r = data as ItineraryResult;
    const prev = await db().itinerary.get(trip.id);
    // Keep ticks for items that still exist (same type, title and start).
    const done = new Set(prev?.itinerary.items.filter((i) => i.done).map((i) => `${i.type}|${i.title}|${i.start}`));
    r.itinerary.items = r.itinerary.items.map((i) => ({ ...i, done: done.has(`${i.type}|${i.title}|${i.start}`) }));
    await db().itinerary.put({ ...r, tripId: trip.id });
    const all = recordsMap([...signed.values(), ...r.records]);
    const prevList = (await db().bookingChecklist.get(trip.id))?.items;
    await db().bookingChecklist.put({ tripId: trip.id, items: buildChecklist(trip.brief!, stripTrip(sel), all, budgetCtxOf(trip.brief!, all), prevList) });
    await updateTrip(trip.id, { status: "ready" });
  });
}

export async function toggleItineraryItem(tripId: string, itemId: string) {
  const row = await db().itinerary.get(tripId);
  if (!row) return;
  row.itinerary.items = row.itinerary.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i));
  await db().itinerary.put(row);
  if (row.itinerary.items.some((i) => i.done)) await updateTrip(tripId, { status: "in_progress" });
}

export async function toggleBooked(tripId: string, evidenceId: string) {
  const row = await db().bookingChecklist.get(tripId);
  if (!row) return;
  await db().bookingChecklist.put({ ...row, items: row.items.map((i) => (i.evidenceId === evidenceId ? { ...i, booked: !i.booked } : i)) });
}
