import "server-only";
import { enforcePlan, filterOptions, isPriceable, nothingFitsSuggestions, type BudgetContext, type Priceable } from "@/lib/budget/engine";
import { withOffers } from "@/lib/budget/merge";
import { canonicalGroup, MORE_IDEAS, MUST_SEE } from "@/lib/activityGroups";
import type { SignedEvidence, StageName, StageResult } from "@/lib/schemas/api";
import { CompleteBrief, type BudgetPlan, type Selections, type TripBrief } from "@/lib/schemas/trip";
import type { EvidenceRecord, FxData } from "@/lib/schemas/evidence";
import type { PlanContext } from "../agents/context";
import { AgentFailedError, runAgent, type AgentSpec } from "../agents/runner";
import {
  budgetPlanner,
  experienceScout,
  flightScout,
  stayScout,
  verifierAgent,
} from "../agents/defs/scouts";
import type { ServerName } from "../mcp/host";

const MAX_RETRIES = 2;
const now = () => new Date().toISOString();

export class IncompleteBriefError extends Error {
  constructor(public readonly missing: string[]) {
    super(`The trip brief is missing: ${missing.join(", ")}`);
    this.name = "IncompleteBriefError";
  }
}

export function requireComplete(b: TripBrief): CompleteBrief {
  const r = CompleteBrief.safeParse(b);
  if (!r.success) throw new IncompleteBriefError([...new Set(r.error.issues.map((i) => String(i.path[0])))]);
  return r.data;
}

export async function callTool(ctx: PlanContext, server: ServerName, name: string, args: Record<string, unknown>) {
  const r = await ctx.host.clients[server].callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  const s = (r.structuredContent ?? {}) as Record<string, unknown>;
  if (r.isError) throw new Error(String(s.error ?? `${name} failed`));
  return s;
}

export const budgetContext = (b: CompleteBrief, fx?: FxData): BudgetContext => ({
  currency: b.budget.currency,
  fx,
  travelers: b.travelers,
  nights: b.nights,
  rooms: b.rooms,
});

/** Fetches reference rates when any priced record isn't in the trip currency. */
export async function ensureFx(ctx: PlanContext, records: Iterable<EvidenceRecord>, currency: string) {
  const foreign = new Set<string>();
  for (const r of records) {
    const prices =
      r.kind === "flight"
        ? [r.data.totalPrice, ...(r.data.sellerOffers ?? []).map((o) => o.totalPrice)]
        : r.kind === "hotel"
          ? [r.data.totalPrice, r.data.pricePerNight, ...(r.data.offers ?? []).map((o) => o.totalPrice)]
          : r.kind === "experience"
            ? [r.data.price]
            : r.kind === "hotel_offers" || r.kind === "flight_offers"
              ? r.data.offers.map((o) => o.totalPrice)
              : [];
    for (const p of prices) if (p && p.currency !== currency) foreign.add(p.currency);
  }
  if (!foreign.size) return undefined;
  const s = await callTool(ctx, "reference", "get_rates", { base: currency, quotes: [...foreign] });
  return ctx.evidence.getOf(String(s.evidenceId), "fx");
}

// ---------- Budget ----------
export async function planBudget(ctx: PlanContext, brief: TripBrief, reservePercent?: number): Promise<BudgetPlan> {
  const b = requireComplete(brief);
  ctx.progress({ type: "step", agent: "Budget Planner", message: `Splitting ${b.budget.amount} ${b.budget.currency} across flights, stay and activities…`, at: now() });
  const out = await runAgent(
    budgetPlanner,
    `Trip: ${b.travelers} traveler(s), ${b.nights} nights, from ${b.origin.name} to ${b.destination.name}${b.destination.country ? `, ${b.destination.country}` : ""}, ${b.dates.departDate} to ${b.dates.returnDate}.
Total budget: ${b.budget.amount} ${b.budget.currency}. Cabin: ${b.cabin ?? "economy"}. Interests: ${b.interests.join(", ") || "none given"}.`,
    ctx,
  );
  return enforcePlan(b.budget, reservePercent ?? out.reservePercent, out.weights, out.reasons);
}

