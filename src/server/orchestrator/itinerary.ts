import "server-only";
import { checkSelections } from "@/lib/budget/engine";
import { withOffers } from "@/lib/budget/merge";
import { buildSchedule, sameLocation, validateSchedule, type ScheduleActivity, type TravelEstimate } from "@/lib/itinerary/scheduler";
import type { ItineraryResult } from "@/lib/schemas/api";
import type { Location } from "@/lib/schemas/common";
import type { EvidenceRecord } from "@/lib/schemas/evidence";
import type { BudgetPlan, Selections, TripBrief } from "@/lib/schemas/trip";
import type { PlanContext } from "../agents/context";
import { runAgent } from "../agents/runner";
import { itineraryPlanner } from "../agents/defs/scouts";
import { budgetContext, callTool, ensureFx, requireComplete } from "./stages";

const MAX_ROUTING_ROUNDS = 3;
const locKey = (l: Location) => l.placeId ?? (l.point ? `${l.point.lat.toFixed(4)},${l.point.lng.toFixed(4)}` : `${l.name ?? ""}|${l.address ?? ""}`);

/**
 * Builds the day-by-day plan. The Itinerary Planner agent picks days and order; code does the exact
 * timetable (opening hours, slots, buffers, no overlaps) with travel times from the routing service.
 * The grand total is recomputed from evidence at the end.
 */
