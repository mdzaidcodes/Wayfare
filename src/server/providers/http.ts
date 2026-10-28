import "server-only";

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

/** Removes anything that looks like a credential from text before it reaches logs or the UI. */
export function redact(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length > 3) out = out.split(s).join("[redacted]");
  return out
    .replace(/(\b(?:key|token|api_key|apikey|access_token)=)[^&\s"]+/gi, "$1[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{6,}/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/\bapify_api_[A-Za-z0-9]{6,}/g, "[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[redacted]");
}

export interface FetchJsonOptions extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;
  retries?: number;
  secrets?: (string | undefined)[];
  signal?: AbortSignal;
}

export async function fetchJson<T = unknown>(provider: string, url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 20_000, retries = 1, secrets = [], signal, ...init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => ctrl.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        const body = redact((await res.text().catch(() => "")).slice(0, 300), secrets);
        const retryable = res.status === 429 || res.status >= 500;
        throw new ProviderError(provider, `HTTP ${res.status}${body ? ` – ${body}` : ""}`, res.status, retryable);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (signal?.aborted) throw new ProviderError(provider, "cancelled");
      const retryable = err instanceof ProviderError ? err.retryable : true;
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  if (lastErr instanceof ProviderError) throw lastErr;
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new ProviderError(provider, msg === "timeout" ? "timed out" : redact(msg, secrets), undefined, true);
}
