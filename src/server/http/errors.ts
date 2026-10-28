import "server-only";
import { ZodError } from "zod";
import { TokenBudgetExceeded } from "../agents/context";
import { AgentFailedError, ModelAccessError } from "../agents/runner";
import { UnknownEvidenceError } from "../evidence/store";
import { CallLimitError } from "../providers/guard";
import { ProviderError, redact } from "../providers/http";
import { IncompleteBriefError } from "../orchestrator/stages";
import { UnsupportedCurrencyError } from "@/lib/money";

/** What failed and what to do next. Every error the UI shows goes through here. */
export interface ApiError {
  message: string;
  nextStep: string;
  code: string;
}

export function toApiError(e: unknown): ApiError {
  const secrets = [process.env.OPENAI_API_KEY, process.env.APIFY_TOKEN, process.env.GOOGLE_MAPS_API_KEY, process.env.VIATOR_API_KEY, process.env.DATABASE_URL];
  const msg = (m: string) => redact(m, secrets);
  if (e instanceof ModelAccessError) return { code: "model_access", message: msg(e.message), nextStep: "Fix the key or model in .env.local, then restart npm run dev." };
  if (e instanceof TokenBudgetExceeded) return { code: "token_budget", message: e.message, nextStep: "Start a new plan, or raise MAX_TOKENS_PER_PLAN in .env.local." };
  if (e instanceof CallLimitError) return { code: "call_limit", message: msg(e.message), nextStep: "Start a new search, or raise MAX_PROVIDER_CALLS_PER_PLAN." };
  if (e instanceof IncompleteBriefError) return { code: "incomplete_brief", message: e.message, nextStep: "Answer the remaining questions in Basics." };
  if (e instanceof UnsupportedCurrencyError) return { code: "currency", message: e.message, nextStep: "Pick a supported currency in Basics or enter your own rate." };
  if (e instanceof UnknownEvidenceError) return { code: "unknown_evidence", message: "Some saved results couldn't be verified (they may be from an older session).", nextStep: "Refresh this stage to fetch current results." };
  if (e instanceof ProviderError) return { code: "provider", message: msg(e.message), nextStep: "Try again in a moment. If it keeps failing, check the capability report on the home page." };
  if (e instanceof AgentFailedError) return { code: "agent", message: msg(e.message), nextStep: "Try again. If it repeats, simplify the request." };
  if (e instanceof ZodError) return { code: "bad_request", message: `Invalid request: ${e.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, nextStep: "Reload the page and try again." };
  if (e instanceof Error && e.name === "AbortError") return { code: "cancelled", message: "The request was cancelled.", nextStep: "Start it again when you're ready." };
  return { code: "unknown", message: msg(e instanceof Error ? e.message : String(e)), nextStep: "Try again. If it keeps happening, restart npm run dev and check the terminal." };
}
