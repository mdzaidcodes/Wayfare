import type { TripBrief, TripStatus } from "./schemas/trip";

export function formatDateRange(b: TripBrief | undefined, locale?: string): string {
  const d = b?.dates;
  if (!d) return "Dates not set";
  if (d.type === "flexible") return d.description;
  const f = (s: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`));
  const sameYear = d.departDate.slice(0, 4) === d.returnDate.slice(0, 4);
  return `${f(d.departDate, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })} – ${f(d.returnDate, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** Wall-clock time and date as written in the ISO string's own offset (i.e. that place's local time). */
export function localTime(iso: string): string {
  return iso.slice(11, 16);
}

export function localDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso.slice(0, 10)}T12:00:00Z`),
  );
}

/** Days between local dates of two ISO strings, for "+1" next-day markers. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

export function fetchedLabel(iso: string, locale?: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export const STATUS_LABEL: Record<TripStatus, string> = {
  planning: "Planning",
  ready: "Ready",
  in_progress: "In progress",
};
