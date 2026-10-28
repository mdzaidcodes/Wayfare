import { describe, expect, it } from "vitest";
import { flight } from "../../../test/builders";
import type { Location } from "../schemas/common";
import type { OpeningHours } from "../schemas/evidence";
import { isWithinOpeningHours, openIntervalsOn } from "./hours";
import { buildSchedule, sameLocation, validateSchedule, type ScheduleActivity, type ScheduleInput } from "./scheduler";
import { zoned } from "../time";

const TZ = "Europe/Lisbon";
const hotelLoc: Location = { name: "Hotel Test", point: { lat: 38.71, lng: -9.14 }, timeZone: TZ };
const place = (name: string, lat: number): Location => ({ name, point: { lat, lng: -9.1 }, timeZone: TZ });
const everyDay = (open: string, close: string, days = [0, 1, 2, 3, 4, 5, 6]): OpeningHours => ({
  timeZone: TZ,
  periods: days.map((day) => ({ day, open, close })),
});

const f = flight(400); // LHR 07:00 → LIS 09:45 on Tue 10 Mar; back 20:00 on Sat 14 Mar

function input(activities: ScheduleActivity[], over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    flightEvidenceId: f.id,
    outbound: f.data.outbound,
    inbound: f.data.inbound,
    international: true,
    origin: { name: "London", timeZone: "Europe/London" },
    destinationTimeZone: TZ,
    hotel: { evidenceId: "ev_hotel01", name: "Hotel Test", location: hotelLoc, checkInTime: "15:00", checkOutTime: "11:00" },
    activities,
    travel: (a, b, purpose) => ({ minutes: purpose === "airport" ? 30 : 20, evidenceId: `ev_tt_${a.name}_${b.name}` }),
    buffers: { airportInternationalMin: 180, airportDomesticMin: 120, arrivalInternationalMin: 60, arrivalDomesticMin: 30 },
    now: new Date("2026-03-01T00:00:00Z"),
    ...over,
  };
}

const acts: ScheduleActivity[] = [
  { evidenceId: "ev_museum1", title: "Museum", location: place("Museum", 38.69), durationMinutes: 120, openingHours: everyDay("10:00", "18:00", [0, 2, 3, 4, 5, 6]) },
  { evidenceId: "ev_wedonly", title: "Wednesday-only garden", location: place("Garden", 38.72), durationMinutes: 60, openingHours: everyDay("10:00", "12:00", [3]) },
  {
    evidenceId: "ev_tour001",
    title: "Tram tour",
    location: place("Tram", 38.73),
    durationMinutes: 90,
    timeSlots: [{ start: "2026-03-12T14:00:00+00:00", end: "2026-03-12T15:30:00+00:00" }],
  },
  { evidenceId: "ev_viewpt1", title: "Viewpoint", location: place("Viewpoint", 38.74), durationMinutes: 45 },
];

