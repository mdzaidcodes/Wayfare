import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripSnapshot } from "./trips";

// The sync module keeps per-page state, so each test loads fresh copies of it and of the database.

let n = 0;
let saved: Map<string, TripSnapshot>;
let storageOff: boolean;
let requests: string[];

async function load() {
  vi.resetModules();
  const dbm = await import("./db");
  dbm.setDb(new dbm.WayfareDB(`sync-${++n}`));
  return { ...dbm, ...(await import("./trips")), ...(await import("./sync")) };
}

const until = async (check: () => Promise<boolean> | boolean) => {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
};

beforeEach(() => {
  saved = new Map();
  storageOff = false;
  requests = [];
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url === "/api/trips") return Response.json({ enabled: !storageOff, trips: storageOff ? [] : [...saved.values()] });
    if (storageOff) return Response.json({ code: "storage_off" }, { status: 503 });
    const id = decodeURIComponent(url.split("/").pop()!);
    if (method === "PUT") saved.set(id, JSON.parse(String(init!.body)));
    if (method === "DELETE") saved.delete(id);
    return new Response(null, { status: 204 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("trip sync with the database", () => {
  it("pulls saved trips this browser doesn't have", async () => {
    saved.set("t1", {
      trip: { id: "t1", name: "From the database", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", status: "planning", stage: "basics", intake: { text: "", form: {}, answers: [] } },
      options: [],
      selections: { tripId: "t1", activityIds: ["a"] },
    });
    const m = await load();
    m.startSync();
    await until(async () => Boolean(await m.db().trips.get("t1")));
    expect((await m.db().selections.get("t1"))?.activityIds).toEqual(["a"]);
    // Pulling doesn't push the same trip straight back.
    await new Promise((r) => setTimeout(r, 800));
    expect(requests.filter((r) => r.startsWith("PUT"))).toEqual([]);
  });

  it("saves new trips and changes, and removes deleted ones", async () => {
    const m = await load();
    m.startSync();
    const t = await m.createTrip("Lisbon");
    await until(() => saved.has(t.id));
    await m.db().selections.put({ tripId: t.id, activityIds: ["x"] });
    await until(() => saved.get(t.id)?.selections?.activityIds[0] === "x");
    await m.deleteTrip(t.id);
    await until(() => !saved.has(t.id));
  });

  it("stays local when no database is configured", async () => {
    storageOff = true;
    const m = await load();
    m.startSync();
    await m.createTrip("Local only");
    await new Promise((r) => setTimeout(r, 800));
    expect(requests).toEqual(["GET /api/trips"]);
  });
});
