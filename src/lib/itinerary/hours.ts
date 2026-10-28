import type { OpeningHours } from "../schemas/evidence";
import { addDays, localParts, zoned } from "../time";

export interface Interval {
  start: Date;
  end: Date;
}

/** Concrete open intervals that touch the local date `date` (including ones that began the day before). */
export function openIntervalsOn(date: string, hours: OpeningHours): Interval[] {
  const tz = hours.timeZone;
  if (hours.alwaysOpen) {
    return [{ start: zoned(date, "00:00", tz), end: zoned(addDays(date, 1), "00:00", tz) }];
  }
  const out: Interval[] = [];
  for (const d of [addDays(date, -1), date]) {
    const weekday = localParts(zoned(d, "12:00", tz), tz).weekday;
    for (const p of hours.periods) {
      if (p.day !== weekday) continue;
      const start = zoned(d, p.open, tz);
      const closesNextDay = p.close <= p.open;
      const end = zoned(closesNextDay ? addDays(d, 1) : d, p.close, tz);
      out.push({ start, end });
    }
  }
  const dayStart = zoned(date, "00:00", tz).getTime();
  const dayEnd = zoned(addDays(date, 1), "00:00", tz).getTime();
  return out
    .filter((i) => i.end.getTime() > dayStart && i.start.getTime() < dayEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** True when [start, end] lies wholly inside one open interval. */
export function isWithinOpeningHours(start: Date, end: Date, hours: OpeningHours): boolean {
  const date = localParts(start, hours.timeZone).date;
  return openIntervalsOn(date, hours).some(
    (i) => i.start.getTime() <= start.getTime() && end.getTime() <= i.end.getTime(),
  );
}
