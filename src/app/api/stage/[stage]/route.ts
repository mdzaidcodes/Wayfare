import { StageName, StageRequest } from "@/lib/schemas/api";
import { planStream } from "@/server/http/sse";
import { parseBody } from "@/server/http/route-helpers";
import { restoreRecords } from "@/server/http/restore";
import { runStage } from "@/server/orchestrator/stages";

/** Re-runs one stage (refresh, or after the budget changed), keeping the user's other selections. */
export async function POST(request: Request, ctx: RouteContext<"/api/stage/[stage]">) {
  const { stage: raw } = await ctx.params;
  const stage = StageName.safeParse(raw);
  if (!stage.success) {
    return Response.json({ code: "not_found", message: `Unknown stage ${raw}`, nextStep: "Use flights, stay or activities." }, { status: 404 });
  }
  const body = await parseBody(request, StageRequest);
  if (body instanceof Response) return body;
  return planStream(request, `Refreshing ${stage.data}…`, async (pctx, send) => {
    const known = restoreRecords(pctx, body.records);
    send("stage", await runStage(pctx, stage.data, body.brief, body.budgetPlan, body.selections, known, (early) => send("stage", early)));
  });
}
