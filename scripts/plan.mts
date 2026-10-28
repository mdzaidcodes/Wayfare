// Live end-to-end planning from the terminal (real model, real providers).
//   npm run plan -- "London to Lisbon 10-14 Dec 2026, 2 people, 3000 EUR, food and history"
// Questions the Intake agent asks are answered "You decide" (up to 6), so it runs unattended.
import { createPlanContext } from "@/server/agents/context";
import { runIntake } from "@/server/orchestrator/intake";
import { suggestDestinations } from "@/server/orchestrator/destinations";
import { planBudget, runAllStages } from "@/server/orchestrator/stages";
import { costOf, isPriceable } from "@/lib/budget/engine";
import { withOffers } from "@/lib/budget/merge";
import { formatMoney } from "@/lib/money";
import type { StageResult } from "@/lib/schemas/api";
import type { EvidenceRecord } from "@/lib/schemas/evidence";

const text = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ");
if (!text) {
  console.error('Usage: npm run plan -- "<what you want>"');
  process.exit(2);
}
const t0 = Date.now();
const ctx = await createPlanContext({
  onProgress: (e) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${e.type === "warning" ? "⚠ " : ""}${e.message}`),
});

try {
  const answers: { field: string; answer: string }[] = [];
  let intake = await runIntake(ctx, { text, form: {}, answers, overrides: {} });
  for (let i = 0; i < 6 && intake.question; i++) {
    console.log(`? ${intake.question.text} → You decide`);
    answers.push({ field: intake.question.field, answer: "You decide" });
    intake = await runIntake(ctx, { text, form: {}, answers, overrides: {} });
  }
  let brief = intake.brief;
  console.log("\nBrief:", JSON.stringify(brief, null, 2));

  if (!brief.destination) {
    const d = await suggestDestinations(ctx, brief);
    console.log("\nDestination ideas:");
    for (const c of d.candidates) console.log(`  • ${c.name}, ${c.country} — flight + hotel ${formatMoney(c.coreCost)} — ${c.why}`);
    for (const r of d.rejected) console.log(`  ✘ ${r.name}: ${r.reason}`);
    d.problems.forEach((p) => console.log(`  ! ${p}`));
    if (!d.candidates[0]) process.exit(1);
    brief = { ...brief, destination: { name: d.candidates[0].name, country: d.candidates[0].country, airportCodes: [d.candidates[0].airportCode] } };
  }

  const plan = await planBudget(ctx, brief);
  console.log(`\nBudget: flights ${formatMoney(plan.limits.flights)}, stay ${formatMoney(plan.limits.stay)}, activities ${formatMoney(plan.limits.activities)}, reserve ${formatMoney(plan.reserve)} (estimate)`);

  const stages = await runAllStages(ctx, brief, plan);
  const bctx = { currency: plan.total.currency, travelers: brief.travelers!, nights: brief.nights!, rooms: brief.rooms ?? 1 };
  for (const [name, r] of Object.entries(stages)) {
    console.log(`\n== ${name} ==`);
    if ("error" in r) {
      console.log(`  failed: ${r.error}`);
      continue;
    }
    const s = r as StageResult;
    const recs = withOffers(s.records.map((x) => x.record));
    const fx = s.fxEvidenceId ? recs.get(s.fxEvidenceId) : undefined;
    for (const o of s.options) {
      const rec = recs.get(o.evidenceId) as EvidenceRecord;
      const c = isPriceable(rec) ? costOf(rec, { ...bctx, fx: fx?.kind === "fx" ? fx.data : undefined }) : undefined;
      const title = rec.kind === "flight" ? `${rec.data.outbound.segments.map((x) => x.airline).join("/")} ${rec.data.outbound.segments[0].departLocal}` : rec.kind === "hotel" ? rec.data.name : rec.kind === "experience" ? rec.data.title : rec.id;
      console.log(`  • ${title} — ${c?.known ? formatMoney(c.cost) : "price not provided"} — ${rec.source} · ${rec.fetchedAt} [${rec.id}]${o.note ? ` — ${o.note}` : ""}`);
    }
    console.log(`  hidden: ${JSON.stringify(s.hidden)}`);
    s.problems.forEach((p) => console.log(`  ! ${p}`));
    s.nothingFits?.forEach((n) => console.log(`  → ${JSON.stringify(n)}`));
  }
  console.log(`\nTokens used: ${ctx.tokens.used}. Provider calls: ${ctx.guard.calls}. ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error(`\n✘ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await ctx.host.close();
}
