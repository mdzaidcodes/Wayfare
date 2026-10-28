// Reads a POST Server-Sent Events response (EventSource only supports GET).

export interface SseMessage {
  event: string;
  data: unknown;
}

export async function* readSse(res: Response): AsyncGenerator<SseMessage> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        yield { event, data: JSON.parse(data.join("\n")) };
      } catch {
        yield { event, data: data.join("\n") };
      }
    }
  }
}

export interface ApiErrorBody {
  message: string;
  nextStep: string;
  code: string;
}

/** POSTs JSON and streams events to `on`. Resolves when the stream ends; rejects with ApiErrorBody. */
export async function postStream(
  url: string,
  body: unknown,
  on: (m: SseMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw { code: "offline", message: "Couldn't reach the Wayfare server.", nextStep: "Check your connection (or that npm run dev is running) and try again." } satisfies ApiErrorBody;
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw err ?? ({ code: `http_${res.status}`, message: `The server answered ${res.status}.`, nextStep: "Try again." } satisfies ApiErrorBody);
  }
  let failed: ApiErrorBody | undefined;
  for await (const m of readSse(res)) {
    if (m.event === "error") failed = m.data as ApiErrorBody;
    else on(m);
  }
  if (failed) throw failed;
}
