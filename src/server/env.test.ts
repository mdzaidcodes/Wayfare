import { describe, expect, it } from "vitest";
import { getEnv, modelFor } from "./env";
import { buildCapabilityReport, formatCapabilityReport } from "./capabilities";

describe("env", () => {
  it("defaults to gpt-6-astra at medium effort", () => {
    const env = getEnv({});
    expect(env.OPENAI_MODEL).toBe("gpt-6-astra");
    expect(env.OPENAI_REASONING_EFFORT).toBe("medium");
    expect(env.ALLOW_DEMO_DATA).toBe(false);
  });

  it("rejects the unsupported `none` effort", () => {
    expect(() => getEnv({ OPENAI_REASONING_EFFORT: "none" })).toThrow(
      /OPENAI_REASONING_EFFORT/,
    );
  });

  it("treats empty keys as missing", () => {
    expect(getEnv({ APIFY_TOKEN: "  " }).APIFY_TOKEN).toBeUndefined();
  });

  it("supports per-agent overrides", () => {
    const src = { OPENAI_REASONING_EFFORT_ITINERARY_PLANNER: "high" };
    expect(modelFor("itinerary-planner", src)).toEqual({ model: "gpt-6-astra", effort: "high" });
    expect(modelFor("intake", src).effort).toBe("medium");
  });
});

describe("capability report", () => {
  it("lists each provider as active or missing", () => {
    const report = buildCapabilityReport(
      getEnv({ OPENAI_API_KEY: "sk-x", VIATOR_API_KEY: "v" }),
    );
    const status = Object.fromEntries(report.capabilities.map((c) => [c.id, c.status]));
    expect(status).toMatchObject({
      openai: "active",
      viator: "active",
      apify: "missing",
      google: "missing",
      kiwi: "active",
      frankfurter: "active",
    });
    expect(report.canPlan).toBe(true);
    expect(formatCapabilityReport(report)).toContain("Without Apify: no hotel or seller prices.");
  });

  it("never includes key values", () => {
    const report = buildCapabilityReport(
      getEnv({ OPENAI_API_KEY: "sk-secret-123" }),
    );
    expect(JSON.stringify(report)).not.toContain("sk-secret-123");
  });
});
