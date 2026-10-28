import "server-only";
import type { IntakeRequest, IntakeResponse } from "@/lib/schemas/api";
import type { TripBrief } from "@/lib/schemas/trip";
import { runAgent } from "../agents/runner";
import type { PlanContext } from "../agents/context";
import { FALLBACK_QUESTIONS, intakeAgent, missingFields, resolveDates, toBrief, YOU_DECIDE } from "../agents/defs/intake";

const ORDER = "origin, destination, dates, nights, travelers, budget";

/** One Intake turn: read everything given so far, return the brief and at most one question. */
export async function runIntake(ctx: PlanContext, req: IntakeRequest, today = new Date().toISOString().slice(0, 10)): Promise<IntakeResponse> {
  const lines = [
    `Request: ${JSON.stringify(req.text || "(none)")}`,
    `Form: ${JSON.stringify(req.form)}`,
    req.answers.length ? `Earlier answers:\n${req.answers.map((a) => `- ${a.field}: ${a.answer}`).join("\n")}` : "Earlier answers: none",
    `Ask about: the first field still unknown, in this order: ${ORDER}. If none is unknown, question is null.`,
  ];
  ctx.progress({ type: "step", agent: "Intake", message: "Reading your request…", at: new Date().toISOString() });
  const out = await runAgent(intakeAgent(today), lines.join("\n"), ctx);
  let brief: TripBrief = toBrief(out, req.text, { ...req.form, ...req.overrides });
  brief = withDefaults(brief);
  brief = resolveDates(brief);
  const missing = missingFields(brief);
  const next = missing[0];
  let question: IntakeResponse["question"] = null;
  if (next) {
    const fromAgent = out.question && out.question.field === next ? out.question : null;
    const fb = FALLBACK_QUESTIONS[next];
    const chips = [...(fromAgent?.chips.length ? fromAgent.chips : fb.chips)].filter((c) => c !== YOU_DECIDE).slice(0, 4);
    question = { field: next, text: fromAgent?.text || fb.text, chips: [...chips, YOU_DECIDE] };
  }
  return { brief, missing, question, ready: missing.length === 0 && brief.dates?.type === "fixed" };
}

/** Fills safe defaults the user never has to be asked about, each as a visible, editable assumption. */
export function withDefaults(b: TripBrief): TripBrief {
  const out = { ...b, assumptions: [...b.assumptions] };
  if (out.travelers && !out.rooms) {
    out.rooms = Math.ceil(out.travelers / 2);
    out.assumptions.push({ field: "rooms", label: "Rooms", value: String(out.rooms) });
  }
  if (!out.cabin) {
    out.cabin = "economy";
    out.assumptions.push({ field: "cabin", label: "Cabin", value: "Economy" });
  }
  return out;
}
