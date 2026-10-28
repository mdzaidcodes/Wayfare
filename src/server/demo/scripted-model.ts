import "server-only";
// Scripted Model for the Agents SDK, used by tests and by ALLOW_DEMO_DATA mode. Each agent gets a script:
// given the tool results seen so far, return either tool calls to make or the final structured output.
import type { Model, ModelRequest, ModelResponse } from "@openai/agents";

export type Step = { call: { name: string; args: Record<string, unknown> }[] } | { final: unknown };
export type Script = (toolResults: Record<string, unknown>[], input: string) => Step;

export interface FakeModelLog {
  agent: string;
  modelSettings: ModelRequest["modelSettings"];
}

/** Picks a script by matching the agent's instructions. */
export class FakeModel implements Model {
  log: FakeModelLog[] = [];
  private n = 0;
  constructor(private readonly scripts: { match: RegExp; script: Script; agent: string }[]) {}

  private respond(req: ModelRequest): ModelResponse {
    const sys = req.systemInstructions ?? "";
    const entry = this.scripts.find((s) => s.match.test(sys));
    if (!entry) throw new Error(`No fake script for instructions: ${sys.slice(0, 80)}`);
    this.log.push({ agent: entry.agent, modelSettings: req.modelSettings });
    const items = Array.isArray(req.input) ? (req.input as Record<string, unknown>[]) : [];
    const userText = typeof req.input === "string" ? req.input : items.filter((i) => i.role === "user").map((i) => textOf(i.content)).join("\n");
    const results = items.filter((i) => i.type === "function_call_result").map((i) => parse(textOf(i.output)));
    const step = entry.script(results, userText);
    const usage = { requests: 1, inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    if ("call" in step) {
      return {
        usage: usage as ModelResponse["usage"],
        output: step.call.map((c) => ({
          type: "function_call" as const,
          callId: `call_${++this.n}`,
          name: c.name,
          arguments: JSON.stringify(c.args),
          status: "completed" as const,
        })),
        responseId: `resp_${this.n}`,
      };
    }
    return {
      usage: usage as ModelResponse["usage"],
      output: [
        {
          type: "message" as const,
          role: "assistant" as const,
          status: "completed" as const,
          content: [{ type: "output_text" as const, text: JSON.stringify(step.final) }],
        },
      ],
      responseId: `resp_${++this.n}`,
    };
  }

  async getResponse(req: ModelRequest) {
    return this.respond(req);
  }

  async *getStreamedResponse(req: ModelRequest) {
    const r = this.respond(req);
    yield { type: "response_started" as const };
    yield {
      type: "response_done" as const,
      response: { id: r.responseId!, usage: { ...r.usage, requests: 1 }, output: r.output },
    } as never;
  }
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).join("");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if ("output" in o) return textOf(o.output);
    if ("content" in o) return textOf(o.content);
  }
  return "";
}

function parse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    // The bridge wraps structured content in a text item; unwrap once more if needed.
    if (Array.isArray(v) && v[0]?.text) return JSON.parse(v[0].text);
    return v;
  } catch {
    return { raw: s };
  }
}
