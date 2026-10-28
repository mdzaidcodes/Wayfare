import "server-only";

// Simple in-memory limits (single local process): planning requests per client per minute, and how
// many planning runs may be in flight at once. They protect paid provider credits from loops and
// double-clicks.

const WINDOW_MS = 60_000;
const PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_PLANS ?? 4);

const g = globalThis as unknown as { __wayfareRate?: { hits: Map<string, number[]>; active: number } };
const state = (g.__wayfareRate ??= { hits: new Map<string, number[]>(), active: 0 });

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

function tooMany(message: string, retryAfter: number): Response {
  return Response.json(
    { code: "rate_limited", message, nextStep: `Wait ${retryAfter} seconds and try again.` },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** Returns a 429 response when over a limit; otherwise reserves a slot (release with limitPlans.release()). */
export function limitPlans(req: Request): Response | undefined {
  const key = clientKey(req);
  const t = Date.now();
  const hits = (state.hits.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
  if (hits.length >= PER_MINUTE) {
    return tooMany(`Too many planning requests (${PER_MINUTE} per minute).`, Math.ceil((WINDOW_MS - (t - hits[0])) / 1000));
  }
  if (state.active >= MAX_CONCURRENT) return tooMany(`${MAX_CONCURRENT} plans are already running.`, 10);
  hits.push(t);
  state.hits.set(key, hits);
  state.active++;
  return undefined;
}
limitPlans.release = () => {
  state.active = Math.max(0, state.active - 1);
};

/** Lighter limit for cheap endpoints (photo proxy). */
const photoHits = new Map<string, number[]>();
export function limitPhotos(req: Request): Response | undefined {
  const key = clientKey(req);
  const t = Date.now();
  const hits = (photoHits.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
  if (hits.length >= 240) return tooMany("Too many photo requests.", 30);
  hits.push(t);
  photoHits.set(key, hits);
  return undefined;
}
