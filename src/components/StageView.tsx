"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { comparePrices, editBrief, refreshStage, select, startPlanning, toggleActivity, type SelectResult } from "@/client/planner";
import { useRun } from "@/client/runs";
import type { TripData } from "@/client/useTripData";
import { updateTrip } from "@/client/trips";
import { GROUP_BLURB } from "@/lib/activityGroups";
import { formatMoney } from "@/lib/money";
import type { StageName, Suggestion } from "@/lib/schemas/api";
import type { EvidenceRecord } from "@/lib/schemas/evidence";
import { addDays } from "@/lib/time";
import { ActivityCard, FlightCard, HotelCard } from "./cards";
import { IconRefresh } from "./icons";
import { ProgressFeed } from "./ProgressFeed";
import { Button, EASE, listVariants, Notice, Working } from "./ui";

const TITLES: Record<StageName, string> = { flights: "Flights", stay: "Where to stay", activities: "Things to do" };
const SUBTITLES: Record<StageName, string> = {
  flights: "Round trips for everyone, checked against your flight budget.",
  stay: "Places to stay for every night, checked against your stay budget.",
  activities: "Things to do that match what you're into.",
};

function StageHeader({ stage, action }: { stage: StageName; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{TITLES[stage]}</h1>
        <p className="mt-1 text-sm text-muted">{SUBTITLES[stage]}</p>
      </div>
      {action}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.4, ease: EASE }}
          className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-card ring-1 ring-line"
        >
          <div className="skeleton h-6 w-6 rounded-md" />
          <div className="skeleton h-14 w-14 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-3/5 rounded-full" />
            <div className="skeleton h-3 w-2/5 rounded-full" />
          </div>
          <div className="skeleton h-5 w-16 rounded-full" />
        </motion.div>
      ))}
    </div>
  );
}

