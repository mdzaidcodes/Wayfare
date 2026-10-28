import { z } from "zod";

// A whole trip as one document: what the browser sends to be saved and gets back when it loads.
// Shapes are checked loosely here; the evidence inside is signed and verified when it's used.

const Row = z.object({ tripId: z.string() }).passthrough();

export const StoredTrip = z.object({
  trip: z
    .object({
      id: z.string().min(1).max(100),
      name: z.string().max(200),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
      status: z.string().max(40),
      stage: z.string().max(40),
      intake: z.object({}).passthrough(),
    })
    .passthrough(),
  options: z.array(Row.extend({ stage: z.string().max(40), fetchedAt: z.string().datetime() })).max(10),
  selections: Row.optional(),
  itinerary: Row.optional(),
  checklist: Row.extend({ items: z.array(z.unknown()) }).optional(),
});
export type StoredTrip = z.infer<typeof StoredTrip>;
