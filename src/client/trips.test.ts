import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { WayfareDB, setDb, db } from "./db";
import { createTrip, deleteTrip, exportAll, importAll, listTrips, renameTrip, restoreTrip } from "./trips";

let n = 0;
beforeEach(() => {
  setDb(new WayfareDB(`test-${++n}`));
});

describe("trip storage", () => {
  it("creates trips newest first and persists them", async () => {
    const a = await createTrip("A");
    await new Promise((r) => setTimeout(r, 5));
    const b = await createTrip("B");
    expect((await listTrips()).map((t) => t.id)).toEqual([b.id, a.id]);
    // A fresh connection to the same database still sees them (persistence across reloads).
    const again = new WayfareDB(`test-${n}`);
    expect(await again.trips.count()).toBe(2);
  });

  it("renames, ignoring empty names", async () => {
    const t = await createTrip("Old");
    await renameTrip(t.id, "  Lisbon in December  ");
    expect((await db().trips.get(t.id))!.name).toBe("Lisbon in December");
    await renameTrip(t.id, "   ");
    expect((await db().trips.get(t.id))!.name).toBe("Lisbon in December");
  });

  it("deletes everything for a trip and can undo", async () => {
    const t = await createTrip("X");
    await db().options.put({ tripId: t.id, stage: "flights", extra: [], fetchedAt: "now" });
    const snap = await deleteTrip(t.id);
    expect(await db().trips.get(t.id)).toBeUndefined();
    expect(await db().options.where("tripId").equals(t.id).count()).toBe(0);
    await restoreTrip(snap!);
    expect((await db().trips.get(t.id))!.name).toBe("X");
    expect(await db().options.where("tripId").equals(t.id).count()).toBe(1);
  });

  it("exports and imports all trips", async () => {
    const t = await createTrip("Exported");
    await db().selections.put({ tripId: t.id, activityIds: ["ev_a"] });
    const text = await (await exportAll()).text();
    setDb(new WayfareDB(`test-${++n}`));
    expect(await importAll(text)).toEqual({ imported: 1, skipped: 0 });
    expect((await listTrips())[0].name).toBe("Exported");
    expect((await db().selections.get(t.id))!.activityIds).toEqual(["ev_a"]);
    // Importing again keeps both, with a new ID for the copy.
    await importAll(text);
    expect((await listTrips()).map((x) => x.name).sort()).toEqual(["Exported", "Exported (imported)"]);
  });

  it("rejects files that aren't Wayfare exports", async () => {
    await expect(importAll('{"hello":1}')).rejects.toThrow(/isn't a Wayfare export/);
    await expect(importAll("not json")).rejects.toThrow(/isn't a Wayfare export/);
  });
});
