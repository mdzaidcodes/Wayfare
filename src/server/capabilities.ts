import "server-only";
import type { Env } from "./env";

export type CapabilityStatus = "active" | "missing" | "limited";

export interface Capability {
  id: string;
  name: string;
  status: CapabilityStatus;
  envVar?: string;
  provides: string;
  /** What the user loses without it. Only set when not active. */
  impact?: string;
}

export interface CapabilityReport {
  generatedAt: string;
  model: string;
  reasoningEffort: string;
  canPlan: boolean;
  demoData: boolean;
  capabilities: Capability[];
}

export function buildCapabilityReport(env: Env, now = new Date()): CapabilityReport {
  const has = (v: string | undefined) => Boolean(v);
  const caps: Capability[] = [
    {
      id: "openai",
      name: `OpenAI (${env.OPENAI_MODEL})`,
      envVar: "OPENAI_API_KEY",
      status: has(env.OPENAI_API_KEY) ? "active" : "missing",
      provides: "All planning agents",
      impact: "No planning: every agent needs the model. Add OPENAI_API_KEY to .env.local.",
    },
    {
      id: "kiwi",
      name: "Kiwi.com flights (MCP)",
      status: "active",
      provides: "Round-trip flight search with booking links (no key needed)",
    },
    {
      id: "frankfurter",
      name: "Frankfurter currency rates",
      status: "active",
      provides: "ECB reference exchange rates (no key needed)",
    },
    {
      id: "ourairports",
      name: "OurAirports dataset",
      status: "active",
      provides: "Airport lookup (no key needed)",
    },
    {
      id: "apify",
      name: "Apify (flight sellers + Google Hotels)",
      envVar: "APIFY_TOKEN",
      status: has(env.APIFY_TOKEN) ? "active" : "missing",
      provides: "Hotels, per-site hotel prices, per-seller flight prices",
      impact: "Without Apify: no hotel or seller prices.",
    },
    {
      id: "google",
      name: "Google Places + Routes",
      envVar: "GOOGLE_MAPS_API_KEY",
      status: has(env.GOOGLE_MAPS_API_KEY) ? "active" : "missing",
      provides: "Geocoding, travel times, free sights, opening hours, place photos",
      impact:
        "Without Google: no travel times, opening hours or free attractions; itinerary transfers show “Not provided by source”.",
    },
    {
      id: "viator",
      name: "Viator activities",
      envVar: "VIATOR_API_KEY",
      status: has(env.VIATOR_API_KEY) ? "active" : "missing",
      provides: "Bookable tours and activities",
      impact: "Without Viator: only free sights from Google Places (if active).",
    },
    {
      id: "postgres",
      name: "PostgreSQL (saved trips)",
      envVar: "DATABASE_URL",
      status: has(env.DATABASE_URL) ? "active" : "missing",
      provides: "Keeps every trip in your database, so it survives clearing the browser and opens in any browser",
      impact: "Without a database: trips are kept in this browser only (use Export for backups).",
    },
  ];
  for (const c of caps) if (c.status === "active") delete c.impact;

  return {
    generatedAt: now.toISOString(),
    model: env.OPENAI_MODEL,
    reasoningEffort: env.OPENAI_REASONING_EFFORT,
    canPlan: has(env.OPENAI_API_KEY) || env.ALLOW_DEMO_DATA,
    demoData: env.ALLOW_DEMO_DATA,
    capabilities: caps,
  };
}

export function formatCapabilityReport(r: CapabilityReport): string {
  const icon = { active: "✔", missing: "✘", limited: "!" } as const;
  const lines = [
    `Wayfare capability report — model ${r.model}, reasoning effort ${r.reasoningEffort}`,
    ...r.capabilities.map(
      (c) =>
        `  ${icon[c.status]} ${c.status.padEnd(7)} ${c.name}${c.impact ? ` — ${c.impact}` : ""}`,
    ),
  ];
  if (r.demoData) lines.push("  ! ALLOW_DEMO_DATA=true — demo data may be shown (marked DEMO DATA).");
  return lines.join("\n");
}
