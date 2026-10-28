"use client";
import { motion } from "framer-motion";
import { buildTripItinerary, toggleBooked, toggleItineraryItem } from "@/client/planner";
import { useRun } from "@/client/runs";
import type { TripData } from "@/client/useTripData";
import { activityLink, PRICE_MAY_DIFFER } from "@/lib/booking-links";
import { localDate, localTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { ItineraryItem, ItineraryItemType } from "@/lib/schemas/trip";
import { SourceBadge } from "./evidence";
import { IconBag, IconBed, IconCalendar, IconCar, IconCheck, IconClock, IconExternal, IconFood, IconMapPin, IconPlane, IconRefresh, IconTicket } from "./icons";
import { ProgressFeed } from "./ProgressFeed";
import { Button, Card, Checkbox, cx, EASE, itemVariants, listVariants, Notice, SPRING } from "./ui";

const ICON: Partial<Record<ItineraryItemType, typeof IconPlane>> = {
  flight: IconPlane,
  leave_for_airport: IconCar,
  airport_arrival: IconPlane,
  arrival_buffer: IconBag,
  transfer: IconCar,
  travel: IconCar,
  bag_drop: IconBag,
  bag_storage: IconBag,
  checkin: IconBed,
  checkout: IconBed,
  activity: IconTicket,
  meal: IconFood,
  free_time: IconClock,
};

/** Node colour per kind of item, so a day reads at a glance. */
const TONE: Partial<Record<ItineraryItemType, string>> = {
  flight: "bg-accent-gradient text-accent-ink",
  activity: "bg-sun text-white",
  meal: "bg-sun-soft text-sun",
  checkin: "bg-accent-soft text-accent",
  checkout: "bg-accent-soft text-accent",
};

export function ItineraryView({ data }: { data: TripData }) {
  const { trip, itinerary, checklist, records } = data;
  const run = useRun(trip.id);
  const build = () => void buildTripItinerary(trip).catch(() => {});
  const hasPicks = Boolean(data.selections.flightId && data.selections.hotelId);

  if (!itinerary) {
    return (
      <div className="space-y-5">
        <Header />
        <ProgressFeed tripId={trip.id} onRetry={build} />
        {!run.job && (
          <Card initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center py-10 text-center">
            <motion.span
              initial={{ scale: 0.6, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={SPRING}
              className="bg-accent-gradient flex h-14 w-14 items-center justify-center rounded-2xl text-accent-ink shadow-glow"
            >
              <IconCalendar size={26} />
            </motion.span>
            <h2 className="font-display mt-4 text-xl font-semibold">{hasPicks ? "Ready to build your day-by-day plan." : "Pick a flight and a hotel first."}</h2>
            <p className="mt-1 max-w-sm text-sm text-muted">Activities are placed inside real opening hours, with travel time between places.</p>
            <Button variant="primary" className="mt-6 min-h-12 rounded-2xl px-6" onClick={build} disabled={!hasPicks}>
              Build itinerary
            </Button>
          </Card>
        )}
      </div>
    );
  }

  const items = itinerary.itinerary.items;
  const done = items.filter((i) => i.done).length;
  const days = itinerary.itinerary.days;

  return (
    <div className="space-y-6">
      <Header
        action={
          <Button variant="secondary" className="group" onClick={build} disabled={Boolean(run.job)}>
            <IconRefresh size={16} className="transition-transform duration-500 group-hover:rotate-180" /> Rebuild
          </Button>
        }
      />
      {run.job && <ProgressFeed tripId={trip.id} compact />}

      <Card className="flex items-center gap-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Ring done={done} total={items.length} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">Whole trip</p>
          <p className="text-sm tabular-nums text-muted">
            {done} of {items.length} done · {days.length} day{days.length > 1 ? "s" : ""}
          </p>
          <p className="mt-1 text-xs text-muted">Every time is local to where you are at that moment. Ticks are saved as you go.</p>
          {done === items.length && items.length > 0 && (
            <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-1 text-sm font-medium text-ok">
              <IconCheck size={16} /> All done. Enjoy the trip!
            </motion.p>
          )}
        </div>
      </Card>

      {itinerary.problems.map((p) => (
        <Notice key={p} tone="warn">
          {p}
        </Notice>
      ))}
      {itinerary.unscheduled.length > 0 && (
        <Notice tone="warn" title="Some activities didn't fit">
          <ul className="list-disc pl-5">
            {itinerary.unscheduled.map((u) => (
              <li key={u.evidenceId}>
                {u.title}: {u.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {days.map((day, n) => {
        const list = items.filter((i) => i.day === day);
        const d = list.filter((i) => i.done).length;
        return (
          <motion.section
            key={day}
            aria-labelledby={`day-${day}`}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5, ease: EASE }}
            className="overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line"
          >
            <header className="flex items-center gap-3 border-b border-line px-5 py-4">
              <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl bg-ink text-bg">
                <span className="text-[9px] font-semibold uppercase leading-none tracking-wider opacity-70">Day</span>
                <span className="text-base font-semibold leading-none">{n + 1}</span>
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={`day-${day}`} className="font-medium">
                  {localDate(`${day}T12:00`)}
                </h2>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <motion.div className="bg-accent-gradient h-full rounded-full" animate={{ width: `${list.length ? (d / list.length) * 100 : 0}%` }} transition={{ duration: 0.6, ease: EASE }} />
                </div>
              </div>
              <span className="text-sm tabular-nums text-muted">
                {d}/{list.length} done
              </span>
            </header>
            <motion.ol variants={listVariants} initial="hidden" whileInView="show" viewport={{ once: true }} className="relative px-2 py-2">
              {list.map((it, i) => (
                <Item key={it.id} item={it} tripId={trip.id} data={data} last={i === list.length - 1} />
              ))}
            </motion.ol>
          </motion.section>
        );
      })}

      <Card aria-labelledby="checklist" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <h2 id="checklist" className="font-display text-xl font-semibold">
          Booking checklist
        </h2>
        <p className="mt-1 text-xs text-muted">Wayfare can&apos;t see whether you booked. Tick each one yourself once it&apos;s done. {PRICE_MAY_DIFFER}</p>
        {!checklist?.items.length && <p className="mt-3 text-sm text-muted">Nothing to book yet.</p>}
        <ul className="mt-4 space-y-2.5">
          {checklist?.items.map((c) => (
            <motion.li
              layout
              key={c.evidenceId}
              className={cx("flex flex-wrap items-center gap-2 rounded-2xl p-2 pr-3 ring-1 transition-colors", c.booked ? "bg-ok-soft ring-ok/25" : "bg-surface-2/60 ring-line")}
            >
              <Checkbox checked={c.booked} onChange={() => void toggleBooked(trip.id, c.evidenceId)} label={`I've booked ${c.title}`} />
              <span className="min-w-0 flex-1">
                <span className={cx("block text-sm font-medium transition-opacity", c.booked && "line-through opacity-60")}>{c.title}</span>
                <span className="text-xs text-muted">
                  {c.type} · {c.seller} · {c.booked ? "Booked" : "I've booked this"}
                </span>
              </span>
              <a
                href={c.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="bg-accent-gradient inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium text-accent-ink shadow-glow transition hover:brightness-110 active:scale-[0.97]"
              >
                {c.linkLabel} <IconExternal size={15} />
              </a>
            </motion.li>
          ))}
        </ul>
      </Card>

      <div className="rounded-3xl bg-ink p-5 text-bg">
        <p className="text-xs font-medium uppercase tracking-wider opacity-70">Estimated total including the spending reserve</p>
        <p className="font-display mt-1 text-3xl font-semibold tracking-tight">{formatMoney(itinerary.grandTotal)}</p>
        <p className="mt-1 text-xs opacity-70">Recomputed from the source records. Food, taxis and transfers are covered by the reserve (an estimate).</p>
      </div>
      {records.size === 0 && null}
    </div>
  );
}

function Header({ action }: { action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Itinerary</h1>
        <p className="mt-1 text-sm text-muted">Your trip, hour by hour. Tick things off as you go.</p>
      </div>
      {action}
    </div>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const pct = total ? done / total : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative h-16 w-16 shrink-0"
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Whole trip progress"
    >
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
        <motion.circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.8, ease: EASE }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{Math.round(pct * 100)}%</span>
    </div>
  );
}

function Item({ item, tripId, data, last }: { item: ItineraryItem; tripId: string; data: TripData; last: boolean }) {
  const Icon = ICON[item.type] ?? IconClock;
  const ev = item.evidenceId ? data.records.get(item.evidenceId) : undefined;
  const tt = item.travelTimeEvidenceId ? data.records.get(item.travelTimeEvidenceId) : undefined;
  const link = ev?.kind === "experience" ? activityLink(ev.data.bookingUrl, ev.source) : undefined;
  const mapsUrl =
    item.location?.point && ["activity", "checkin", "bag_drop", "transfer"].includes(item.type)
      ? `https://www.google.com/maps/search/?api=1&query=${item.location.point.lat},${item.location.point.lng}`
      : undefined;
  return (
    <motion.li variants={itemVariants} className="relative flex gap-1 rounded-2xl py-1 pr-2 transition-colors hover:bg-surface-2/50">
      <Checkbox checked={item.done} onChange={() => void toggleItineraryItem(tripId, item.id)} label={`Mark “${item.title}” done`} />
      <div className="relative flex w-9 shrink-0 justify-center pt-1.5">
        {!last && <span className="absolute bottom-[-0.75rem] top-11 w-px bg-line-strong" aria-hidden />}
        <motion.span
          animate={{ scale: item.done ? 0.9 : 1, opacity: item.done ? 0.55 : 1 }}
          className={cx("relative z-10 flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-surface", TONE[item.type] ?? "bg-surface-2 text-muted")}
        >
          <Icon size={16} />
        </motion.span>
      </div>
      <div className="min-w-0 flex-1 pb-3 pt-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold tabular-nums">
            {localTime(item.start)}
            {item.end !== item.start && <span className="text-muted">–{localTime(item.end)}</span>}
          </span>
          <span className="text-[11px] text-muted">{item.timeZone.replace(/_/g, " ")}</span>
        </div>
        <div className="relative mt-0.5 inline-block font-medium">
          <span className={cx("transition-opacity duration-300", item.done && "opacity-50")}>{item.title}</span>
          <motion.span
            aria-hidden
            className="absolute left-0 top-1/2 h-px bg-ink/60"
            initial={false}
            animate={{ width: item.done ? "100%" : "0%" }}
            transition={{ duration: 0.35, ease: EASE }}
          />
        </div>
        {item.details && <p className="mt-0.5 text-sm text-muted">{item.details}</p>}
        {item.location?.name && item.type !== "flight" && (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-muted">
            <IconMapPin size={14} className="mt-0.5 shrink-0" /> {item.location.address ?? item.location.name}
          </p>
        )}
        {item.notes?.map((n) => (
          <p key={n} className="mt-1 text-xs text-warn">
            {n}
          </p>
        ))}
        {(ev || tt || link || mapsUrl) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {ev && <SourceBadge record={ev} />}
            {tt && <SourceBadge record={tt} />}
            {link && (
              <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline">
                {link.label} <IconExternal size={14} />
              </a>
            )}
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline">
                Map <IconExternal size={14} />
              </a>
            )}
          </div>
        )}
      </div>
    </motion.li>
  );
}