export function StageView({ data, stage }: { data: TripData; stage: StageName }) {
  const { trip, selections, records, signed, ctx } = data;
  const run = useRun(trip.id);
  const row = data.options[stage];
  const result = row?.result;
  // Budget refusals are shown on the card that was tapped, so they're visible wherever you've scrolled.
  const [blocked, setBlocked] = useState<{ id: string; reason: string } | null>(null);
  const planning = run.job === "plan";
  const refreshing = run.job === `refresh-${stage}`;
  const brief = trip.brief!;

  const handle = async (id: string, p: Promise<SelectResult>) => {
    try {
      const r = await p;
      setBlocked(r.ok ? null : { id, reason: r.reason });
    } catch (e) {
      setBlocked({ id, reason: `Couldn't select this: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const blockedOn = (id: string) => (blocked?.id === id ? blocked.reason : undefined);

  if (!result) {
    return (
      <div className="space-y-5">
        <StageHeader stage={stage} />
        {(planning || refreshing) && (
          <>
            <Working>Still finding {stage === "stay" ? "places to stay" : TITLES[stage].toLowerCase()}. They&apos;ll appear here.</Working>
            <SkeletonCards />
          </>
        )}
        {!run.job && <ProgressFeed tripId={trip.id} onRetry={() => void refreshStage(trip, stage).catch(() => {})} />}
        {!run.job && !run.error && (
          <Notice title="No options yet." action={<Button variant="primary" onClick={() => void refreshStage(trip, stage).catch(() => {})}>Search now</Button>}>
            Options appear here as soon as the {TITLES[stage].toLowerCase()} search finishes.
          </Notice>
        )}
      </div>
    );
  }

  const get = (id: string) => records.get(id) as EvidenceRecord | undefined;
  const common = { brief, ctx: ctx!, signed: undefined };

  const renderOne = (id: string, note: string) => {
    const r = get(id);
    if (!r) return null;
    if (r.kind === "flight") {
      return (
        <FlightCard
          key={id}
          {...common}
          record={r}
          note={note}
          selected={selections.flightId === id}
          seller={selections.flightSeller}
          blocked={blockedOn(id)}
          onSelect={(seller) =>
            void handle(id, select(trip, seller === null ? { flightId: undefined, flightSeller: undefined } : { flightId: id, flightSeller: seller }))
          }
          onCompare={() => signed.get(id) && void comparePrices(trip, "flights", signed.get(id)!).catch(() => {})}
          comparing={run.job === `compare-${id}`}
        />
      );
    }
    if (r.kind === "hotel") {
      return (
        <HotelCard
          key={id}
          {...common}
          record={r}
          note={note}
          selected={selections.hotelId === id}
          seller={selections.hotelSeller}
          blocked={blockedOn(id)}
          onSelect={(seller) =>
            void handle(id, select(trip, seller === null ? { hotelId: undefined, hotelSeller: undefined } : { hotelId: id, hotelSeller: seller }))
          }
          onCompare={() => signed.get(id) && void comparePrices(trip, "stay", signed.get(id)!).catch(() => {})}
          comparing={run.job === `compare-${id}`}
        />
      );
    }
    if (r.kind === "experience") {
      return <ActivityCard key={id} {...common} record={r} note={note} selected={selections.activityIds.includes(id)} blocked={blockedOn(id)} onSelect={() => void handle(id, toggleActivity(trip, id))} />;
    }
    return null;
  };

  const notes = new Map(result.options.map((o) => [o.evidenceId, o.note]));
  const hiddenTotal = result.hidden.overBudget + result.hidden.unpriced + result.hidden.failedVerification;

  return (
    <div className="space-y-5">
      <StageHeader
        stage={stage}
        action={
          <Button variant="secondary" className="group" onClick={() => void refreshStage(trip, stage).catch(() => {})} disabled={Boolean(run.job)}>
            <IconRefresh size={16} className="transition-transform duration-500 group-hover:rotate-180" /> Refresh prices
          </Button>
        }
      />
      {refreshing && <Working>Refreshing prices…</Working>}
      {planning && result.pendingOffers && <Working>Checking prices on other booking sites. You can pick now.</Working>}
      {!run.job && run.error && <ProgressFeed tripId={trip.id} onRetry={() => void refreshStage(trip, stage).catch(() => {})} />}

      {result.problems.map((p) => (
        <Notice key={p} tone="warn">
          {p}
        </Notice>
      ))}

      {result.options.length > 0 && (
        <p className="rounded-2xl bg-accent-soft px-4 py-2.5 text-sm text-accent">
          {stage === "activities" ? "Tick the things you want to do." : `Tick one ${stage === "flights" ? "flight" : "place to stay"}.`} Tap a card for details, prices by site and booking links.
        </p>
      )}

      {result.options.length === 0 && <NothingFits data={data} stage={stage} suggestions={result.nothingFits ?? []} />}

      {stage === "activities" && result.groups ? (
        result.groups.map((g) => (
          <section key={g.interest} aria-labelledby={`g-${g.interest}`}>
            <div className="mb-3">
              <h2 id={`g-${g.interest}`} className="font-display flex items-baseline gap-2 text-xl font-semibold">
                <span className="first-letter:uppercase">{g.interest}</span>
                <span className="font-sans text-xs font-normal text-muted">{g.evidenceIds.length}</span>
              </h2>
              {GROUP_BLURB[g.interest] && <p className="mt-0.5 text-sm text-muted">{GROUP_BLURB[g.interest]}</p>}
            </div>
            <motion.div variants={listVariants} initial="hidden" animate="show" className="space-y-3">
              {g.evidenceIds.map((id) => renderOne(id, notes.get(id) ?? ""))}
            </motion.div>
          </section>
        ))
      ) : (
        <motion.div variants={listVariants} initial="hidden" animate="show" className="space-y-3">
          {result.options.map((o) => renderOne(o.evidenceId, o.note))}
        </motion.div>
      )}

      {hiddenTotal > 0 && (
        <p className="text-xs text-muted">
          Not shown:{" "}
          {[
            result.hidden.overBudget && `${result.hidden.overBudget} over budget`,
            result.hidden.unpriced && `${result.hidden.unpriced} without a price from the source`,
            result.hidden.failedVerification && `${result.hidden.failedVerification} that failed verification`,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      )}
      {row?.fetchedAt && <p className="text-xs text-muted">Searched {new Date(row.fetchedAt).toLocaleString()}. Prices are snapshots and can change.</p>}
    </div>
  );
}

function NothingFits({ data, stage, suggestions }: { data: TripData; stage: StageName; suggestions: Suggestion[] }) {
  const { trip } = data;
  const b = trip.brief!;
  const apply = async (s: Suggestion) => {
    if (s.type === "raise_budget" && b.budget) {
      await editBrief(trip, { budget: { ...b.budget, amount: Math.ceil(b.budget.amount + s.by.amount) } });
      const fresh = { ...trip, brief: { ...b, budget: { ...b.budget, amount: Math.ceil(b.budget.amount + s.by.amount) } } };
      await startPlanning(fresh).catch(() => {});
    } else if (s.type === "shorten_trip" && b.dates?.type === "fixed") {
      const dates = { ...b.dates, returnDate: addDays(b.dates.returnDate, -1) };
      await editBrief(trip, { dates, nights: s.nights });
      await startPlanning({ ...trip, brief: { ...b, dates, nights: s.nights } }).catch(() => {});
    } else {
      await updateTrip(trip.id, { stage: "basics" });
    }
  };
  const label = (s: Suggestion) =>
    s.type === "raise_budget"
      ? `Raise the budget by about ${formatMoney(s.by)}`
      : s.type === "shorten_trip"
        ? `Shorten to ${s.nights} nights (saves about ${formatMoney(s.saves)})`
        : s.type === "shift_dates"
          ? "Try different dates"
          : "Choose another destination";
  return (
    <Notice tone="warn" title={`Nothing in ${TITLES[stage].toLowerCase()} fits your budget right now.`} action={suggestions.map((s) => (
      <Button key={s.type} onClick={() => void apply(s)}>
        {label(s)}
      </Button>
    ))}>
      These options are based on the cheapest real prices found.
    </Notice>
  );
}
