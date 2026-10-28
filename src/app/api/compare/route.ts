import { CompareRequest } from "@/lib/schemas/api";
import { planStream } from "@/server/http/sse";
import { parseBody } from "@/server/http/route-helpers";
import { restoreRecords } from "@/server/http/restore";
import { comparePrices } from "@/server/orchestrator/compare";

/** On-demand "Compare prices" for one flight or hotel. */
export async function POST(request: Request) {
  const body = await parseBody(request, CompareRequest);
  if (body instanceof Response) return body;
  return planStream(request, "Comparing booking sites…", async (ctx, send) => {
    const [item] = restoreRecords(ctx, [body.evidence]);
    send("result", await comparePrices(ctx, item, body.destination));
  });
}
