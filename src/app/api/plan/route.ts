import { PlanRequest, type StageName } from "@/lib/schemas/api";
import { planStream } from "@/server/http/sse";
import { parseBody } from "@/server/http/route-helpers";
import { toApiError } from "@/server/http/errors";
import { planBudget, runStage } from "@/server/orchestrator/stages";

/** Budget, then the three scouts in parallel. Each stage's result streams as soon as it's ready. */
export async function POST(request: Request) {
  const body = await parseBody(request, PlanRequest);
  if (body instanceof Response) return body;
  return planStream(request, `Planning your trip to ${body.brief.destination?.name ?? "your destination"}…`, async (ctx, send) => {
    const plan = await planBudget(ctx, body.brief, body.reservePercent);
    send("budget", plan);
    const stages: StageName[] = ["flights", "stay", "activities"];
    await Promise.all(
      stages.map(async (stage) => {
        try {
          send("stage", await runStage(ctx, stage, body.brief, plan, undefined, undefined, (early) => send("stage", early)));
        } catch (e) {
          send("stage_error", { stage, ...toApiError(e) });
        }
      }),
    );
  });
}
