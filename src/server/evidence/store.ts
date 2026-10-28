import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EvidenceRecord, type EvidenceKind, type EvidenceOf } from "@/lib/schemas/evidence";
import { toIsoWithOffset } from "@/lib/time";

// Every tool result becomes an evidence record here. Agents only ever hand back IDs; the UI renders
// facts from these records. Records are HMAC-signed so the browser can send them back later (after a
// server restart, for the itinerary) without being able to alter or invent one.

export type NewEvidence<K extends EvidenceKind = EvidenceKind> = Omit<EvidenceOf<K>, "id" | "fetchedAt"> & {
  fetchedAt?: string;
};

export interface SignedEvidence {
  record: EvidenceRecord;
  sig: string;
}

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RECORDS = 20_000;

export class UnknownEvidenceError extends Error {
  constructor(public readonly ids: string[]) {
    super(`Unknown evidence ID(s): ${ids.join(", ")}`);
    this.name = "UnknownEvidenceError";
  }
}

function loadSecret(): Buffer {
  const fromEnv = process.env.EVIDENCE_SIGNING_SECRET?.trim();
  if (fromEnv) return Buffer.from(fromEnv);
  // Persist a local secret so signatures survive dev-server restarts. Never committed (.data is gitignored).
  const file = path.join(process.cwd(), ".data", "evidence-secret");
  try {
    return fs.readFileSync(file);
  } catch {
    const s = randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, s, { mode: 0o600 });
    } catch {
      // Read-only filesystem: fall back to an in-memory secret.
    }
    return s;
  }
}

export class EvidenceStore {
  private records = new Map<string, { record: EvidenceRecord; expires: number }>();
  constructor(
    private readonly secret: Buffer = loadSecret(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  put<K extends EvidenceKind>(input: NewEvidence<K> & { kind: K }): EvidenceOf<K> {
    const candidate = {
      ...input,
      id: `ev_${randomBytes(9).toString("base64url")}`,
      fetchedAt: input.fetchedAt ?? toIsoWithOffset(this.now(), "UTC"),
    };
    // Validation strips nothing silently: an invalid record from an adapter is a bug, so it throws.
    const record = EvidenceRecord.parse(candidate) as EvidenceOf<K>;
    this.save(record);
    return record;
  }

  private save(record: EvidenceRecord) {
    this.gc();
    this.records.set(record.id, { record, expires: this.now().getTime() + TTL_MS });
  }

  get(id: string): EvidenceRecord | undefined {
    const hit = this.records.get(id);
    if (!hit) return undefined;
    if (hit.expires < this.now().getTime()) {
      this.records.delete(id);
      return undefined;
    }
    return hit.record;
  }

  getOf<K extends EvidenceKind>(id: string, kind: K): EvidenceOf<K> | undefined {
    const r = this.get(id);
    return r && r.kind === kind ? (r as EvidenceOf<K>) : undefined;
  }

  /** All-or-nothing lookup. Any ID that isn't in the store is rejected. */
  require(ids: string[], kind?: EvidenceKind): EvidenceRecord[] {
    const missing: string[] = [];
    const out: EvidenceRecord[] = [];
    for (const id of ids) {
      const r = this.get(id);
      if (!r || (kind && r.kind !== kind)) missing.push(id);
      else out.push(r);
    }
    if (missing.length) throw new UnknownEvidenceError(missing);
    return out;
  }

  /** Splits agent-returned IDs into known records and rejected IDs. */
  partition(ids: string[], kind?: EvidenceKind): { known: EvidenceRecord[]; rejected: string[] } {
    const known: EvidenceRecord[] = [];
    const rejected: string[] = [];
    for (const id of ids) {
      const r = this.get(id);
      if (r && (!kind || r.kind === kind)) known.push(r);
      else rejected.push(id);
    }
    return { known, rejected };
  }

  sign(record: EvidenceRecord): SignedEvidence {
    return { record, sig: this.mac(record) };
  }

  /** Re-admits records the browser kept, but only if the signature proves this server produced them. */
  restore(items: SignedEvidence[]): { restored: number; rejected: string[] } {
    let restored = 0;
    const rejected: string[] = [];
    for (const item of items) {
      const parsed = EvidenceRecord.safeParse(item.record);
      if (!parsed.success || !this.verify(parsed.data, item.sig)) {
        rejected.push(String((item.record as { id?: unknown })?.id ?? "?"));
        continue;
      }
      this.save(parsed.data);
      restored++;
    }
    return { restored, rejected };
  }

  private mac(record: EvidenceRecord): string {
    return createHmac("sha256", this.secret).update(canonical(record)).digest("base64url");
  }

  private verify(record: EvidenceRecord, sig: string): boolean {
    const want = Buffer.from(this.mac(record));
    const got = Buffer.from(String(sig));
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private gc() {
    if (this.records.size < MAX_RECORDS) return;
    const t = this.now().getTime();
    for (const [id, v] of this.records) if (v.expires < t) this.records.delete(id);
    // Still full: drop oldest entries (Map preserves insertion order).
    for (const id of this.records.keys()) {
      if (this.records.size < MAX_RECORDS) break;
      this.records.delete(id);
    }
  }

  get size() {
    return this.records.size;
  }
}

/** Stable JSON with sorted keys, so signatures don't depend on property order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

// One store per server process; survives Next.js dev hot reloads.
const g = globalThis as unknown as { __wayfareEvidence?: EvidenceStore };
export function evidenceStore(): EvidenceStore {
  return (g.__wayfareEvidence ??= new EvidenceStore());
}

/** A view of the store that also records every ID put through it (one per planning run). */
export function scopedEvidence(store: EvidenceStore, created: string[], demo = false): EvidenceStore {
  const scoped = Object.create(store) as EvidenceStore;
  scoped.put = ((input: Parameters<EvidenceStore["put"]>[0]) => {
    const r = store.put(demo ? { ...input, demo: true } : input);
    created.push(r.id);
    return r;
  }) as EvidenceStore["put"];
  return scoped;
}
