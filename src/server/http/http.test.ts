import { afterEach, describe, expect, it, vi } from "vitest";
import { readSse } from "@/lib/sse-client";
import { planStream } from "./sse";
import { toApiError } from "./errors";
import { ModelAccessError } from "../agents/runner";
import { ProviderError } from "../providers/http";

vi.mock("next/server", () => ({ connection: async () => {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("SSE planning stream", () => {
  it("sends a named progress step immediately, then results, usage and done", async () => {
    const t0 = Date.now();
    const res = planStream(new Request("http://x/api/test", { method: "POST" }), "Reading your request…", async (ctx, send) => {
      ctx.progress({ type: "step", agent: "Flight Scout", message: "Checking flights from London…", at: new Date().toISOString() });
      await new Promise((r) => setTimeout(r, 50));
      send("result", { ok: 1 });
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events: { event: string; data: unknown; ms: number }[] = [];
    for await (const m of readSse(res)) events.push({ ...m, ms: Date.now() - t0 });
    expect(events.map((e) => e.event)).toEqual(["progress", "progress", "result", "usage", "done"]);
    expect((events[0].data as { message: string }).message).toBe("Reading your request…");
    expect(events[0].ms).toBeLessThan(1000);
    expect((events[1].data as { message: string }).message).toBe("Checking flights from London…");
  });

  it("turns failures into an error event naming what failed and the next step", async () => {
    const res = planStream(new Request("http://x/api/test", { method: "POST" }), "Start", async () => {
      throw new ProviderError("Google Places", "HTTP 403 – key=AIzaSECRET123 denied");
    });
    const events = [];
    for await (const m of readSse(res)) events.push(m);
    const err = events.find((e) => e.event === "error")!.data as { message: string; nextStep: string };
    expect(err.message).toContain("Google Places");
    expect(err.message).not.toContain("AIzaSECRET123");
    expect(err.nextStep).toBeTruthy();
  });
});

describe("errors", () => {
  it("explains model access problems with the model name and the fix", () => {
    const e = toApiError(new ModelAccessError("gpt-6-astra", "404 model_not_found"));
    expect(e.message).toContain("gpt-6-astra");
    expect(e.nextStep).toContain(".env.local");
  });
});

describe("photo proxy", () => {
  it("fetches with the key server-side and never exposes it", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "AIzaSECRET999");
    const { getEnv } = await import("../env");
    void getEnv;
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("AIzaSECRET999");
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
    });
    vi.stubGlobal("fetch", upstream);
    vi.resetModules();
    const { GET } = await import("@/app/api/photo/route");
    const res = await GET(new Request("http://x/api/photo?ref=places%2FABC%2Fphotos%2FDEF&w=400"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(upstream.mock.calls[0][0]).toBe("https://places.googleapis.com/v1/places/ABC/photos/DEF/media?maxWidthPx=400");
    expect(upstream.mock.calls[0][0]).not.toContain("SECRET");
    const text = JSON.stringify([...res.headers.entries()]);
    expect(text).not.toContain("SECRET");
  });

  it("rejects malformed photo references", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn());
    vi.resetModules();
    const { GET } = await import("@/app/api/photo/route");
    const res = await GET(new Request("http://x/api/photo?ref=https%3A%2F%2Fevil.com%2Fx"));
    expect(res.status).toBe(502);
  });
});
