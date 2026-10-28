import "server-only";
import type { SignedEvidence } from "@/lib/schemas/api";
import type { EvidenceRecord } from "@/lib/schemas/evidence";
import type { PlanContext } from "../agents/context";
import { UnknownEvidenceError } from "../evidence/store";

/** Re-admits records the browser sent back. Any record whose signature fails is rejected outright. */
export function restoreRecords(ctx: PlanContext, items: SignedEvidence[]): EvidenceRecord[] {
  const { rejected } = ctx.evidence.restore(items);
  if (rejected.length) throw new UnknownEvidenceError(rejected);
  return items.map((i) => i.record);
}
