import "server-only";
import { Pool } from "pg";
import { getEnv } from "../env";
import { SCHEMA_SQL } from "./schema";

let pool: Pool | undefined;
let ready: Promise<Pool> | undefined;

/** True when DATABASE_URL is set. Without it, trips live in the browser only. */
export function databaseConfigured(): boolean {
  return Boolean(getEnv().DATABASE_URL);
}

/** The shared pool, with tables created on first use. */
export function getPool(url = getEnv().DATABASE_URL): Promise<Pool> {
  if (!url) throw new Error("DATABASE_URL is not set.");
  ready ??= (async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    try {
      await pool.query(SCHEMA_SQL);
      return pool;
    } catch (e) {
      // Let the next request try again (for example once Postgres is started).
      ready = undefined;
      await pool.end().catch(() => {});
      throw e;
    }
  })();
  return ready;
}
