import { z } from "zod";

export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. EUR");

export const Money = z.object({
  amount: z.number().nonnegative().finite(),
  currency: CurrencyCode,
});
export type Money = z.infer<typeof Money>;

/** ISO 8601 timestamp that carries its UTC offset, e.g. 2026-03-10T09:15:00+01:00. */
export const IsoWithOffset = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    "ISO timestamp with offset",
  );

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
export const IanaTimeZone = z.string().min(1);

/** Only http(s) URLs are accepted from providers; anything else (javascript:, data:) is rejected. */
export const HttpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "http(s) URL only");

export const GeoPoint = z.object({ lat: z.number(), lng: z.number() });

export const Location = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  point: GeoPoint.optional(),
  placeId: z.string().optional(),
  timeZone: IanaTimeZone.optional(),
});
export type Location = z.infer<typeof Location>;

export const Photo = z.object({
  /** Either a direct provider URL or an internal proxy path (/api/photo/...). */
  url: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  attribution: z.string().optional(),
});
export type Photo = z.infer<typeof Photo>;
