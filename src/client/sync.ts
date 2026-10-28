"use client";
import { useSyncExternalStore } from "react";
import { db } from "./db";
import { replaceTrip, snapshot, type TripSnapshot } from "./trips";

// Mirrors trips to PostgreSQL through /api/trips. IndexedDB stays the working copy, so the app
// keeps working offline; changes are pushed a moment after they happen and retried when back online.
// On start, saved trips this browser doesn't have (or has an older copy of) are pulled in.

export type SyncStatus = "unknown" | "off" | "saved" | "saving" | "offline" | "error";

const PUSH_DELAY_MS = 600;
const RETRY_MS = 15_000;

let status: SyncStatus = "unknown";
const listeners = new Set<() => void>();
const dirty = new Set<string>();
/** Trips being written by sync itself, whose changes shouldn't be pushed back. */
const quiet = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
/** Pushing waits for the first pull, so an older local copy never overwrites a newer saved one. */
let pulled = false;

function setStatus(s: SyncStatus) {
  status = s;
  for (const l of listeners) l();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => "unknown",
  );
}

function mark(tripId: unknown) {
  if (typeof tripId !== "string" || quiet.has(tripId) || status === "off") return;
  dirty.add(tripId);
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), PUSH_DELAY_MS);
}

/** Watches every table that holds part of a trip. */
function watch() {
  const d = db();
  d.trips.hook("creating", (id) => mark(id));
  d.trips.hook("updating", (_mods, id) => mark(id));
  d.trips.hook("deleting", (id) => mark(id));
  for (const t of [d.options, d.selections, d.itinerary, d.bookingChecklist] as const) {
    const table = t as unknown as typeof d.selections;
    table.hook("creating", (_key, row) => mark(row.tripId));
    table.hook("updating", (_mods, _key, row) => mark(row.tripId));
    table.hook("deleting", (_key, row) => mark(row?.tripId));
  }
}

async function call(url: string, init?: RequestInit): Promise<Response | "off"> {
  const res = await fetch(url, init);
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === "storage_off") return "off";
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

let flushing: Promise<void> | undefined;

/** Pushes pending trips; one push at a time, and one more if changes arrived meanwhile. */
async function flush(): Promise<void> {
  if (flushing) {
    await flushing;
    return flush();
  }
  flushing = push().finally(() => (flushing = undefined));
  return flushing;
}

async function push() {
  if (!dirty.size || !pulled || status === "off") return;
  if (!navigator.onLine) return setStatus("offline");
  setStatus("saving");
  for (const id of [...dirty]) {
    dirty.delete(id);
    try {
      // A change to any part of the trip makes the whole trip newer, so other browsers pick it up.
      quiet.add(id);
      try {
        await db().trips.update(id, { updatedAt: new Date().toISOString() });
      } finally {
        quiet.delete(id);
      }
      const snap = await snapshot(id);
      const r = snap
        ? await call(`/api/trips/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snap) })
        : await call(`/api/trips/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r === "off") {
        dirty.clear();
        return setStatus("off");
      }
    } catch {
      dirty.add(id);
      if (!navigator.onLine) return setStatus("offline");
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), RETRY_MS);
      return setStatus("error");
    }
  }
  setStatus(dirty.size ? "saving" : "saved");
}

/** Pulls saved trips in, then pushes local trips the database doesn't have yet. */
async function pull() {
  let res: Response | "off";
  try {
    res = await call("/api/trips");
  } catch {
    if (navigator.onLine) setTimeout(() => void pull(), RETRY_MS);
    return setStatus(navigator.onLine ? "error" : "offline");
  }
  if (res === "off") return setStatus("off");
  const { enabled, trips } = (await res.json()) as { enabled: boolean; trips: TripSnapshot[] };
  if (!enabled) return setStatus("off");
  const saved = new Set<string>();
  for (const s of trips) {
    saved.add(s.trip.id);
    const local = await db().trips.get(s.trip.id);
    if (local && local.updatedAt >= s.trip.updatedAt) {
      if (local.updatedAt > s.trip.updatedAt) dirty.add(local.id);
      continue;
    }
    quiet.add(s.trip.id);
    try {
      await replaceTrip(s);
    } finally {
      quiet.delete(s.trip.id);
    }
  }
  for (const t of await db().trips.toArray()) if (!saved.has(t.id)) dirty.add(t.id);
  pulled = true;
  setStatus("saved");
  await flush();
}

/** Starts syncing once per page. Safe to call again. */
export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  watch();
  window.addEventListener("online", () => {
    if (!pulled) void pull();
    else void flush();
  });
  void pull();
}