// ---------- Verification ----------
const FACT_IN_NOTE = /[$€£¥₹]|\b\d{1,2}[:.]\d{2}\b|\b\d+(?:[.,]\d+)?\s?(?:EUR|USD|GBP|AED|JPY|CHF|AUD|CAD|euros?|dollars?|pounds?|stars?|min(?:utes)?|h(?:ours?)?|km|miles?)\b|https?:\/\//i;

/** Notes may never carry facts; anything that looks like one is removed and reported. */
export function sanitizeNote(note: string): { note: string; problem?: string } {
  return FACT_IN_NOTE.test(note) ? { note: "", problem: "note contained a fact (price, time, number or link)" } : { note };
}

export function codeChecks(r: EvidenceRecord, b: CompleteBrief): string[] {
  const p: string[] = [];
  if (r.kind === "flight") {
    const out = r.data.outbound.segments[0].departLocal.slice(0, 10);
    const back = r.data.inbound.segments[0].departLocal.slice(0, 10);
    if (out !== b.dates.departDate) p.push(`departs ${out}, trip starts ${b.dates.departDate}`);
    if (back !== b.dates.returnDate) p.push(`returns ${back}, trip ends ${b.dates.returnDate}`);
    if (r.data.travelers !== b.travelers) p.push(`priced for ${r.data.travelers} travelers, trip has ${b.travelers}`);
  } else if (r.kind === "hotel") {
    if (r.data.checkIn !== b.dates.departDate && r.data.checkIn !== nextDayIfOvernight(b)) p.push(`check-in ${r.data.checkIn} doesn't match the trip`);
    if (r.data.adults !== b.travelers) p.push(`priced for ${r.data.adults} guests, trip has ${b.travelers}`);
  } else if (r.kind === "experience") {
    if (!r.data.location.name && !r.data.location.point) p.push("no location from source");
  }
  return p;
}
const nextDayIfOvernight = (b: CompleteBrief) => {
  const d = new Date(`${b.dates.departDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Model-side check that notes don't claim things the evidence doesn't support. */
async function llmVerify(ctx: PlanContext, items: { record: EvidenceRecord; note: string }[]): Promise<Map<string, string>> {
  const withNotes = items.filter((i) => i.note.trim()).slice(0, 14);
  const out = new Map<string, string>();
  if (!withNotes.length) return out;
  const payload = withNotes.map(({ record, note }) => ({ evidenceId: record.id, note, evidence: modelSafe(record) }));
  try {
    const v = await runAgent(verifierAgent, `Options to check:\n${JSON.stringify(payload)}`, ctx);
    for (const p of v.problems) if (withNotes.some((i) => i.record.id === p.evidenceId)) out.set(p.evidenceId, p.issue);
  } catch (e) {
    // The code checks still ran; a failed model check only loses note verification, so notes are dropped.
    ctx.trace.push({ agent: "verifier", at: now(), kind: "error", detail: e instanceof Error ? e.message : String(e) });
    for (const i of withNotes) out.set(i.record.id, "note not verified");
  }
  return out;
}

/** Evidence as the model may see it: no provider free text (descriptions, reviews), no photo URLs. */
export function modelSafe(r: EvidenceRecord): unknown {
  return JSON.parse(
    JSON.stringify(r.data, (k, v) => (k === "description" || k === "photos" || k === "photo" || k === "bookingUrl" ? undefined : v)),
  );
}

// ---------- Scouts ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each scout's output is parsed by picked()
type Scout = AgentSpec<any>;

function scoutPrompt(stage: StageName, b: CompleteBrief, plan: BudgetPlan, feedback: string[]): string {
  const base = `Trip: ${b.travelers} traveler(s), ${b.rooms} room(s), from ${b.origin.name}${b.origin.airportCodes?.length ? ` (${b.origin.airportCodes.join("/")})` : ""} to ${b.destination.name}${b.destination.airportCodes?.length ? ` (${b.destination.airportCodes.join("/")})` : ""}.
Dates: depart ${b.dates.departDate}, return ${b.dates.returnDate} (${b.nights} nights). Currency: ${b.budget.currency}. Cabin: ${b.cabin ?? "economy"}.
Interests: ${b.interests.join(", ") || "general sightseeing"}.${b.vibe ? ` Looking for: ${b.vibe}.` : ""}`;
  const limit =
    stage === "flights"
      ? `Flight limit (round trip, all travelers): ${plan.limits.flights.amount} ${plan.total.currency}.`
      : stage === "stay"
        ? `Stay limit (whole stay, all rooms): ${plan.limits.stay.amount} ${plan.total.currency}, about ${Math.floor(plan.limits.stay.amount / b.nights / b.rooms)} per room per night.`
        : `Activities limit (all activities, all travelers): ${plan.limits.activities.amount} ${plan.total.currency}.`;
  const fb = feedback.length ? `\nA check found problems with your last answer. Fix them:\n- ${feedback.join("\n- ")}` : "";
  return `${base}\n${limit}${fb}`;
}

interface Picked {
  ids: string[];
  notes: Map<string, string>;
  groups?: { interest: string; evidenceIds: string[] }[];
}

function picked(stage: StageName, out: unknown): Picked {
  const notes = new Map<string, string>();
  if (stage === "activities") {
    const o = out as { groups: { interest: string; items: { evidenceId: string; note: string }[] }[] };
    const merged = new Map<string, string[]>();
    for (const g of o.groups) {
      const name = canonicalGroup(g.interest);
      merged.set(name, [...(merged.get(name) ?? []), ...g.items.map((i) => i.evidenceId)]);
    }
    // Highlights first, so a place that is both a highlight and, say, history shows under the highlights.
    const groups = [...merged]
      .sort(([a], [b]) => Number(b === MUST_SEE) - Number(a === MUST_SEE))
      .map(([interest, evidenceIds]) => ({ interest, evidenceIds }));
    for (const g of o.groups) for (const i of g.items) if (!notes.has(i.evidenceId)) notes.set(i.evidenceId, i.note);
    return { ids: [...new Set(groups.flatMap((g) => g.evidenceIds))], notes, groups };
  }
  const o = out as { ranked: { evidenceId: string; note: string }[] };
  for (const r of o.ranked) notes.set(r.evidenceId, r.note);
  return { ids: [...new Set(o.ranked.map((r) => r.evidenceId))], notes };
}

/** What makes two records the same real thing: a Viator product, a Google place, or the same title. */
function sameThingKey(r: Priceable): string {
  if (r.kind !== "experience") return r.id;
  const d = r.data;
  if (d.productCode) return `product:${d.productCode}`;
  if (d.location.placeId) return `place:${d.location.placeId}`;
  return `title:${d.title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

const KIND = { flights: "flight", stay: "hotel", activities: "experience" } as const;
const SCOUTS: Record<StageName, Scout> = { flights: flightScout, stay: stayScout, activities: experienceScout };
const LABEL: Record<StageName, string> = { flights: "Flight Scout", stay: "Stay Scout", activities: "Experience Scout" };

export async function runStage(
  ctx: PlanContext,
  stage: StageName,
  brief: TripBrief,
  plan: BudgetPlan,
  selections: Selections = { activityIds: [] },
  known: EvidenceRecord[] = [],
  /** Receives the options as soon as they're ranked, before the slower per-site price comparison. */
  onPreview?: (early: StageResult) => void,
): Promise<StageResult> {
  const b = requireComplete(brief);
  const kind = KIND[stage];
  const problems: string[] = [];
  let feedback: string[] = [];
  let pick: Picked = { ids: [], notes: new Map() };
  const bad = new Map<string, string>();
  const startCreated = ctx.created.length;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    ctx.progress({ type: "step", agent: LABEL[stage], message: attempt ? `${LABEL[stage]}: fixing ${feedback.length} problem(s)…` : `${LABEL[stage]} is searching…`, at: now() });
    let out: unknown;
    try {
      out = await runAgent(SCOUTS[stage], scoutPrompt(stage, b, plan, feedback), ctx);
    } catch (e) {
      if (e instanceof AgentFailedError && attempt < MAX_RETRIES) {
        feedback = [e.message, ...e.problems];
        continue;
      }
      throw e;
    }
    pick = picked(stage, out);
    bad.clear();
    // Code checks first, then the model check of notes.
    const items: { record: EvidenceRecord; note: string }[] = [];
    for (const id of pick.ids) {
      const r = ctx.evidence.getOf(id, kind);
      if (!r) {
        bad.set(id, "unknown evidence ID");
        continue;
      }
      const issues = codeChecks(r, b);
      const s = sanitizeNote(pick.notes.get(id) ?? "");
      pick.notes.set(id, s.note);
      if (s.problem) issues.push(s.problem);
      if (issues.length) bad.set(id, issues.join("; "));
      else items.push({ record: r, note: s.note });
    }
    ctx.progress({ type: "step", agent: "Verifier", message: `Verifier: checking ${pick.ids.length} ${stage === "stay" ? "hotels" : stage}…`, at: now() });
    for (const [id, issue] of await llmVerify(ctx, items)) {
      // A bad note is a note problem, not an option problem: keep the option, drop the note.
      pick.notes.set(id, "");
      if (attempt < MAX_RETRIES) bad.set(id, `note: ${issue}`);
    }
    if (!bad.size) break;
    feedback = [...bad].map(([id, issue]) => `${id}: ${issue}`);
    if (attempt === MAX_RETRIES) break;
  }

  // Note-only problems don't remove an option once retries are exhausted.
  const rejected = new Set([...bad].filter(([, issue]) => !issue.startsWith("note:")).map(([id]) => id));

  // Pool: the scout's ranking first, then other results its searches produced (for enough choice).
  const createdNow = ctx.created.slice(startCreated);
  const pool: Priceable[] = [];
  const seen = new Set<string>();
  // Two searches can return the same tour or sight as separate records; keep the first one only.
  const seenThing = new Set<string>();
  for (const id of [...pick.ids, ...createdNow]) {
    if (seen.has(id) || rejected.has(id)) continue;
    seen.add(id);
    const r = ctx.evidence.getOf(id, kind);
    if (!r || !isPriceable(r) || codeChecks(r, b).length) continue;
    const thing = sameThingKey(r);
    if (seenThing.has(thing)) continue;
    seenThing.add(thing);
    pool.push(r);
  }

  let records = withOffers([...known, ...pool]);
  let fx = await ensureFx(ctx, records.values(), b.budget.currency).catch((e) => {
    problems.push(`Currency conversion: ${e instanceof Error ? e.message : e}`);
    return undefined;
  });
  const bctx = () => budgetContext(b, fx?.data);
  const poolNow = () => pool.map((p) => records.get(p.id) as Priceable);
  let filtered = filterOptions(poolNow(), plan, selections, records, bctx());

  const build = (pendingOffers: boolean): StageResult => {
    const rank = new Map(pick.ids.map((id, i) => [id, i]));
    const ordered = [...filtered.fits].sort((x, y) => (rank.get(x.record.id) ?? 999) - (rank.get(y.record.id) ?? 999));
    const maxShown = stage === "activities" ? 40 : 8;
    const shown = ordered.slice(0, maxShown);
    const shownIds = new Set(shown.map((s) => s.record.id));

    const relatedKinds = new Set(["flight_offers", "hotel_offers"]);
    const out: EvidenceRecord[] = [...shown.map((s) => ctx.evidence.get(s.record.id)!)];
    for (const id of ctx.created.slice(startCreated)) {
      const r = ctx.evidence.get(id);
      if (!r || !relatedKinds.has(r.kind)) continue;
      const target = r.kind === "flight_offers" ? r.data.flightEvidenceId : r.kind === "hotel_offers" ? r.data.hotelEvidenceId : "";
      if (shownIds.has(target)) out.push(r);
    }
    if (fx) out.push(fx);

    const result: StageResult = {
      stage,
      records: out.map((r): SignedEvidence => ctx.evidence.sign(r)),
      options: shown.map((s) => ({ evidenceId: s.record.id, note: pick.notes.get(s.record.id) ?? "" })),
      hidden: { overBudget: filtered.overBudget.length, unpriced: filtered.unpriced.length, failedVerification: rejected.size },
      problems: [...problems],
      fxEvidenceId: fx?.id,
    };
    if (pendingOffers) result.pendingOffers = true;
    if (pick.groups) {
      // Each option appears in one group only: the first that lists it.
      const placed = new Set<string>();
      result.groups = pick.groups
        .map((g) => ({
          interest: g.interest,
          evidenceIds: g.evidenceIds.filter((id) => {
            if (!shownIds.has(id) || placed.has(id)) return false;
            placed.add(id);
            return true;
          }),
        }))
        .filter((g) => g.evidenceIds.length);
      const grouped = new Set(result.groups.flatMap((g) => g.evidenceIds));
      const rest = shown.map((s) => s.record.id).filter((id) => !grouped.has(id));
      if (rest.length) result.groups.push({ interest: MORE_IDEAS, evidenceIds: rest });
    }
    if (!shown.length) {
      result.nothingFits = nothingFitsSuggestions(
        stage === "flights" ? "flights" : stage === "stay" ? "stay" : "activities",
        poolNow(),
        plan,
        selections,
        records,
        bctx(),
      );
      if (!pool.length) result.problems.push(stage === "flights" ? "No flights were found for this route and these dates." : `No ${stage === "stay" ? "hotels" : "activities"} were found.`);
    }
    return result;
  };

  // Per-seller prices for the shortlist only. The options go out first so nobody waits on them.
  if (stage !== "activities" && filtered.fits.length) {
    onPreview?.(build(true));
    const short = filtered.fits.slice(0, 3).map((f) => f.record.id);
    ctx.progress({ type: "step", agent: LABEL[stage], message: `Comparing booking sites for the top ${short.length}…`, at: now() });
    const extra: EvidenceRecord[] = [];
    await Promise.all(
      short.map(async (id) => {
        try {
          const s =
            stage === "flights"
              ? await callTool(ctx, "flights", "get_flight_offers", { flightEvidenceId: id })
              : await callTool(ctx, "stays", "get_hotel_offers", { hotelEvidenceId: id, destination: b.destination.name });
          const r = s.evidenceId ? ctx.evidence.get(String(s.evidenceId)) : undefined;
          if (r) extra.push(r);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!problems.includes(msg)) problems.push(msg);
        }
      }),
    );
    if (extra.length) {
      records = withOffers([...records.values(), ...extra]);
      fx = (await ensureFx(ctx, records.values(), b.budget.currency).catch(() => fx)) ?? fx;
      filtered = filterOptions(poolNow(), plan, selections, records, bctx());
    }
  }

  ctx.progress({
    type: "step",
    agent: LABEL[stage],
    message: `${pool.length} options checked, ${filtered.fits.length} within budget`,
    at: now(),
  });
  return build(false);
}

/** Runs the three scouts in parallel; one failing stage doesn't sink the others. */
export async function runAllStages(ctx: PlanContext, brief: TripBrief, plan: BudgetPlan) {
  const stages: StageName[] = ["flights", "stay", "activities"];
  const settled = await Promise.allSettled(stages.map((s) => runStage(ctx, s, brief, plan)));
  return Object.fromEntries(
    settled.map((r, i) => [stages[i], r.status === "fulfilled" ? r.value : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) }]),
  ) as Record<StageName, StageResult | { error: string }>;
}
