import "server-only";
import { createPlanContext, type PlanContext, type ProgressEvent } from "../agents/context";
import { toApiError } from "./errors";
import { limitPlans } from "./ratelimit";

export type SseSend = (event: string, data: unknown) => void;

/**
 * Runs a planning job and streams it as Server-Sent Events: `progress` steps, `result` payloads
 * (possibly several, as stages finish), then `error` or `done`. The first progress event is sent
 * immediately so the UI shows named work within a second.
 */
export function planStream(
  request: Request,
  first: string,
  job: (ctx: PlanContext, send: SseSend) => Promise<void>,
): Response {
  const limited = limitPlans(request);
  if (limited) return limited;
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send: SseSend = (event, data) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };
      send("progress", { type: "step", message: first, at: new Date().toISOString() } satisfies ProgressEvent);
      const keepAlive = setInterval(() => open && controller.enqueue(encoder.encode(": keep-alive\n\n")), 15_000);
      let ctx: PlanContext | undefined;
      try {
        ctx = await createPlanContext({ onProgress: (e) => send("progress", e), signal: abort.signal });
        await job(ctx, send);
        send("usage", { tokens: ctx.tokens.used, tokenLimit: ctx.tokens.max, providerCalls: ctx.guard.calls, providerCallLimit: ctx.guard.maxCalls });
        send("done", {});
      } catch (e) {
        send("error", toApiError(e));
      } finally {
        clearInterval(keepAlive);
        await ctx?.host.close().catch(() => {});
        limitPlans.release();
        open = false;
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function readJson<T>(request: Request, schema: { parse: (v: unknown) => T }, maxChars = 2_000_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxChars) throw new Error("Request too large");
  return schema.parse(text ? JSON.parse(text) : {});
}
