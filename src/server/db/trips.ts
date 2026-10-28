import "server-only";
import type { Pool, PoolClient } from "pg";
import type { StoredTrip } from "@/lib/schemas/storage";

// Saved trips in PostgreSQL. The browser's IndexedDB is the working copy; this is the durable one.

type Json = Record<string, unknown>;

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);

/** Every saved trip, newest first, in the same shape the browser stores. */
export async function listTrips(pool: Pool): Promise<StoredTrip[]> {
  const [trips, options, selections, itineraries, checklists] = await Promise.all([
    pool.query("select * from trips order by created_at desc"),
    pool.query("select * from trip_options"),
    pool.query("select * from trip_selections"),
    pool.query("select * from trip_itineraries"),
    pool.query("select * from trip_checklists"),
  ]);
  const byTrip = <T>(rows: Json[], map: (r: Json) => T) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.trip_id as string, [...(m.get(r.trip_id as string) ?? []), map(r)]);
    return m;
  };
  const opts = byTrip(options.rows, (r) => ({ ...(r.data as Json), tripId: r.trip_id, stage: r.stage, fetchedAt: iso(r.fetched_at as Date) }));
  const sel = byTrip(selections.rows, (r) => ({ ...(r.data as Json), tripId: r.trip_id }));
  const itin = byTrip(itineraries.rows, (r) => ({ ...(r.data as Json), tripId: r.trip_id }));
  const check = byTrip(checklists.rows, (r) => ({ tripId: r.trip_id, items: r.items as unknown[] }));

  return trips.rows.map((t: Json) => {
    const trip: Json = {
      id: t.id,
      name: t.name,
      status: t.status,
      stage: t.stage,
      intake: t.intake,
      createdAt: iso(t.created_at as Date),
      updatedAt: iso(t.updated_at as Date),
    };
    if (t.brief) trip.brief = t.brief;
    if (t.budget_plan) trip.budgetPlan = t.budget_plan;
    const id = t.id as string;
    return {
      trip,
      options: opts.get(id) ?? [],
      selections: sel.get(id)?.[0],
      itinerary: itin.get(id)?.[0],
      checklist: check.get(id)?.[0],
    } as StoredTrip;
  });
}

/** Replaces everything saved for one trip with this snapshot, in one transaction. */
export async function saveTrip(pool: Pool, s: StoredTrip): Promise<void> {
  const id = s.trip.id;
  const { name, status, stage, intake, createdAt, updatedAt, brief, budgetPlan } = s.trip as Json;
  const without = (row: Json) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "tripId"));
  await tx(pool, async (c) => {
    await c.query(
      `insert into trips (id, name, status, stage, brief, budget_plan, intake, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set name = $2, status = $3, stage = $4, brief = $5, budget_plan = $6, intake = $7, updated_at = $9`,
      [id, name, status, stage, json(brief), json(budgetPlan), json(intake), createdAt, updatedAt],
    );
    await c.query("delete from trip_options where trip_id = $1", [id]);
    for (const o of s.options) {
      const { stage: st, fetchedAt, ...data } = without(o);
      await c.query("insert into trip_options (trip_id, stage, data, fetched_at) values ($1, $2, $3, $4)", [id, st, json(data), fetchedAt]);
    }
    await upsertOrDelete(c, "trip_selections", "data", id, s.selections && without(s.selections));
    await upsertOrDelete(c, "trip_itineraries", "data", id, s.itinerary && without(s.itinerary));
    await upsertOrDelete(c, "trip_checklists", "items", id, s.checklist?.items);
  });
}

export async function deleteTrip(pool: Pool, id: string): Promise<void> {
  // The other tables follow through ON DELETE CASCADE.
  await pool.query("delete from trips where id = $1", [id]);
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

async function upsertOrDelete(c: PoolClient, table: string, column: string, id: string, value: unknown) {
  if (value === undefined) {
    await c.query(`delete from ${table} where trip_id = $1`, [id]);
    return;
  }
  await c.query(`insert into ${table} (trip_id, ${column}) values ($1, $2) on conflict (trip_id) do update set ${column} = $2`, [id, json(value)]);
}

async function tx(pool: Pool, fn: (c: PoolClient) => Promise<void>) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await fn(c);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
