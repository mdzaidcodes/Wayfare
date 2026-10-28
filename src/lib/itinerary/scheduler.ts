import type { Location } from "../schemas/common";
import type { Airport, FlightLeg, OpeningHours, TimeSlot } from "../schemas/evidence";
import type { Itinerary, ItineraryItem, ItineraryItemType } from "../schemas/trip";
import { addDays, addMinutes, localParts, minutesBetween, toIsoWithOffset, zoned } from "../time";
import { isWithinOpeningHours, openIntervalsOn } from "./hours";

// Deterministic scheduler. It places fixed items (flights, buffers, transfers, check-in/out, meals)
// and fits activities into the gaps, inside real opening hours or slots, with travel time between
// places. It never overlaps items. The Itinerary Planner agent only influences order and preferred days.

export interface TravelEstimate {
  minutes: number;
  /** Evidence record of the routing result; absent when this is a fallback estimate. */
  evidenceId?: string;
}

export type TravelFn = (from: Location, to: Location, purpose: "airport" | "local") => TravelEstimate | undefined;

export interface ScheduleActivity {
  evidenceId: string;
  title: string;
  location: Location;
  durationMinutes?: number;
  openingHours?: OpeningHours;
  timeSlots?: TimeSlot[];
  preferredDay?: string;
}

export interface ScheduleInput {
  flightEvidenceId: string;
  outbound: FlightLeg;
  inbound: FlightLeg;
  international: boolean;
  origin: { name: string; location?: Location; timeZone: string };
  destinationTimeZone: string;
  hotel: {
    evidenceId: string;
    name: string;
    location: Location;
    checkInTime?: string;
    checkOutTime?: string;
  };
  activities: ScheduleActivity[];
  travel: TravelFn;
  buffers: {
    airportInternationalMin: number;
    airportDomesticMin: number;
    arrivalInternationalMin: number;
    arrivalDomesticMin: number;
  };
  options?: Partial<ScheduleOptions>;
  now?: Date;
}

export interface ScheduleOptions {
  dayStart: string;
  dayEnd: string;
  lunch: [string, string];
  dinner: [string, string];
  /** Gap between checkout and airport transfer that triggers a bag-storage note. */
  lateFlightGapMin: number;
  fallbackLocalTravelMin: number;
  fallbackAirportTransferMin: number;
  defaultActivityMin: number;
  defaultCheckOutTime: string;
}

const DEFAULTS: ScheduleOptions = {
  dayStart: "09:00",
  dayEnd: "21:30",
  lunch: ["12:30", "13:30"],
  dinner: ["19:00", "20:15"],
  lateFlightGapMin: 180,
  fallbackLocalTravelMin: 30,
  fallbackAirportTransferMin: 60,
  defaultActivityMin: 90,
  defaultCheckOutTime: "11:00",
};

export interface ScheduleResult {
  itinerary: Itinerary;
  unscheduled: { evidenceId: string; title: string; reason: string }[];
}

