// Small time-zone toolkit on top of Intl, so no time-zone library is needed.
// Instants are Date objects; wall-clock values are (date "YYYY-MM-DD", time "HH:MM", IANA zone).

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface LocalParts {
  date: string;
  time: string;
  /** 0 = Sunday */
  weekday: number;
  minutesOfDay: number;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(dtf(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    minutesOfDay: Number(hour) * 60 + Number(parts.minute),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +60 for CET). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const p = Object.fromEntries(dtf(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour === "24" ? "0" : p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Instant for a wall-clock time in a zone. Nonexistent DST-gap times move forward. */
export function zoned(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = offsetMinutes(new Date(guess), timeZone);
  let instant = guess - off * 60000;
  const off2 = offsetMinutes(new Date(instant), timeZone);
  if (off2 !== off) {
    off = off2;
    instant = guess - off * 60000;
  }
  return new Date(instant);
}

export function toIsoWithOffset(instant: Date, timeZone: string): string {
  const { date, time } = localParts(instant, timeZone);
  const off = offsetMinutes(instant, timeZone);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const ss = String(new Date(instant).getUTCSeconds()).padStart(2, "0");
  return `${date}T${time}:${ss}${sign}${hh}:${mm}`;
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);
export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
