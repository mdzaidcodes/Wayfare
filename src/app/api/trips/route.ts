import { connection } from "next/server";
import { databaseConfigured } from "@/server/db/pool";
import { withDb } from "@/server/db/routes";
import { listTrips } from "@/server/db/trips";

/** Every saved trip, so a browser with an empty or older copy can catch up. */
export async function GET() {
  await connection();
  // Not an error: without a database the browser simply keeps trips to itself.
  if (!databaseConfigured()) return Response.json({ enabled: false, trips: [] });
  return withDb(async (pool) => Response.json({ enabled: true, trips: await listTrips(pool) }));
}