export async function buildItinerary(
  ctx: PlanContext,
  brief: TripBrief,
  plan: BudgetPlan,
  selections: Selections,
  records: EvidenceRecord[],
): Promise<ItineraryResult> {
  const b = requireComplete(brief);
  const problems: string[] = [];
  const all = withOffers(records);
  const flight = selections.flightId ? all.get(selections.flightId) : undefined;
  const hotel = selections.hotelId ? all.get(selections.hotelId) : undefined;
  if (flight?.kind !== "flight") throw new Error("Pick a flight before building the itinerary.");
  if (hotel?.kind !== "hotel") throw new Error("Pick a hotel before building the itinerary.");
  const acts = selections.activityIds.map((id) => all.get(id)).filter((r): r is Extract<EvidenceRecord, { kind: "experience" }> => r?.kind === "experience");
  if (acts.length !== selections.activityIds.length) problems.push("Some chosen activities couldn't be found and were left out.");

  const fx = await ensureFx(ctx, all.values(), b.budget.currency).catch(() => undefined);
  if (fx) all.set(fx.id, fx);
  const verdict = checkSelections(plan, selections, all, budgetContext(b, fx?.data));
  if (!verdict.ok) problems.push(`Budget check: ${verdict.reason}`);

  const destTz =
    hotel.data.location.timeZone ??
    flight.data.outbound.segments[flight.data.outbound.segments.length - 1].to.timeZone ??
    "UTC";
  const originTz = flight.data.outbound.segments[0].from.timeZone ?? "UTC";

  // Planner: preferred days and order.
  let order = acts.map((a) => ({ evidenceId: a.id, preferredDay: null as string | null }));
  if (acts.length > 1) {
    ctx.progress({ type: "step", agent: "Itinerary Planner", message: `Planning ${acts.length} activities across your days…`, at: new Date().toISOString() });
    try {
      const out = await runAgent(
        itineraryPlanner,
        `Trip days: ${b.dates.departDate} to ${b.dates.returnDate}. Hotel: ${JSON.stringify(hotel.data.location)}.
Outbound lands ${flight.data.outbound.segments.at(-1)!.arriveLocal}; return departs ${flight.data.inbound.segments[0].departLocal}.
Activities: ${JSON.stringify(acts.map((a) => ({ evidenceId: a.id, title: a.data.title, durationMinutes: a.data.durationMinutes ?? null, openingHours: a.data.openingHours ?? null, timeSlots: a.data.timeSlots ?? null, location: a.data.location })))}`,
        ctx,
      );
      const known = new Set(acts.map((a) => a.id));
      const seen = new Set<string>();
      const fromAgent = out.order.filter((o) => known.has(o.evidenceId) && !seen.has(o.evidenceId) && seen.add(o.evidenceId));
      order = [...fromAgent, ...order.filter((o) => !seen.has(o.evidenceId))];
    } catch (e) {
      problems.push(`The planner couldn't order activities (${e instanceof Error ? e.message : e}); using your order.`);
    }
  }

  const byId = new Map(acts.map((a) => [a.id, a]));
  const scheduleActs: ScheduleActivity[] = order.map((o) => {
    const a = byId.get(o.evidenceId)!;
    return {
      evidenceId: a.id,
      title: a.data.title,
      location: { ...a.data.location, timeZone: a.data.location.timeZone ?? destTz },
      durationMinutes: a.data.durationMinutes,
      openingHours: a.data.openingHours,
      timeSlots: a.data.timeSlots,
      preferredDay: o.preferredDay ?? undefined,
    };
  });

  // Routing loop: schedule with known travel times, fetch the pairs the schedule needed, repeat.
  const travelCache = new Map<string, TravelEstimate | null>();
  const travelRecords: EvidenceRecord[] = [];
  const pairKey = (a: Location, b2: Location, p: string) => `${p}:${locKey(a)}→${locKey(b2)}`;
  const routable = (l: Location) => Boolean(l.placeId || l.point || l.address);
  let result = undefined as ReturnType<typeof buildSchedule> | undefined;
  for (let round = 0; round < MAX_ROUTING_ROUNDS; round++) {
    const needed = new Map<string, { from: Location; to: Location; purpose: "airport" | "local" }>();
    result = buildSchedule({
      flightEvidenceId: flight.id,
      outbound: flight.data.outbound,
      inbound: flight.data.inbound,
      international: flight.data.international ?? true,
      origin: { name: b.origin.name, timeZone: originTz },
      destinationTimeZone: destTz,
      hotel: { evidenceId: hotel.id, name: hotel.data.name, location: hotel.data.location, checkInTime: hotel.data.checkInTime, checkOutTime: hotel.data.checkOutTime },
      activities: scheduleActs,
      travel: (from, to, purpose) => {
        const k = pairKey(from, to, purpose);
        const hit = travelCache.get(k);
        if (hit !== undefined) return hit ?? undefined;
        needed.set(k, { from, to, purpose });
        return undefined;
      },
      buffers: {
        airportInternationalMin: ctx.env.AIRPORT_BUFFER_INTERNATIONAL_MIN,
        airportDomesticMin: ctx.env.AIRPORT_BUFFER_DOMESTIC_MIN,
        arrivalInternationalMin: ctx.env.ARRIVAL_BUFFER_INTERNATIONAL_MIN,
        arrivalDomesticMin: ctx.env.ARRIVAL_BUFFER_DOMESTIC_MIN,
      },
    });
    if (!needed.size) break;
    if (!ctx.providers.routes.available()) {
      for (const k of needed.keys()) travelCache.set(k, null);
      problems.push("Travel times are estimates: GOOGLE_MAPS_API_KEY isn't set.");
      continue;
    }
    ctx.progress({ type: "step", agent: "Itinerary Planner", message: `Checking ${needed.size} travel time(s)…`, at: new Date().toISOString() });
    await Promise.all(
      [...needed].map(async ([k, { from, to, purpose }]) => {
        if (sameLocation(from, to) || !routable(from) || !routable(to)) {
          travelCache.set(k, null);
          return;
        }
        try {
          const s = await callTool(ctx, "reference", "travel_time", {
            from: { name: from.name, address: from.address, placeId: from.placeId, lat: from.point?.lat, lng: from.point?.lng },
            to: { name: to.name, address: to.address, placeId: to.placeId, lat: to.point?.lat, lng: to.point?.lng },
            mode: purpose === "airport" ? "drive" : "transit",
          });
          if (s.found && typeof s.minutes === "number" && typeof s.evidenceId === "string") {
            travelCache.set(k, { minutes: s.minutes, evidenceId: s.evidenceId });
            const rec = ctx.evidence.get(s.evidenceId);
            if (rec) travelRecords.push(rec);
          } else travelCache.set(k, null);
        } catch {
          travelCache.set(k, null);
        }
      }),
    );
  }

  const schedule = result!;
  const check = validateSchedule(schedule.itinerary.items, new Map(scheduleActs.map((a) => [a.evidenceId, a])));
  if (check.length) problems.push(...check.map((c) => `Schedule check: ${c}`));
  const grand = verdict.summary.selected;
  return {
    itinerary: schedule.itinerary,
    unscheduled: schedule.unscheduled,
    records: [...travelRecords, ...(fx ? [fx] : [])].map((r) => ctx.evidence.sign(r)),
    grandTotal: { amount: Math.round((grand.amount + plan.reserve.amount) * 100) / 100, currency: plan.total.currency },
    problems: [...new Set(problems)],
  };
}
