// npm run db:setup — creates the database named in DATABASE_URL (if missing) and its tables.
// Safe to run again: nothing is dropped.
import pg from "pg";
import { SCHEMA_SQL } from "../src/server/db/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local, e.g.\n  DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/wayfare");
  process.exit(1);
}

const target = new URL(url);
const name = decodeURIComponent(target.pathname.slice(1));
if (!/^[\w-]+$/.test(name)) {
  console.error(`"${name}" isn't a database name this script can create. Use letters, numbers, - or _.`);
  process.exit(1);
}

// Connect to the server's default database to create ours.
const admin = new URL(url);
admin.pathname = "/postgres";
const server = new pg.Client({ connectionString: admin.toString() });
try {
  await server.connect();
} catch (e) {
  console.error(`Couldn't connect to PostgreSQL at ${target.host}: ${e instanceof Error ? e.message : e}`);
  console.error("Check that PostgreSQL is running and that the user name and password in DATABASE_URL are right.");
  process.exit(1);
}
const exists = await server.query("select 1 from pg_database where datname = $1", [name]);
if (exists.rowCount) console.log(`✔ database "${name}" already exists`);
else {
  await server.query(`create database "${name}"`);
  console.log(`✔ created database "${name}"`);
}
await server.end();

const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query(SCHEMA_SQL);
const tables = await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_name like 'trip%' order by 1");
console.log(`✔ tables ready: ${tables.rows.map((r) => r.table_name).join(", ")}`);
await db.end();
