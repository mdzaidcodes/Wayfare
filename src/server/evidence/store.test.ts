import { describe, expect, it } from "vitest";
import { EvidenceStore, UnknownEvidenceError } from "./store";

const secret = Buffer.from("test-secret");
const fx = {
  kind: "fx" as const,
  source: "Frankfurter",
  provider: "frankfurter",
  data: { base: "EUR", date: "2026-03-01", rates: { GBP: 0.85 }, origin: "Frankfurter (ECB)" },
};

describe("EvidenceStore", () => {
  it("assigns IDs and fetch times and validates records", () => {
    const s = new EvidenceStore(secret, () => new Date("2026-03-01T14:02:00Z"));
    const r = s.put(fx);
    expect(r.id).toMatch(/^ev_/);
    expect(r.fetchedAt).toBe("2026-03-01T14:02:00+00:00");
    expect(s.get(r.id)).toEqual(r);
    expect(() => s.put({ ...fx, data: { ...fx.data, base: "euro" } })).toThrow();
  });

  it("rejects unknown IDs", () => {
    const s = new EvidenceStore(secret);
    const r = s.put(fx);
    expect(() => s.require([r.id, "ev_madeup123"])).toThrow(UnknownEvidenceError);
    expect(s.partition([r.id, "ev_madeup123"])).toEqual({ known: [r], rejected: ["ev_madeup123"] });
    expect(() => s.require([r.id], "flight")).toThrow(UnknownEvidenceError);
  });

  it("expires records after the TTL", () => {
    let t = new Date("2026-03-01T00:00:00Z");
    const s = new EvidenceStore(secret, () => t);
    const r = s.put(fx);
    t = new Date("2026-03-01T07:00:00Z");
    expect(s.get(r.id)).toBeUndefined();
  });

  it("restores signed records and refuses tampered ones", () => {
    const a = new EvidenceStore(secret);
    const signed = a.sign(a.put(fx));
    const b = new EvidenceStore(secret);
    expect(b.restore([signed])).toEqual({ restored: 1, rejected: [] });
    expect(b.get(signed.record.id)).toEqual(signed.record);

    const tampered = structuredClone(signed);
    (tampered.record.data as { rates: Record<string, number> }).rates.GBP = 0.5;
    const c = new EvidenceStore(secret);
    expect(c.restore([tampered]).rejected).toEqual([signed.record.id]);
    const other = new EvidenceStore(Buffer.from("different"));
    expect(other.restore([signed]).restored).toBe(0);
  });
});
