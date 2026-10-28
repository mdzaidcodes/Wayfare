// Tables for saved trips. One row per trip, plus one row per piece the trip is built from.
// Facts stay inside the signed evidence records (JSONB), exactly as the browser stores them.

export const SCHEMA_SQL = `
create table if not exists trips (
  id          text primary key,
  name        text not null,
  status      text not null,
  stage       text not null,
  brief       jsonb,
  budget_plan jsonb,
  intake      jsonb not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null
);
create index if not exists trips_created_at_idx on trips (created_at desc);

create table if not exists trip_options (
  trip_id    text not null references trips (id) on delete cascade,
  stage      text not null,
  data       jsonb not null,
  fetched_at timestamptz not null,
  primary key (trip_id, stage)
);

create table if not exists trip_selections (
  trip_id text primary key references trips (id) on delete cascade,
  data    jsonb not null
);

create table if not exists trip_itineraries (
  trip_id text primary key references trips (id) on delete cascade,
  data    jsonb not null
);

create table if not exists trip_checklists (
  trip_id text primary key references trips (id) on delete cascade,
  items   jsonb not null
);
`;