describe("buildSchedule", () => {
  const { itinerary, unscheduled } = buildSchedule(input(acts));
  const byType = (t: string) => itinerary.items.filter((i) => i.type === t);

  it("includes every Feature 9 item", () => {
    for (const t of [
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
    ]) {
      expect(byType(t).length, t).toBeGreaterThan(0);
    }
    expect(byType("flight")).toHaveLength(2);
    expect(byType("transfer")).toHaveLength(2);
    expect(byType("airport_arrival")).toHaveLength(2);
    expect(unscheduled).toEqual([]);
  });

  it("never overlaps and respects opening hours and slots", () => {
    const map = new Map(acts.map((a) => [a.evidenceId, a]));
    expect(validateSchedule(itinerary.items, map)).toEqual([]);
  });

  it("puts the airport arrival 3 hours before an international departure", () => {
    const [arr] = byType("airport_arrival");
    expect(arr.start).toBe("2026-03-10T04:00:00+00:00");
    expect(arr.end).toBe("2026-03-10T07:00:00+00:00");
    expect(byType("leave_for_airport")[0].start).toBe("2026-03-10T03:30:00+00:00");
  });

  it("drops bags before check-in when arriving early, and notes it isn't guaranteed", () => {
    const [drop] = byType("bag_drop");
    // Land 09:45, +60 immigration, +30 transfer
    expect(drop.start).toBe("2026-03-10T11:15:00+00:00");
    expect(drop.notes?.join(" ")).toMatch(/isn't guaranteed/);
    expect(byType("checkin")[0].start).toBe("2026-03-10T15:00:00+00:00");
  });

  it("schedules the Wednesday-only place on Wednesday inside its hours and the tour at its slot", () => {
    const garden = itinerary.items.find((i) => i.evidenceId === "ev_wedonly")!;
    expect(garden.day).toBe("2026-03-11");
    expect(garden.start >= "2026-03-11T10:00").toBe(true);
    expect(garden.end <= "2026-03-11T12:00:00+00:00").toBe(true);
    const tour = itinerary.items.find((i) => i.evidenceId === "ev_tour001")!;
    expect(tour.start).toBe("2026-03-12T14:00:00+00:00");
  });

  it("uses routing evidence for travel times", () => {
    expect(byType("travel").every((t) => t.travelTimeEvidenceId?.startsWith("ev_tt_"))).toBe(true);
  });

  it("handles a late flight with bag storage and a transfer timed back from the airport buffer", () => {
    const [, back] = byType("transfer");
    expect(back.start).toBe("2026-03-14T16:30:00+00:00");
    expect(byType("bag_storage")[0].day).toBe("2026-03-14");
  });

  it("reports activities that can't fit instead of forcing them", () => {
    const r = buildSchedule(
      input([
        {
          evidenceId: "ev_nofit01",
          title: "Sold out",
          location: place("X", 38.75),
          durationMinutes: 60,
          timeSlots: [{ start: "2026-04-01T10:00:00+00:00" }],
        },
      ]),
    );
    expect(r.unscheduled).toHaveLength(1);
    expect(r.unscheduled[0].reason).toMatch(/opening hours or available slots/);
  });

  it("marks fallback travel estimates when the routing source has nothing", () => {
    const r = buildSchedule(input(acts.slice(0, 1), { travel: () => undefined }));
    const leave = r.itinerary.items.find((i) => i.type === "leave_for_airport")!;
    expect(leave.notes?.[0]).toMatch(/Estimate/);
    expect(leave.travelTimeEvidenceId).toBeUndefined();
  });

  it("notes a missing check-in time instead of guessing", () => {
    const r = buildSchedule(input([], { hotel: { evidenceId: "ev_hotel01", name: "H", location: hotelLoc } }));
    const ci = r.itinerary.items.find((i) => i.type === "checkin")!;
    expect(ci.notes?.[0]).toMatch(/not provided by source/);
  });

  it("shows times in each place's own zone", () => {
    const tokyo = flight(900, {
      outbound: {
        segments: [
          {
            airline: "JAL",
            from: { code: "LHR", timeZone: "Europe/London" },
            to: { code: "HND", timeZone: "Asia/Tokyo" },
            departLocal: "2026-03-10T19:00:00+00:00",
            arriveLocal: "2026-03-11T16:30:00+09:00",
          },
        ],
        durationMinutes: 810,
        stops: 0,
        layovers: [],
      },
      inbound: {
        segments: [
          {
            airline: "JAL",
            from: { code: "HND", timeZone: "Asia/Tokyo" },
            to: { code: "LHR", timeZone: "Europe/London" },
            departLocal: "2026-03-16T11:00:00+09:00",
            arriveLocal: "2026-03-16T15:30:00+00:00",
          },
        ],
        durationMinutes: 870,
        stops: 0,
        layovers: [],
      },
    });
    const tokyoHotel: Location = { name: "Tokyo Hotel", point: { lat: 35.68, lng: 139.76 }, timeZone: "Asia/Tokyo" };
    const r = buildSchedule(
      input([], {
        flightEvidenceId: tokyo.id,
        outbound: tokyo.data.outbound,
        inbound: tokyo.data.inbound,
        destinationTimeZone: "Asia/Tokyo",
        hotel: { evidenceId: "ev_hotel02", name: "Tokyo Hotel", location: tokyoHotel, checkInTime: "15:00", checkOutTime: "11:00" },
      }),
    );
    const ci = r.itinerary.items.find((i) => i.type === "checkin")!;
    expect(ci.start).toMatch(/\+09:00$/);
    expect(ci.day).toBe("2026-03-11");
    expect(r.itinerary.items.find((i) => i.type === "leave_for_airport")!.start).toMatch(/\+00:00$/);
    // Early flight: checkout is pulled before the 07:30 transfer.
    const co = r.itinerary.items.find((i) => i.type === "checkout")!;
    expect(co.start).toBe("2026-03-16T07:15:00+09:00");
    expect(validateSchedule(r.itinerary.items, new Map())).toEqual([]);
  });
});

describe("scheduler property check", () => {
  // Seeded random activities with random hours, slots and travel times: the schedule must never overlap
  // and every placed activity must sit inside its hours or on a slot.
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  it("holds for 200 random trips", () => {
    for (let run = 0; run < 200; run++) {
      const n = 1 + Math.floor(rnd() * 10);
      const list: ScheduleActivity[] = [];
      for (let i = 0; i < n; i++) {
        const kind = rnd();
        const a: ScheduleActivity = {
          evidenceId: `ev_r${run}_${i}x`,
          title: `A${i}`,
          location: place(`P${i}`, 38.6 + rnd() * 0.2),
          durationMinutes: rnd() < 0.2 ? undefined : 30 + Math.floor(rnd() * 200),
        };
        if (kind < 0.5) {
          const open = 6 * 60 + Math.floor(rnd() * 8) * 60;
          const close = (open + 60 + Math.floor(rnd() * 12) * 60) % (24 * 60);
          a.openingHours = everyDay(hhmm(open), hhmm(close), [0, 1, 2, 3, 4, 5, 6].filter(() => rnd() < 0.7));
        } else if (kind < 0.7) {
          const day = 10 + Math.floor(rnd() * 5);
          const start = 8 + Math.floor(rnd() * 12);
          a.timeSlots = [{ start: `2026-03-${day}T${String(start).padStart(2, "0")}:00:00+00:00` }];
        }
        list.push(a);
      }
      const travelMins = 5 + Math.floor(rnd() * 60);
      const { itinerary } = buildSchedule(
        input(list, { travel: (x, y, p) => ({ minutes: p === "airport" ? 45 : travelMins, evidenceId: "ev_tt_r" }) }),
      );
      const problems = validateSchedule(itinerary.items, new Map(list.map((a) => [a.evidenceId, a])));
      expect(problems, `run ${run}`).toEqual([]);
    }
  });
});

describe("opening hours", () => {
  it("handles places that close after midnight", () => {
    const bar = everyDay("20:00", "02:00");
    expect(isWithinOpeningHours(zoned("2026-03-10", "23:00", TZ), zoned("2026-03-11", "01:30", TZ), bar)).toBe(true);
    expect(isWithinOpeningHours(zoned("2026-03-11", "01:00", TZ), zoned("2026-03-11", "03:00", TZ), bar)).toBe(false);
    expect(openIntervalsOn("2026-03-11", bar)).toHaveLength(2);
  });

  it("treats closed days as closed", () => {
    const monClosed = everyDay("10:00", "18:00", [0, 2, 3, 4, 5, 6]);
    expect(isWithinOpeningHours(zoned("2026-03-16", "11:00", TZ), zoned("2026-03-16", "12:00", TZ), monClosed)).toBe(false);
  });
});

describe("sameLocation", () => {
  it("matches by place id or nearby point", () => {
    expect(sameLocation({ placeId: "a" }, { placeId: "a" })).toBe(true);
    expect(sameLocation(hotelLoc, { ...hotelLoc, point: { lat: 38.7101, lng: -9.14 } })).toBe(true);
    expect(sameLocation(hotelLoc, place("Far", 38.8))).toBe(false);
  });
});
