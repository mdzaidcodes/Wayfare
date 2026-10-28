import "server-only";
import type { SignedEvidence } from "@/lib/schemas/api";
import type { EvidenceRecord } from "@/lib/schemas/evidence";
import type { PlanContext } from "../agents/context";
import { callTool } from "./stages";

/** On-demand "Compare prices" for one flight or hotel. No model involved. */
export async function comparePrices(ctx: PlanContext, item: EvidenceRecord, destination?: string): Promise<{ records: SignedEvidence[]; note?: string }> {
  const s =
    item.kind === "flight"
      ? await callTool(ctx, "flights", "get_flight_offers", { flightEvidenceId: item.id })
      : item.kind === "hotel"
        ? await callTool(ctx, "stays", "get_hotel_offers", { hotelEvidenceId: item.id, destination })
        : undefined;
  if (!s) throw new Error("Compare prices works for flights and hotels only.");
  const rec = s.evidenceId ? ctx.evidence.get(String(s.evidenceId)) : undefined;
  return { records: rec ? [ctx.evidence.sign(rec)] : [], note: typeof s.note === "string" ? s.note : undefined };
}
