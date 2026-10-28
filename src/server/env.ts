import "server-only";
import { z } from "zod";

const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const optionalKey = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const int = (def: number) => z.coerce.number().int().positive().default(def);

export const envSchema = z.object({
  OPENAI_API_KEY: optionalKey,
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-6-astra"),
  // `none` is deliberately not allowed: gpt-6-astra does not support it.
  OPENAI_REASONING_EFFORT: z.enum(REASONING_EFFORTS).default("medium"),
  // Optional per-agent overrides, e.g. OPENAI_MODEL_INTAKE / OPENAI_REASONING_EFFORT_ITINERARY.
  APIFY_TOKEN: optionalKey,
  APIFY_FLIGHTS_ACTOR: z.string().trim().default("lergassy/google-flights-api"),
  APIFY_HOTELS_ACTOR: z.string().trim().default("benthepythondev/google-hotels-scraper"),
  GOOGLE_MAPS_API_KEY: optionalKey,
  VIATOR_API_KEY: optionalKey,
  /** PostgreSQL connection string. Unset = trips are kept in the browser only. */
  DATABASE_URL: optionalKey,
  VIATOR_API_BASE: z.string().url().default("https://api.viator.com/partner"),
  KIWI_MCP_URL: z.string().url().default("https://mcp.kiwi.com"),
  FRANKFURTER_URL: z.string().url().default("https://api.frankfurter.dev/v2"),
  MAX_TOKENS_PER_PLAN: int(400_000),
  MAX_PROVIDER_CALLS_PER_PLAN: int(60),
  AIRPORT_BUFFER_INTERNATIONAL_MIN: int(180),
  AIRPORT_BUFFER_DOMESTIC_MIN: int(120),
  ARRIVAL_BUFFER_INTERNATIONAL_MIN: int(60),
  ARRIVAL_BUFFER_DOMESTIC_MIN: int(30),
  ALLOW_DEMO_DATA: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type EnvSource = Record<string, string | undefined>;
export type Env = z.infer<typeof envSchema>;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

let cached: Env | undefined;

/** Parses process.env once. Invalid values throw with the variable name, so misconfiguration is obvious. */
export function getEnv(source: EnvSource = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nFix these in .env.local.`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Model and effort for one agent, honoring OPENAI_MODEL_<AGENT> / OPENAI_REASONING_EFFORT_<AGENT>. */
export function modelFor(agent: string, source: EnvSource = process.env) {
  const env = getEnv(source);
  const key = agent.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const model = source[`OPENAI_MODEL_${key}`]?.trim() || env.OPENAI_MODEL;
  const effortRaw = source[`OPENAI_REASONING_EFFORT_${key}`]?.trim();
  const effort = effortRaw
    ? z.enum(REASONING_EFFORTS).parse(effortRaw)
    : env.OPENAI_REASONING_EFFORT;
  return { model, effort };
}
