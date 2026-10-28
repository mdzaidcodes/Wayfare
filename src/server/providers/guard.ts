import "server-only";
import { ProviderError } from "./http";

// Bounds every provider call: per-plan call cap, TTL cache shared across plans, per-provider
// concurrency, and a usage log so the user can see Apify and Google consumption.

export interface UsageEntry {
  at: string;
  planId: string;
  provider: string;
  operation: string;
  cached: boolean;
  ok: boolean;
  ms: number;
  /** Billable units, e.g. hotels returned by an Apify actor. */
  units?: number;
}

class TtlCache {
  private m = new Map<string, { v: unknown; exp: number }>();
  get<T>(k: string): T | undefined {
    const hit = this.m.get(k);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.m.delete(k);
      return undefined;
    }
    return hit.v as T;
  }
  set(k: string, v: unknown, ttlMs: number) {
    if (this.m.size > 2000) this.m.delete(this.m.keys().next().value!);
    this.m.set(k, { v, exp: Date.now() + ttlMs });
  }
}

class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const CONCURRENCY: Record<string, number> = { apify: 2, google: 4, viator: 3, kiwi: 3, frankfurter: 2 };

interface Shared {
  cache: TtlCache;
  sems: Map<string, Semaphore>;
  usage: UsageEntry[];
}
const g = globalThis as unknown as { __wayfareProviders?: Shared };
const shared: Shared = (g.__wayfareProviders ??= { cache: new TtlCache(), sems: new Map(), usage: [] as UsageEntry[] });

export class CallLimitError extends ProviderError {
  constructor(provider: string, limit: number) {
    super(
      provider,
      `this plan reached its limit of ${limit} provider calls (MAX_PROVIDER_CALLS_PER_PLAN). Start a new search or raise the limit.`,
    );
    this.name = "CallLimitError";
  }
}

export class PlanGuard {
  calls = 0;
  constructor(
    public readonly planId: string,
    public readonly maxCalls: number,
  ) {}

  /** Runs `fn` with caching (key) and limits. Cache hits don't count toward the call cap. */
  async call<T>(
    provider: string,
    operation: string,
    key: string | undefined,
    ttlMs: number,
    fn: () => Promise<T>,
    units?: (v: T) => number,
  ): Promise<T> {
    const cacheKey = key ? `${provider}:${operation}:${key}` : undefined;
    if (cacheKey) {
      const hit = shared.cache.get<T>(cacheKey);
      if (hit !== undefined) {
        this.log({ provider, operation, cached: true, ok: true, ms: 0 });
        return hit;
      }
    }
    if (this.calls >= this.maxCalls) throw new CallLimitError(provider, this.maxCalls);
    this.calls++;
    let sem = shared.sems.get(provider);
    if (!sem) shared.sems.set(provider, (sem = new Semaphore(CONCURRENCY[provider] ?? 2)));
    const t0 = Date.now();
    try {
      const v = await sem.run(fn);
      if (cacheKey) shared.cache.set(cacheKey, v, ttlMs);
      this.log({ provider, operation, cached: false, ok: true, ms: Date.now() - t0, units: units?.(v) });
      return v;
    } catch (err) {
      this.log({ provider, operation, cached: false, ok: false, ms: Date.now() - t0 });
      throw err;
    }
  }

  private log(e: Omit<UsageEntry, "at" | "planId">) {
    shared.usage.push({ ...e, at: new Date().toISOString(), planId: this.planId });
    if (shared.usage.length > 5000) shared.usage.splice(0, shared.usage.length - 5000);
  }
}

export function usageLog(): readonly UsageEntry[] {
  return shared.usage;
}

export function usageSummary() {
  const by = new Map<string, { calls: number; cached: number; failed: number; units: number }>();
  for (const u of shared.usage) {
    const s = by.get(u.provider) ?? { calls: 0, cached: 0, failed: 0, units: 0 };
    if (u.cached) s.cached++;
    else s.calls++;
    if (!u.ok) s.failed++;
    s.units += u.units ?? 0;
    by.set(u.provider, s);
  }
  return Object.fromEntries(by);
}

export const TTL = {
  fx: 6 * 3600_000,
  flights: 10 * 60_000,
  hotels: 15 * 60_000,
  offers: 10 * 60_000,
  experiences: 60 * 60_000,
  // Google Places content isn't cached beyond a short window (see README, provider terms).
  places: 30 * 60_000,
  routes: 30 * 60_000,
  destinations: 24 * 3600_000,
} as const;
