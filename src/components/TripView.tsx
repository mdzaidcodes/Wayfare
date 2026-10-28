"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { StageKey } from "@/client/db";
import { updateTrip } from "@/client/trips";
import { useTripData } from "@/client/useTripData";
import { formatDateRange } from "@/lib/format";
import { BudgetBar } from "./BudgetBar";
import { IconArrowRight, IconBed, IconCalendar, IconCheck, IconPlane, IconSparkle, IconTicket } from "./icons";
import { IntakeStage } from "./IntakeStage";
import { ItineraryView } from "./ItineraryView";
import { StageView } from "./StageView";
import { Button, cx, EASE, Notice, SPRING } from "./ui";

const STAGES: { key: StageKey; label: string; Icon: typeof IconPlane }[] = [
  { key: "basics", label: "Basics", Icon: IconSparkle },
  { key: "flights", label: "Flights", Icon: IconPlane },
  { key: "stay", label: "Stay", Icon: IconBed },
  { key: "activities", label: "Things to do", Icon: IconTicket },
  { key: "itinerary", label: "Itinerary", Icon: IconCalendar },
];

export function TripView({ tripId }: { tripId: string }) {
  const data = useTripData(tripId);
  // Slide direction follows the step order: forward slides left, back slides right.
  const stageNow = data?.trip.stage;
  const [shown, setShown] = useState(stageNow);
  const [direction, setDirection] = useState(1);
  // Keep the current step in view on narrow screens, where the stepper scrolls sideways.
  const stepsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = stepsRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const nav = stepsRef.current;
    if (!el || !nav) return;
    nav.scrollTo({ left: el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2, behavior: "smooth" });
  }, [stageNow]);
  if (stageNow !== shown) {
    setDirection(STAGES.findIndex((s) => s.key === stageNow) >= STAGES.findIndex((s) => s.key === shown) ? 1 : -1);
    setShown(stageNow);
  }
  if (data === undefined) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pt-6 md:px-8">
        <div className="skeleton h-9 w-56 rounded-xl" />
        <div className="skeleton h-12 w-full max-w-lg rounded-full" />
        <div className="skeleton h-64 w-full rounded-3xl" />
      </div>
    );
  }
  if (data === null) return <div className="p-6"><Notice title="This trip no longer exists.">It may have been deleted. Pick another trip or start a new one.</Notice></div>;
  const { trip, selections } = data;
  const planned = Boolean(trip.budgetPlan);
  const done: Record<StageKey, boolean> = {
    basics: Boolean(trip.intake.last?.ready && trip.brief?.destination),
    flights: Boolean(selections.flightId),
    stay: Boolean(selections.hotelId),
    activities: selections.activityIds.length > 0,
    itinerary: Boolean(data.itinerary),
  };
  const go = (k: StageKey) => void updateTrip(trip.id, { stage: k });
  const current = trip.stage;
  const index = STAGES.findIndex((s) => s.key === current);
  const next = STAGES[index + 1];
  const b = trip.brief;

  return (
    <div className="mx-auto w-full max-w-[76rem] px-4 pb-40 pt-5 md:px-8 md:pb-12 md:pt-7">
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{trip.name}</h1>
        {b && (b.origin || b.destination) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {b.origin?.name && (
              <>
                <span>{b.origin.name}</span>
                <IconArrowRight size={14} />
              </>
            )}
            <span className="font-medium text-ink">{b.destination?.name ?? "Somewhere new"}</span>
            {b.dates && <span>· {formatDateRange(b)}</span>}
            {b.travelers && <span>· {b.travelers} traveler{b.travelers > 1 ? "s" : ""}</span>}
          </p>
        )}
      </motion.header>

      <nav ref={stepsRef} aria-label="Planning steps" className="no-scrollbar relative -mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ol className="glass inline-flex min-w-max gap-1 rounded-full p-1 shadow-sm ring-1 ring-line">
          {STAGES.map((s, i) => {
            const enabled = s.key === "basics" || planned;
            const active = current === s.key;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => go(s.key)}
                  aria-current={active ? "step" : undefined}
                  className={cx(
                    "relative flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors md:px-4",
                    active ? "text-bg" : "text-ink hover:text-accent",
                    !enabled && "cursor-not-allowed opacity-40 hover:text-ink",
                  )}
                >
                  {active && <motion.span layoutId="step-pill" transition={SPRING} className="absolute inset-0 rounded-full bg-ink shadow-card" />}
                  <span
                    className={cx(
                      "relative flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors",
                      done[s.key] ? "bg-ok text-white" : active ? "bg-bg/20" : "bg-surface-2",
                    )}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {done[s.key] ? (
                        <motion.span key="done" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={SPRING}>
                          <IconCheck size={14} />
                        </motion.span>
                      ) : (
                        <motion.span key="n" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                          {i + 1}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                  <span className="relative">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* The side column only exists once there is a budget to show, so Basics gets the full width. */}
      <div className={cx(trip.budgetPlan && "md:grid md:grid-cols-[minmax(0,1fr)_18rem] md:items-start md:gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8")}>
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={current}
              custom={direction}
              initial={{ opacity: 0, x: 24 * direction, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: -24 * direction, filter: "blur(4px)" }}
              transition={{ duration: 0.32, ease: EASE }}
            >
              {current === "basics" && <IntakeStage data={data} />}
              {(current === "flights" || current === "stay" || current === "activities") && (planned ? <StageView data={data} stage={current} /> : <IntakeStage data={data} />)}
              {current === "itinerary" && <ItineraryView data={data} />}
              {planned && next && current !== "basics" && (
                <div className="mt-8 flex justify-end">
                  <Button variant="primary" className="group min-h-12 rounded-2xl px-5" onClick={() => go(next.key)}>
                    Next: {next.label}
                    <IconArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        {trip.budgetPlan && (
          <aside className="md:sticky md:top-6">
            <BudgetBar trip={trip} plan={trip.budgetPlan} summary={data.summary} />
          </aside>
        )}
      </div>
    </div>
  );
}