export function sameLocation(a: Location | undefined, b: Location | undefined): boolean {
  if (!a || !b) return false;
  if (a.placeId && b.placeId) return a.placeId === b.placeId;
  if (a.point && b.point) {
    const dLat = (a.point.lat - b.point.lat) * 111_000;
    const dLng = (a.point.lng - b.point.lng) * 111_000 * Math.cos((a.point.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng) < 60;
  }
  return Boolean(a.name && a.name === b.name && a.address === b.address);
}

const airportLocation = (a: Airport, fallbackTz: string): Location => ({
  name: a.name ? `${a.name} (${a.code})` : `${a.code} airport`,
  timeZone: a.timeZone ?? fallbackTz,
});

const ESTIMATE_NOTE = "Estimate: the routing source gave no travel time for this trip. Allow extra time.";

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const o = { ...DEFAULTS, ...input.options };
  const destTz = input.destinationTimeZone;
  const items: ItineraryItem[] = [];
  let seq = 0;

  const push = (
    type: ItineraryItemType,
    start: Date,
    end: Date,
    timeZone: string,
    title: string,
    extra: Partial<Omit<ItineraryItem, "id" | "type" | "start" | "end" | "timeZone" | "title" | "day">> = {},
  ) => {
    const item: ItineraryItem = {
      id: `it_${String(++seq).padStart(3, "0")}`,
      day: localParts(start, timeZone).date,
      start: toIsoWithOffset(start, timeZone),
      end: toIsoWithOffset(end, timeZone),
      timeZone,
      type,
      title,
      done: false,
      ...extra,
    };
    if (item.notes && item.notes.length === 0) delete item.notes;
    items.push(item);
    return item;
  };

  const travelOrFallback = (from: Location, to: Location, purpose: "airport" | "local") => {
    if (sameLocation(from, to)) return { minutes: 0, evidenceId: undefined, estimate: false };
    const t = input.travel(from, to, purpose);
    if (t) return { ...t, estimate: false };
    return {
      minutes: purpose === "airport" ? o.fallbackAirportTransferMin : o.fallbackLocalTravelMin,
      evidenceId: undefined,
      estimate: true,
    };
  };

  const pushLeg = (leg: FlightLeg, legTz: { from: string; to: string }) => {
    leg.segments.forEach((s, i) => {
      const fromTz = s.from.timeZone ?? (i === 0 ? legTz.from : legTz.to);
      const name = [s.airline, s.flightNumber].filter(Boolean).join(" ");
      push("flight", new Date(s.departLocal), new Date(s.arriveLocal), fromTz, `${name}: ${s.from.code} → ${s.to.code}`, {
        evidenceId: input.flightEvidenceId,
        location: airportLocation(s.from, fromTz),
        details: `Departs ${s.from.code}, arrives ${s.to.code} (local times).`,
      });
      const next = leg.segments[i + 1];
      if (next) {
        const tz = s.to.timeZone ?? legTz.to;
        const mins = minutesBetween(new Date(s.arriveLocal), new Date(next.departLocal));
        push("free_time", new Date(s.arriveLocal), new Date(next.departLocal), tz, `Layover at ${s.to.code}`, {
          details: `${Math.floor(mins / 60)}h ${mins % 60}m connection.`,
          location: airportLocation(s.to, tz),
        });
      }
    });
  };

  const airportBuffer = input.international ? input.buffers.airportInternationalMin : input.buffers.airportDomesticMin;
  const arrivalBuffer = input.international
    ? input.buffers.arrivalInternationalMin
    : input.buffers.arrivalDomesticMin;
  const hotelLoc = input.hotel.location;

  // ---- Outbound ----
  const out0 = input.outbound.segments[0];
  const outLast = input.outbound.segments[input.outbound.segments.length - 1];
  const originTz = out0.from.timeZone ?? input.origin.timeZone;
  const depart = new Date(out0.departLocal);
  const atAirport = addMinutes(depart, -airportBuffer);
  const depAirport = airportLocation(out0.from, originTz);
  const home = input.origin.location ?? { name: input.origin.name, timeZone: originTz };
  const toAirport = travelOrFallback(home, depAirport, "airport");
  push("leave_for_airport", addMinutes(atAirport, -toAirport.minutes), atAirport, originTz, `Leave for ${depAirport.name}`, {
    location: home,
    details: `${toAirport.minutes} min to the airport.`,
    travelTimeEvidenceId: toAirport.evidenceId,
    notes: toAirport.estimate ? [ESTIMATE_NOTE] : [],
  });
  push("airport_arrival", atAirport, depart, originTz, `Arrive at ${depAirport.name}`, {
    location: depAirport,
    details: `${airportBuffer / 60} hours before departure, for check-in and security.`,
  });
  pushLeg(input.outbound, { from: originTz, to: destTz });

  const landed = new Date(outLast.arriveLocal);
  const arrAirport = airportLocation(outLast.to, destTz);
  const bufferEnd = addMinutes(landed, arrivalBuffer);
  push("arrival_buffer", landed, bufferEnd, destTz, input.international ? "Immigration and baggage" : "Baggage claim", {
    location: arrAirport,
  });
  const transferIn = travelOrFallback(arrAirport, hotelLoc, "airport");
  const hotelArrive = addMinutes(bufferEnd, transferIn.minutes);
  push("transfer", bufferEnd, hotelArrive, destTz, `Transfer to ${input.hotel.name}`, {
    location: arrAirport,
    details: `${transferIn.minutes} min from the airport. Price not included.`,
    travelTimeEvidenceId: transferIn.evidenceId,
    notes: transferIn.estimate ? [ESTIMATE_NOTE] : [],
  });

  // ---- Return (computed now so destination days know where they end) ----
  const in0 = input.inbound.segments[0];
  const inDepart = new Date(in0.departLocal);
  const atAirportBack = addMinutes(inDepart, -airportBuffer);
  const retAirport = airportLocation(in0.from, destTz);
  const transferOut = travelOrFallback(hotelLoc, retAirport, "airport");
  const transferOutStart = addMinutes(atAirportBack, -transferOut.minutes);

  // ---- Destination days ----
  const arrivalDate = localParts(hotelArrive, destTz).date;
  const departureDate = localParts(transferOutStart, destTz).date;
  type Anchor = { start: Date; end: Date; location?: Location };
  const anchorsByDay = new Map<string, Anchor[]>();
  const addAnchor = (a: Anchor) => {
    const d = localParts(a.start, destTz).date;
    anchorsByDay.set(d, [...(anchorsByDay.get(d) ?? []), a]);
  };

  // Check-in
  const hotelExtra = { evidenceId: input.hotel.evidenceId, location: hotelLoc };
  if (input.hotel.checkInTime) {
    const checkIn = zoned(arrivalDate, input.hotel.checkInTime, destTz);
    if (hotelArrive < checkIn) {
      const dropEnd = addMinutes(hotelArrive, 15);
      push("bag_drop", hotelArrive, dropEnd, destTz, `Drop bags at ${input.hotel.name}`, {
        ...hotelExtra,
        notes: [`Check-in is from ${input.hotel.checkInTime}. Early check-in isn't guaranteed; ask to leave your bags.`],
      });
      addAnchor({ start: hotelArrive, end: dropEnd, location: hotelLoc });
      const ci = push("checkin", checkIn, addMinutes(checkIn, 15), destTz, `Check in at ${input.hotel.name}`, hotelExtra);
      addAnchor({ start: new Date(ci.start), end: new Date(ci.end), location: hotelLoc });
    } else {
      const ci = push("checkin", hotelArrive, addMinutes(hotelArrive, 15), destTz, `Check in at ${input.hotel.name}`, hotelExtra);
      addAnchor({ start: new Date(ci.start), end: new Date(ci.end), location: hotelLoc });
    }
  } else {
    const ci = push("checkin", hotelArrive, addMinutes(hotelArrive, 15), destTz, `Check in at ${input.hotel.name}`, {
      ...hotelExtra,
      notes: ["Check-in time not provided by source. Confirm with the hotel."],
    });
    addAnchor({ start: new Date(ci.start), end: new Date(ci.end), location: hotelLoc });
  }

  // Checkout and bag storage
  const coNotes: string[] = [];
  let checkout = zoned(departureDate, input.hotel.checkOutTime ?? o.defaultCheckOutTime, destTz);
  if (!input.hotel.checkOutTime) coNotes.push("Checkout time not provided by source. Confirm with the hotel.");
  const latestCheckout = addMinutes(transferOutStart, -15);
  if (checkout > latestCheckout) checkout = latestCheckout;
  const coEnd = addMinutes(checkout, 15);
  push("checkout", checkout, coEnd, destTz, `Check out of ${input.hotel.name}`, { ...hotelExtra, notes: coNotes });
  addAnchor({ start: checkout, end: coEnd, location: hotelLoc });
  if (minutesBetween(coEnd, transferOutStart) >= o.lateFlightGapMin) {
    const bsEnd = addMinutes(coEnd, 10);
    push("bag_storage", coEnd, bsEnd, destTz, "Leave bags with the hotel", {
      ...hotelExtra,
      notes: ["Your flight is late. Ask the hotel to store your bags; storage isn't guaranteed."],
    });
    addAnchor({ start: coEnd, end: bsEnd, location: hotelLoc });
  }

  // Activity placement
  const remaining = input.activities.map((a, order) => ({ a, order }));
  const placed = new Set<string>();
  const tripDates: string[] = [];
  for (let d = arrivalDate; d <= departureDate; d = addDays(d, 1)) tripDates.push(d);
  const quota = Math.max(1, Math.ceil(input.activities.length / Math.max(1, tripDates.length)));
  // Activities open on fewer of the remaining days get placed first, so rare openings aren't lost.
  const availability = new Map(
    input.activities.map((a) => [a, tripDates.filter((d) => isAvailableOn(a, d, destTz))]),
  );
  const openDaysFrom = (a: ScheduleActivity, from: string) =>
    availability.get(a)!.filter((d) => d >= from).length;

  for (const d of tripDates) {
    let freeStart = zoned(d, o.dayStart, destTz);
    let freeEnd = zoned(d, o.dayEnd, destTz);
    if (d === arrivalDate && hotelArrive > freeStart) freeStart = hotelArrive;
    if (d === departureDate && transferOutStart < freeEnd) freeEnd = transferOutStart;
    const anchors = [...(anchorsByDay.get(d) ?? [])];

    // Meals (from the spending reserve) where they fit around fixed items.
    for (const [label, [ms, me]] of [
      ["Lunch", o.lunch],
      ["Dinner", o.dinner],
    ] as const) {
      const s = zoned(d, ms, destTz);
      const e = zoned(d, me, destTz);
      if (s < freeStart || e > freeEnd) continue;
      if (anchors.some((a) => a.start < e && s < a.end)) continue;
      push("meal", s, e, destTz, label, {
        details: "Paid from your spending reserve (estimate). Choose a place nearby.",
      });
      anchors.push({ start: s, end: e });
    }
    anchors.sort((a, b) => a.start.getTime() - b.start.getTime());
    if (freeStart >= freeEnd) continue;

    let cursor = freeStart;
    let pos: Location = hotelLoc;
    let placedToday = 0;
    // Anchors before the free window still move the position (e.g. bag drop at the hotel).
    type Win = { end: Date; exit?: Location; anchor?: Anchor; chainExit?: Location; exitGap?: number };
    const windows: Win[] = [];
    for (const a of anchors) {
      if (a.end <= freeStart) continue;
      if (a.start >= freeEnd) break;
      windows.push({ end: a.start, exit: a.location, anchor: a });
    }
    windows.push({ end: freeEnd, exit: hotelLoc });
    // A window that ends at a meal has no place to be. Whatever is placed there must still leave
    // time to reach the next fixed place in the gap after the meal(s).
    for (let i = windows.length - 1, next = -1; i >= 0; i--) {
      if (windows[i].exit) next = i;
      else if (next >= 0) {
        // The window before `next` ends at the last meal; travel happens between that meal and `next`.
        const lastMealEnd = windows[next - 1].anchor!.end;
        windows[i].chainExit = windows[next].exit;
        windows[i].exitGap = minutesBetween(lastMealEnd, windows[next].end);
      }
    }

    for (const w of windows) {
      for (;;) {
        let best:
          | {
              idx: number;
              start: Date;
              end: Date;
              scarcity: number;
              tin: ReturnType<typeof travelOrFallback>;
              notes: string[];
            }
          | undefined;
        remaining.forEach((cand, idx) => {
          const { a } = cand;
          if (placed.has(a.evidenceId)) return;
          const isPreferredToday = a.preferredDay === d;
          if (a.preferredDay && a.preferredDay > d) return;
          const scarcity = openDaysFrom(a, d);
          // Over today's quota, only activities with no later chance get in.
          if (!isPreferredToday && placedToday >= quota && scarcity > 1) return;
          const tin = travelOrFallback(pos, a.location, "local");
          const tout = w.exit ? travelOrFallback(a.location, w.exit, "local").minutes : 0;
          if (w.chainExit && travelOrFallback(a.location, w.chainExit, "local").minutes > (w.exitGap ?? 0)) return;
          const earliest = addMinutes(cursor, tin.minutes);
          const latestEnd = addMinutes(w.end, -tout);
          const fit = findStart(a, d, earliest, latestEnd, o.defaultActivityMin);
          if (!fit) return;
          const better =
            !best ||
            scarcity < best.scarcity ||
            (scarcity === best.scarcity &&
              (fit.start < best.start ||
                (fit.start.getTime() === best.start.getTime() && cand.order < remaining[best.idx].order)));
          if (better) best = { idx, start: fit.start, end: fit.end, scarcity, tin, notes: fit.notes };
        });
        if (!best) break;
        const { a } = remaining[best.idx];
        if (best.tin.minutes > 0) {
          push("travel", addMinutes(best.start, -best.tin.minutes), best.start, destTz, `Travel to ${a.title}`, {
            details: `${best.tin.minutes} min.`,
            travelTimeEvidenceId: best.tin.evidenceId,
            notes: best.tin.estimate ? [ESTIMATE_NOTE] : [],
          });
        }
        push("activity", best.start, best.end, destTz, a.title, {
          evidenceId: a.evidenceId,
          location: a.location,
          notes: best.notes,
        });
        placed.add(a.evidenceId);
        placedToday++;
        cursor = best.end;
        pos = a.location;
      }
      if (w.exit && !sameLocation(pos, w.exit)) {
        const back = travelOrFallback(pos, w.exit, "local");
        const arrive = addMinutes(cursor, back.minutes);
        push("travel", cursor, arrive, destTz, `Travel to ${w.exit.name ?? "your hotel"}`, {
          details: `${back.minutes} min.`,
          travelTimeEvidenceId: back.evidenceId,
          notes: back.estimate ? [ESTIMATE_NOTE] : [],
        });
        pos = w.exit;
      }
      if (w.anchor) {
        cursor = w.anchor.end > cursor ? w.anchor.end : cursor;
        if (w.anchor.location) pos = w.anchor.location;
      }
    }
  }

  // ---- Departure ----
  push("transfer", transferOutStart, atAirportBack, destTz, `Transfer to ${retAirport.name}`, {
    location: hotelLoc,
    details: `${transferOut.minutes} min to the airport. Price not included.`,
    travelTimeEvidenceId: transferOut.evidenceId,
    notes: transferOut.estimate ? [ESTIMATE_NOTE] : [],
  });
  push("airport_arrival", atAirportBack, inDepart, destTz, `Arrive at ${retAirport.name}`, {
    location: retAirport,
    details: `${airportBuffer / 60} hours before departure, for check-in and security.`,
  });
  pushLeg(input.inbound, { from: destTz, to: originTz });

  items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end));
  const unscheduled = input.activities
    .filter((a) => !placed.has(a.evidenceId))
    .map((a) => ({
      evidenceId: a.evidenceId,
      title: a.title,
      reason:
        a.openingHours || a.timeSlots
          ? "No free time on your trip days falls inside its opening hours or available slots."
          : "Not enough free time on your trip days.",
    }));

  return {
    itinerary: {
      days: [...new Set(items.map((i) => i.day))].sort(),
      items,
      generatedAt: toIsoWithOffset(input.now ?? new Date(), "UTC"),
    },
    unscheduled,
  };
}

