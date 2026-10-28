import "server-only";
import { Agent, OpenAIProvider, run, setTracingDisabled, type Model } from "@openai/agents";
import OpenAI from "openai";
import type { z } from "zod";
import { modelFor } from "../env";
import { redact } from "../providers/http";
import { InProcessMcpServer } from "./mcp-bridge";
import type { PlanContext } from "./context";
import type { ServerName } from "../mcp/host";

// Shared agent runner: tool loop (Agents SDK over the Responses API), zod-validated output with one
// corrective retry, step limit, timeout, token accounting and a trace. Model settings follow the
// GPT-6 Astra rules: reasoning effort from env (never "none"), and no temperature/top_p/top_logprobs.

if (process.env.OPENAI_AGENTS_TRACING !== "true") setTracingDisabled(true);

export interface AgentSpec<T extends z.ZodType> {
  name: string;
  label: string;
  instructions: string;
  output: T;
  tools: Partial<Record<ServerName, readonly string[]>>;
  maxTurns: number;
  timeoutMs: number;
  /** Extra checks beyond the schema (e.g. evidence IDs exist). Return problems to trigger the retry. */
  validate?: (out: z.infer<T>, ctx: PlanContext) => string[];
}

export class ModelAccessError extends Error {
  constructor(model: string, detail: string, missingKey = false) {
    super(
      missingKey
        ? `No OpenAI key is set, so the planning agents (${model}) can't run. Add OPENAI_API_KEY to .env.local and restart.`
        : `Your OpenAI key can't use the model "${model}" (${detail}). Check that OPENAI_API_KEY is correct and that the key's project has access to ${model}, or set OPENAI_MODEL to a model it can use.`,
    );
    this.name = "ModelAccessError";
  }
}

export class AgentFailedError extends Error {
  constructor(
    agent: string,
    message: string,
    readonly problems: string[] = [],
  ) {
    super(`${agent}: ${message}`);
    this.name = "AgentFailedError";
  }
}

const providers = new Map<string, OpenAIProvider>();
function openAIModel(ctx: PlanContext, name: string): Promise<Model> | Model {
  if (ctx.model) return ctx.model;
  const key = ctx.env.OPENAI_API_KEY;
  if (!key) throw new ModelAccessError(modelFor(name).model, "", true);
  let p = providers.get(key);
  if (!p) {
    p = new OpenAIProvider({ openAIClient: new OpenAI({ apiKey: key }), useResponses: true });
    providers.set(key, p);
  }
  return p.getModel(modelFor(name).model);
}

function mapError(err: unknown, ctx: PlanContext, agent: string): Error {
  const e = err as { status?: number; code?: string; message?: string };
  const msg = redact(e?.message ?? String(err), [ctx.env.OPENAI_API_KEY]);
  const model = modelFor(agent).model;
  if (e?.status === 401) return new ModelAccessError(model, "the key was rejected");
  if (e?.status === 404 || e?.status === 403 || e?.code === "model_not_found") return new ModelAccessError(model, msg);
  if (err instanceof Error && err.name === "MaxTurnsExceededError") {
    return new AgentFailedError(agent, "took too many steps without finishing");
  }
  if (err instanceof Error) return new AgentFailedError(agent, msg);
  return new AgentFailedError(agent, "unknown error");
}

export async function runAgent<T extends z.ZodType>(
  spec: AgentSpec<T>,
  input: string,
  ctx: PlanContext,
): Promise<z.infer<T>> {
  const now = () => new Date().toISOString();
  const servers = (Object.entries(spec.tools) as [ServerName, readonly string[]][]).map(
    ([server, tools]) =>
      new InProcessMcpServer(`wayfare-${server}`, ctx.host.clients[server], tools, (tool, args) => {
        ctx.trace.push({ agent: spec.name, at: now(), kind: "tool", detail: `${server}.${tool} ${JSON.stringify(args)}` });
      }),
  );
  const { effort } = modelFor(spec.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- output type is enforced by spec.output below
  const agent: Agent<any, any> = new Agent({
    name: spec.label,
    instructions: spec.instructions,
    model: await openAIModel(ctx, spec.name),
    modelSettings: { reasoning: { effort } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputType: spec.output as any,
    mcpServers: servers,
  });

  let prompt = input;
  for (let attempt = 0; attempt < 2; attempt++) {
    ctx.tokens.check();
    const timeout = AbortSignal.timeout(spec.timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    let output: unknown;
    try {
      const result = await run(agent, prompt, { stream: true, maxTurns: spec.maxTurns, signal });
      for await (const ev of result) {
        if (ev.type === "run_item_stream_event" && ev.name === "tool_called") {
          const raw = ev.item.rawItem as { name?: string };
          if (raw?.name) ctx.progress({ type: "step", agent: spec.label, message: `${spec.label}: calling ${raw.name}`, at: now() });
        }
      }
      await result.completed;
      ctx.tokens.add(result.state.usage.totalTokens);
      output = result.finalOutput;
    } catch (err) {
      if (timeout.aborted && !ctx.signal?.aborted) {
        throw new AgentFailedError(spec.label, `timed out after ${Math.round(spec.timeoutMs / 1000)}s`);
      }
      const mapped = mapError(err, ctx, spec.name);
      ctx.trace.push({ agent: spec.name, at: now(), kind: "error", detail: mapped.message });
      throw mapped;
    }

    const parsed = spec.output.safeParse(output);
    const problems = parsed.success
      ? (spec.validate?.(parsed.data, ctx) ?? [])
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    if (!problems.length && parsed.success) {
      ctx.trace.push({ agent: spec.name, at: now(), kind: "output", detail: JSON.stringify(parsed.data).slice(0, 2000) });
      return parsed.data;
    }
    ctx.trace.push({ agent: spec.name, at: now(), kind: "retry", detail: problems.join("; ") });
    if (attempt === 1) throw new AgentFailedError(spec.label, "returned output that failed validation twice", problems);
    prompt = `${input}\n\nYour previous answer had these problems. Fix them and answer again:\n- ${problems.join("\n- ")}`;
  }
  throw new AgentFailedError(spec.label, "unreachable");
}
