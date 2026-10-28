import { ItineraryRequest } from "@/lib/schemas/api";
import { planStream } from "@/server/http/sse";
import { parseBody } from "@/server/http/route-helpers";
import { restoreRecords } from "@/server/http/restore";
import { buildItinerary } from "@/server/orchestrator/itinerary";

export async function POST(request: Request) {
  const body = await parseBody(request, ItineraryRequest);
  if (body instanceof Response) return body;
  return planStream(request, "Building your day-by-day plan…", async (ctx, send) => {
    const records = restoreRecords(ctx, body.records);
    send("result", await buildItinerary(ctx, body.brief, body.budgetPlan, body.selections, records));
  });
}
