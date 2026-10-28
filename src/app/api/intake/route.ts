import { IntakeRequest } from "@/lib/schemas/api";
import { planStream } from "@/server/http/sse";
import { parseBody } from "@/server/http/route-helpers";
import { runIntake } from "@/server/orchestrator/intake";

export async function POST(request: Request) {
  const body = await parseBody(request, IntakeRequest);
  if (body instanceof Response) return body;
  return planStream(request, "Reading your request…", async (ctx, send) => {
    send("result", await runIntake(ctx, body));
  });
}
