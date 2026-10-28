import "server-only";
import type { Pool } from "pg";
import { toApiError } from "../http/errors";
import { databaseConfigured, getPool } from "./pool";

/** Runs a storage request, answering 503 when the database is off or can't be reached. */
export async function withDb(fn: (pool: Pool) => Promise<Response>): Promise<Response> {
  if (!databaseConfigured()) {
    return Response.json(
      { code: "storage_off", message: "Trips are saved in this browser only.", nextStep: "Set DATABASE_URL in .env.local to save them in PostgreSQL." },
      { status: 503 },
    );
  }
  try {
    return await fn(await getPool());
  } catch (e) {
    const err = toApiError(e);
    console.error(`[db] ${err.message}`);
    return Response.json(
      { code: "storage_unavailable", message: `Couldn't reach the database: ${err.message}`, nextStep: "Check that PostgreSQL is running and DATABASE_URL is right." },
      { status: 503 },
    );
  }
}
