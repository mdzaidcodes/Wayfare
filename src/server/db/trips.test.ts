import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StoredTrip } from "@/lib/schemas/storage";
import { SCHEMA_SQL } from "./schema";
import { deleteTrip, listTrips, saveTrip } from "./trips";

// Runs against a real PostgreSQL when TEST_DATABASE_URL is set (its trip tables are emptied first);
// skipped otherwise. Create one with: DATABASE_URL=<url> npm run db:setup
const url = process.env.TEST_DATABASE_URL;
let pool: Pool;

const trip = (id: string, stages: string[]): StoredTrip =>
  StoredTrip.parse({
    trip: {
      id,
      name: "Lisbon in December",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-02T11:30:00.123Z",
      status: "planning",
      stage: "flights",
      brief: { destination: { name: "Lisbon" }, interests: ["food"] },
      intake: { text: "Lisbon", form: {}, answers: [{ field: "budget", answer: "2000 EUR" }] },
    },
    options: stages.map((stage) => ({ tripId: id, stage, fetchedAt: "2026-10-02T11:00:00.000Z", extra: [], result: { stage, options: [] } })),
    selections: { tripId: id, flightId: "ev_1", activityIds: ["ev_2"] },
    checklist: { tripId: id, items: [{ evidenceId: "ev_1", booked: true }] },
  });

describe.skipIf(!url)("saved trips in PostgreSQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(SCHEMA_SQL);
    await pool.query("truncate trips cascade");
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("returns exactly what was saved", async () => {
    const t = trip("trip-a", ["flights", "stay"]);
    await saveTrip(pool, t);
    const [back] = await listTrips(pool);
    expect(back).toEqual(t);
  });

  it("saving again replaces the trip, including rows it no longer has", async () => {
    const t = trip("trip-a", ["flights"]);
    delete t.checklist;
    t.trip.name = "Renamed";
    await saveTrip(pool, t);
    const [back] = await listTrips(pool);
    expect(back.trip.name).toBe("Renamed");
    expect(back.options.map((o) => o.stage)).toEqual(["flights"]);
    expect(back.checklist).toBeUndefined();
  });

  it("deleting a trip removes all its rows", async () => {
    await deleteTrip(pool, "trip-a");
    expect(await listTrips(pool)).toEqual([]);
    const left = await pool.query("select count(*)::int as n from trip_options");
    expect(left.rows[0].n).toBe(0);
  });
});
