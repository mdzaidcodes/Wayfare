import { PlanRequest } from "@/lib/schemas/api";
import { planStream } from "@/server/http/sse";
import { parseBody } from "@/server/http/route-helpers";
import { suggestDestinations } from "@/server/orchestrator/destinations";

export async function POST(request: Request) {
  const body = await parseBody(request, PlanRequest);
  if (body instanceof Response) return body;
  return planStream(request, "Thinking about where you could go…", async (ctx, send) => {
    send("result", await suggestDestinations(ctx, body.brief));
  });
}
