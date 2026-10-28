import "server-only";
import { randomUUID } from "node:crypto";
import type { Model } from "@openai/agents";
import { getEnv, type Env } from "../env";
import { evidenceStore, scopedEvidence, type EvidenceStore } from "../evidence/store";
import { PlanGuard } from "../providers/guard";
import { createMcpHost, type McpHost } from "../mcp/host";
import { providersFromEnv, type Providers } from "../mcp/context";

export type ProgressEvent =
  | { type: "step"; agent?: string; message: string; at: string }
  | { type: "warning"; message: string; at: string };

export class TokenBudgetExceeded extends Error {
  constructor(used: number, max: number) {
    super(`This plan used ${used} of its ${max}-token budget (MAX_TOKENS_PER_PLAN). Start a new plan or raise the limit.`);
    this.name = "TokenBudgetExceeded";
  }
}

export class TokenBudget {
  used = 0;
  private warned = false;
  constructor(
    readonly max: number,
    private readonly warn: (m: string) => void,
  ) {}
  check() {
    if (this.used >= this.max) throw new TokenBudgetExceeded(this.used, this.max);
  }
  add(tokens: number) {
    this.used += tokens;
    if (!this.warned && this.used >= this.max * 0.8) {
      this.warned = true;
      this.warn(`Token budget nearly used: ${this.used} of ${this.max}.`);
    }
  }
}

export interface TraceEntry {
  agent: string;
  at: string;
  kind: "tool" | "output" | "retry" | "error";
  detail: string;
}

export interface PlanContext {
  planId: string;
  env: Env;
  evidence: EvidenceStore;
  guard: PlanGuard;
  host: McpHost;
  tokens: TokenBudget;
  progress: (e: ProgressEvent) => void;
  trace: TraceEntry[];
  /** Evidence IDs created during this run, in order. */
  created: string[];
  /** Which provider adapters this run uses (to check availability before starting work). */
  providers: Providers;
  signal?: AbortSignal;
  /** Injected in tests; otherwise each agent uses the OpenAI Responses model from env. */
  model?: Model;
}

export async function createPlanContext(opts: {
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
  model?: Model;
  providers?: Providers;
  env?: Env;
  evidence?: EvidenceStore;
}): Promise<PlanContext> {
  const env = opts.env ?? getEnv();
  const planId = randomUUID();
  const now = () => new Date().toISOString();
  const emit = opts.onProgress ?? (() => {});
  const created: string[] = [];
  // Demo mode: only with ALLOW_DEMO_DATA=true and no OpenAI key. Records are marked demo.
  const demo = env.ALLOW_DEMO_DATA && !env.OPENAI_API_KEY && !opts.model;
  const demoMod = demo ? await import("../demo") : undefined;
  const evidence = scopedEvidence(opts.evidence ?? evidenceStore(), created, demo);
  const providers = opts.providers ?? demoMod?.demoProviders() ?? providersFromEnv(env);
  const guard = new PlanGuard(planId, env.MAX_PROVIDER_CALLS_PER_PLAN);
  const host = await createMcpHost({
    evidence,
    guard,
    providers,
    progress: (message) => emit({ type: "step", message, at: now() }),
  });
  return {
    planId,
    env,
    evidence,
    guard,
    host,
    tokens: new TokenBudget(env.MAX_TOKENS_PER_PLAN, (message) => emit({ type: "warning", message, at: now() })),
    progress: emit,
    trace: [],
    created,
    providers,
    signal: opts.signal,
    model: opts.model ?? demoMod?.demoModel(),
  };
}