function isAvailableOn(a: ScheduleActivity, date: string, tz: string): boolean {
  if (a.timeSlots?.length) return a.timeSlots.some((s) => localParts(new Date(s.start), tz).date === date);
  if (a.openingHours) return openIntervalsOn(date, a.openingHours).length > 0;
  return true;
}

function findStart(
  a: ScheduleActivity,
  date: string,
  earliest: Date,
  latestEnd: Date,
  defaultMin: number,
): { start: Date; end: Date; notes: string[] } | undefined {
  const notes: string[] = [];
  const dur = a.durationMinutes ?? defaultMin;
  if (!a.durationMinutes) notes.push(`Duration not provided by source; ${defaultMin} min allowed (estimate).`);

  if (a.timeSlots?.length) {
    for (const s of [...a.timeSlots].sort((x, y) => Date.parse(x.start) - Date.parse(y.start))) {
      const start = new Date(s.start);
      const end = s.end ? new Date(s.end) : addMinutes(start, dur);
      if (start >= earliest && end <= latestEnd) return { start, end, notes };
    }
    return undefined;
  }
  if (a.openingHours) {
    for (const i of openIntervalsOn(date, a.openingHours)) {
      const start = i.start > earliest ? i.start : earliest;
      const end = addMinutes(start, dur);
      if (end <= i.end && end <= latestEnd) return { start, end, notes };
    }
    return undefined;
  }
  notes.push("Opening hours not provided by source. Check before you go.");
  const end = addMinutes(earliest, dur);
  return end <= latestEnd ? { start: earliest, end, notes } : undefined;
}

/** Problems with a schedule: overlaps, or activities outside their opening hours or slots. */
export function validateSchedule(items: ItineraryItem[], activities: Map<string, ScheduleActivity>): string[] {
  const problems: string[] = [];
  const sorted = [...items].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (Date.parse(cur.start) < Date.parse(prev.end) && Date.parse(cur.end) > Date.parse(cur.start)) {
      problems.push(`"${cur.title}" overlaps "${prev.title}"`);
    }
  }
  for (const it of items) {
    if (Date.parse(it.end) < Date.parse(it.start)) problems.push(`"${it.title}" ends before it starts`);
    if (it.type !== "activity" || !it.evidenceId) continue;
    const a = activities.get(it.evidenceId);
    if (!a) continue;
    const s = new Date(it.start);
    const e = new Date(it.end);
    if (a.timeSlots?.length) {
      if (!a.timeSlots.some((t) => Date.parse(t.start) === s.getTime())) {
        problems.push(`"${it.title}" isn't at one of its available slots`);
      }
    } else if (a.openingHours && !isWithinOpeningHours(s, e, a.openingHours)) {
      problems.push(`"${it.title}" is outside its opening hours`);
    }
  }
  return problems;
}
