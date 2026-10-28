"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { costOf, type BudgetContext, type ItemCost } from "@/lib/budget/engine";
import { flightLinks, hotelLinks, activityLink, sellerLink } from "@/lib/booking-links";
import { flightSearchOf, hotelSearchOf } from "@/lib/checklist";
import { dayDiff, formatDuration, localDate, localTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { Photo } from "@/lib/schemas/common";
import type { EvidenceOf, FlightLeg, OpeningHours } from "@/lib/schemas/evidence";
import type { SignedEvidence } from "@/lib/schemas/api";
import type { TripBrief } from "@/lib/schemas/trip";
import { BookButton, Gallery, NotProvided, PhotoImg, PriceDisclaimer, PriceLine, SourceBadge } from "./evidence";
import { IconAlert, IconBed, IconChevronDown, IconClock, IconMapPin, IconStar, IconTicket } from "./icons";
import { Badge, Button, Checkbox, Collapse, cx, itemVariants, SPRING } from "./ui";

interface CardProps<K extends "flight" | "hotel" | "experience"> {
  record: EvidenceOf<K>;
  signed?: SignedEvidence;
  note?: string;
  brief: TripBrief;
  ctx: BudgetContext;
  selected: boolean;
  seller?: string;
  /** A seller name picks that site's price; `null` clears the selection. */
  onSelect: (seller?: string | null) => void;
  onCompare?: () => void;
  comparing?: boolean;
  /** Why the last selection attempt on this card was refused (budget). */
  blocked?: string;
}

/**
 * Compact row: a checkbox to select, a one-glance summary, and a tap anywhere else to expand the
 * full details (source, prices by site, booking links).
 */
function CompactCard({
  selected,
  onToggle,
  checkLabel,
  summary,
  blocked,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  checkLabel: string;
  summary: ReactNode;
  blocked?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <motion.article
      layout="position"
      variants={itemVariants}
      whileHover={open ? undefined : { y: -2 }}
      transition={SPRING}
      className={cx(
        "overflow-hidden rounded-3xl bg-surface ring-1 transition-[box-shadow,background-color]",
        selected ? "shadow-glow ring-2 ring-accent" : "shadow-card ring-line hover:shadow-pop",
        open && "shadow-pop",
      )}
    >
      <div className={cx("flex items-stretch transition-colors", selected && "bg-accent-soft/60")}>
        <span className="flex shrink-0 items-center pl-1.5">
          <Checkbox checked={selected} onChange={onToggle} label={checkLabel} />
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left sm:pr-4">
          {summary}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted sm:flex">
            <IconChevronDown size={16} />
          </motion.span>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {blocked && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", x: [0, -6, 6, -3, 3, 0] }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4 }}
            className="mx-3 mb-3 flex items-start gap-2 overflow-hidden rounded-2xl bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            <IconAlert size={14} className="mt-0.5 shrink-0" />
            {blocked}
          </motion.p>
        )}
      </AnimatePresence>
      <Collapse open={open}>
        <div className="space-y-4 border-t border-line p-5">{children}</div>
      </Collapse>
    </motion.article>
  );
}

function Thumb({ photo, alt, Fallback }: { photo?: Photo; alt: string; Fallback: typeof IconBed }) {
  if (!photo) {
    return (
      <span className="bg-accent-soft flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-accent" aria-hidden>
        <Fallback size={22} />
      </span>
    );
  }
  // The icon sits underneath, so a slow or missing photo never leaves an empty tile.
  return (
    <span className="bg-accent-soft relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-accent">
      <Fallback size={22} aria-hidden />
      <PhotoImg photo={{ ...photo, attribution: undefined }} alt={alt} className="absolute inset-0 h-full w-full" iconOnly />
    </span>
  );
}

/** Price shown on the compact row. */
function CompactPrice({ cost, sub }: { cost: ItemCost; sub?: string }) {
  if (!cost.known || cost.priceNotProvided) {
    return <span className="w-14 shrink-0 text-right text-[11px] leading-tight text-muted">{cost.known ? "Price not listed" : "No price"}</span>;
  }
  return (
    <span className="shrink-0 text-right">
      <span className="block text-base font-semibold tabular-nums tracking-tight">{cost.cost.amount === 0 ? "Free" : formatMoney(cost.cost)}</span>
      {sub && cost.known && !cost.priceNotProvided && <span className="block text-[11px] text-muted">{sub}</span>}
    </span>
  );
}

// ---------- Flights ----------

function Leg({ leg, label }: { leg: FlightLeg; label: string }) {
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];
  const plus = dayDiff(first.departLocal, last.arriveLocal);
  const airlines = [...new Set(leg.segments.map((s) => s.airline))].join(" + ");
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-medium uppercase tracking-wide">{label}</span>
        <span>{localDate(first.departLocal)}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{airlines}</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="text-center">
          <div className="text-lg font-semibold tabular-nums">{localTime(first.departLocal)}</div>
          <div className="text-xs text-muted">{first.from.code}</div>
        </div>
        <div className="flex flex-1 flex-col items-center text-xs text-muted">
          <span>{formatDuration(leg.durationMinutes)}</span>
          <span className="my-0.5 h-px w-full bg-line" aria-hidden />
          <span>
            {leg.stops === 0
              ? "Direct"
              : `${leg.stops} stop${leg.stops > 1 ? "s" : ""}: ${leg.layovers.map((l) => `${l.airport.code} ${formatDuration(l.minutes)}`).join(", ")}`}
          </span>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold tabular-nums">
            {localTime(last.arriveLocal)}
            {plus > 0 && <sup className="ml-0.5 text-xs text-warn">+{plus}</sup>}
          </div>
          <div className="text-xs text-muted">{last.to.code}</div>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted">Local times at each airport. {leg.segments.map((s) => [s.airline, s.flightNumber].filter(Boolean).join(" ")).join(" → ")}</p>
    </div>
  );
}

const stopsText = (leg: FlightLeg) => (leg.stops === 0 ? "Direct" : `${leg.stops} stop${leg.stops > 1 ? "s" : ""}`);

/** One line per leg on the compact row: "19:55 LHR → 22:45 LIS  2h 50m". */
function LegLine({ leg }: { leg: FlightLeg }) {
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];
  const plus = dayDiff(first.departLocal, last.arriveLocal);
  return (
    <span className="block truncate text-sm tabular-nums">
      <span className="font-medium">
        {localTime(first.departLocal)} {first.from.code} → {localTime(last.arriveLocal)}
        {plus > 0 && <sup className="text-[10px] text-warn">+{plus}</sup>} {last.to.code}
      </span>
      <span className="hidden text-xs text-muted sm:inline"> {formatDuration(leg.durationMinutes)}</span>
    </span>
  );
}

export function FlightCard(p: CardProps<"flight">) {
  const d = p.record.data;
  const cost = costOf(p.record, p.ctx, p.selected ? p.seller : undefined);
  const search = flightSearchOf(p.record, p.brief);
  const links = flightLinks(search, { url: d.bookingUrl, seller: d.bookingSeller });
  const [open, setOpen] = useState(false);
  const airlines = [...new Set([...d.outbound.segments, ...d.inbound.segments].map((s) => s.airline))].join(" + ");
  return (
    <CompactCard
      selected={p.selected}
      onToggle={() => p.onSelect(p.selected ? null : undefined)}
      checkLabel={`Select flight ${localTime(d.outbound.segments[0].departLocal)} ${d.outbound.segments[0].from.code} to ${d.outbound.segments[d.outbound.segments.length - 1].to.code}`}
      blocked={p.blocked}
      summary={
        <>
          <span className="min-w-0 flex-1">
            <LegLine leg={d.outbound} />
            <LegLine leg={d.inbound} />
            <span className="block truncate text-xs text-muted">
              {stopsText(d.outbound) === stopsText(d.inbound) ? `${stopsText(d.outbound)} both ways` : `${stopsText(d.outbound)} out, ${stopsText(d.inbound).toLowerCase()} back`} · {airlines}
            </span>
          </span>
          <CompactPrice cost={cost} sub="round trip" />
        </>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SourceBadge record={p.record} />
        {p.note && <span className="text-xs text-muted">{p.note}</span>}
      </div>
      <Leg leg={d.outbound} label="Out" />
      <Leg leg={d.inbound} label="Back" />
      <div className="border-t border-line pt-3">
        <PriceLine money={cost.known ? cost.cost : undefined} conversion={cost.known ? cost.conversion : undefined} asOf={p.record.fetchedAt} label="round trip, all travelers" />
        <div className="text-xs text-muted">
          {d.pricePerPerson ? `${formatMoney(d.pricePerPerson)} per person` : "Per-person price: not provided by source"}
          {cost.known && cost.seller ? ` · via ${cost.seller}` : ""}
        </div>
        <p className="mt-1 text-[11px] text-muted">Baggage rules vary by fare. Check them on the booking page.</p>
      </div>
      <SellersPanel
        open={open}
        setOpen={setOpen}
        cost={cost}
        p={p}
        fallback={links[0]}
        renderExtra={(s) => {
          const offer = d.sellerOffers?.find((o) => o.seller === s);
          return offer?.fareName ? <span className="text-xs text-muted">Fare: {offer.fareName}</span> : null;
        }}
      />
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <BookButton key={l.url} link={l} primary={l.kind === "exact"} />
        ))}
      </div>
      <PriceDisclaimer />
    </CompactCard>
  );
}

function SellersPanel({
  open,
  setOpen,
  cost,
  p,
  fallback,
  renderExtra,
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  cost: ItemCost;
  p: CardProps<"flight"> | CardProps<"hotel">;
  fallback: ReturnType<typeof flightLinks>[number];
  renderExtra: (seller: string) => React.ReactNode;
}) {
  const sellers = cost.known ? cost.sellers : [];
  return (
    <div>
      <Button
        variant="soft"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && sellers.length <= 1) p.onCompare?.();
        }}
      >
        {open ? "Hide prices by site" : "Compare prices"}
        {sellers.length > 1 && <Badge tone="accent">{sellers.length} sites</Badge>}
      </Button>
      <Collapse open={open}>
        <div className="mt-2 overflow-hidden rounded-2xl ring-1 ring-line">
          {p.comparing && <p className="p-3 text-sm text-muted">Checking prices on each booking site…</p>}
          {!p.comparing && sellers.length <= 1 && (
            <p className="p-3 text-sm text-muted">Only one price is available for this option right now.{p.onCompare && " Prices from other sites need APIFY_TOKEN, or none were listed."}</p>
          )}
          <ul className="divide-y divide-line">
            {sellers.map((s) => {
              const link = sellerLink(s.seller, s.bookingUrl, fallback);
              const chosen = p.selected && (p.seller ?? (cost.known ? cost.sellers[0].seller : undefined)) === s.seller;
              const hotelOffer = p.record.kind === "hotel" ? p.record.data.offers?.find((o) => o.seller === s.seller) : undefined;
              return (
                <li key={s.seller} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{s.seller}</div>
                    <div className="text-xs text-muted">
                      {formatMoney(s.cost)} total
                      {hotelOffer?.pricePerNight && ` · ${formatMoney(hotelOffer.pricePerNight)}/night`}
                      {p.record.kind === "hotel" &&
                        ` · taxes ${hotelOffer ? (hotelOffer.taxesIncluded === undefined ? "not stated" : hotelOffer.taxesIncluded ? "included" : "not included") : p.record.data.taxesIncluded ? "included" : "not stated"}`}
                      {p.record.kind === "hotel" &&
                        ` · free cancellation ${hotelOffer?.freeCancellation === undefined ? "not stated" : hotelOffer.freeCancellation ? "yes" : "no"}`}
                    </div>
                    {renderExtra(s.seller)}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant={chosen ? "primary" : "secondary"} onClick={() => p.onSelect(s.seller)} aria-pressed={chosen}>
                      {chosen ? "Chosen" : "Use this site"}
                    </Button>
                    <BookButton link={{ ...link, label: link.kind === "exact" ? "Book here" : link.label }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Collapse>
    </div>
  );
}

// ---------- Hotels ----------

export function HotelCard(p: CardProps<"hotel">) {
  const d = p.record.data;
  const cost = costOf(p.record, p.ctx, p.selected ? p.seller : undefined);
  const links = hotelLinks(hotelSearchOf(p.record, p.brief), { url: d.bookingUrl, seller: p.record.source });
  const [open, setOpen] = useState(false);
  return (
    <CompactCard
      selected={p.selected}
      onToggle={() => p.onSelect(p.selected ? null : undefined)}
      checkLabel={`Select ${d.name}`}
      blocked={p.blocked}
      summary={
        <>
          <Thumb photo={d.photos[0]} alt={d.name} Fallback={IconBed} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{d.name}</span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {d.rating !== undefined && (
                <span className="inline-flex items-center gap-0.5">
                  <IconStar size={12} className="text-warn" />
                  {d.rating}
                  {d.ratingScale ? `/${d.ratingScale}` : ""}
                </span>
              )}
              {d.starClass && <span>{d.starClass}-star</span>}
              {d.freeCancellation && <span className="text-ok">Free cancellation</span>}
            </span>
            {d.location.address && <span className="block truncate text-xs text-muted">{d.location.address}</span>}
          </span>
          <CompactPrice cost={cost} sub={`${p.ctx.nights} nights`} />
        </>
      }
    >
      <div className="-mx-4 -mt-4">
        <Gallery photos={d.photos} alt={d.name} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">{d.name}</h3>
        <SourceBadge record={p.record} />
      </div>
      {p.note && <p className="text-xs text-muted">{p.note}</p>}
      <div className="space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {d.rating !== undefined ? (
            <span className="inline-flex items-center gap-1">
              <IconStar size={16} className="text-warn" /> {d.rating}
              {d.ratingScale ? `/${d.ratingScale}` : ""}
              {d.reviewCount !== undefined && <span className="text-muted">({d.reviewCount.toLocaleString()} reviews)</span>}
            </span>
          ) : (
            <NotProvided what="Rating" />
          )}
          <span>{d.starClass ? `${d.starClass}-star` : <NotProvided what="Star class" />}</span>
        </div>
        <p className="flex items-start gap-1 text-muted">
          <IconMapPin size={16} className="mt-0.5 shrink-0" />
          {d.location.address ?? (d.location.point ? `${d.location.point.lat.toFixed(4)}, ${d.location.point.lng.toFixed(4)}` : "Location not provided by source")}
        </p>
        <p>
          Check-in {d.checkInTime ?? <NotProvided />} · Check-out {d.checkOutTime ?? <NotProvided />}
        </p>
        <p>Free cancellation: {d.freeCancellation === undefined ? <NotProvided /> : d.freeCancellation ? "available on some sites" : "no"}</p>
      </div>
      {d.amenities?.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {d.amenities.slice(0, 10).map((a) => (
            <li key={a}>
              <Badge>{a}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">
          <NotProvided what="Amenities" />
        </p>
      )}
      {d.description && (
        <details className="text-sm text-muted">
          <summary className="min-h-11 cursor-pointer py-2">About this hotel (from the source)</summary>
          <p className="whitespace-pre-line">{d.description}</p>
        </details>
      )}
      <div className="border-t border-line pt-3">
        <PriceLine money={cost.known ? cost.cost : undefined} conversion={cost.known ? cost.conversion : undefined} asOf={p.record.fetchedAt} label={`total, ${p.ctx.nights} nights`} />
        <div className="text-xs text-muted">
          {d.pricePerNight ? `${formatMoney(d.pricePerNight)} per night` : "Nightly price: not provided by source"}
          {" · "}
          {d.taxesIncluded === undefined ? "taxes not stated" : d.taxesIncluded ? "taxes included" : "taxes not included"}
          {cost.known && cost.computed && " · total computed from the nightly price"}
        </div>
      </div>
      <SellersPanel open={open} setOpen={setOpen} cost={cost} p={p} fallback={links[links.length - 1]} renderExtra={() => null} />
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <BookButton key={l.url} link={l} primary={l.kind === "exact"} />
        ))}
      </div>
      <PriceDisclaimer />
    </CompactCard>
  );
}

// ---------- Activities ----------

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function hoursText(h: OpeningHours): string {
  if (h.alwaysOpen) return "Open 24 hours";
  if (!h.periods.length) return "Closed on listed days";
  const byDay = new Map<number, string[]>();
  for (const p of h.periods) byDay.set(p.day, [...(byDay.get(p.day) ?? []), `${p.open}–${p.close}`]);
  return [1, 2, 3, 4, 5, 6, 0].map((d) => `${DAYS[d]} ${byDay.get(d)?.join(", ") ?? "closed"}`).join(" · ");
}

export function ActivityCard(p: CardProps<"experience">) {
  const d = p.record.data;
  const cost = costOf(p.record, p.ctx);
  const link = activityLink(d.bookingUrl, p.record.source);
  return (
    <CompactCard
      selected={p.selected}
      onToggle={() => p.onSelect()}
      checkLabel={`Add ${d.title}`}
      blocked={p.blocked}
      summary={
        <>
          <Thumb photo={d.photo} alt={d.title} Fallback={IconTicket} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 font-medium leading-snug">{d.title}</span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {d.durationMinutes !== undefined && <span>{formatDuration(d.durationMinutes)}</span>}
              {d.rating !== undefined && (
                <span className="inline-flex items-center gap-0.5">
                  <IconStar size={12} className="text-warn" />
                  {d.rating}
                  {d.reviewCount !== undefined && ` (${d.reviewCount.toLocaleString()})`}
                </span>
              )}
            </span>
          </span>
          <CompactPrice cost={cost} sub={d.isFree ? undefined : `for ${p.ctx.travelers}`} />
        </>
      }
    >
      <div className="-mx-4 -mt-4">
        <PhotoImg photo={d.photo} alt={d.title} className="aspect-[16/9] w-full" />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium">{d.title}</h3>
        <SourceBadge record={p.record} />
      </div>
      {p.note && <p className="text-xs text-muted">{p.note}</p>}
      {d.description && <p className="text-sm text-muted">{d.description}</p>}
      <ul className="space-y-1 text-sm">
        <li className="flex items-center gap-1.5">
          <IconClock size={16} className="shrink-0 text-muted" />
          {d.durationMinutes ? formatDuration(d.durationMinutes) : <NotProvided what="Duration" />}
        </li>
        <li className="flex items-start gap-1.5">
          <IconClock size={16} className="mt-0.5 shrink-0 text-muted" />
          <span>
            {d.timeSlots?.length
              ? `Slots: ${d.timeSlots.slice(0, 4).map((s) => `${localDate(s.start)} ${localTime(s.start)}`).join(", ")}`
              : d.openingHours
                ? hoursText(d.openingHours)
                : <NotProvided what="Opening hours" />}
          </span>
        </li>
        <li className="flex items-start gap-1.5">
          <IconMapPin size={16} className="mt-0.5 shrink-0 text-muted" />
          {d.location.address ?? d.location.name ?? <NotProvided what="Location" />}
        </li>
        <li className="flex items-center gap-1.5">
          <IconStar size={16} className="shrink-0 text-warn" />
          {d.rating !== undefined ? (
            <span>
              {d.rating}
              {d.reviewCount !== undefined && <span className="text-muted"> ({d.reviewCount.toLocaleString()})</span>}
            </span>
          ) : (
            <NotProvided what="Rating" />
          )}
        </li>
      </ul>
      <div className="border-t border-line pt-3">
        {cost.known && cost.priceNotProvided ? (
          <span className="text-sm">
            <NotProvided what="Entry price" />
            <span className="block text-[11px] text-muted">Not counted in your budget; the reserve covers small costs.</span>
          </span>
        ) : (
          <span>
            <PriceLine money={cost.known ? cost.cost : undefined} conversion={cost.known ? cost.conversion : undefined} asOf={p.record.fetchedAt} label={d.isFree ? undefined : `for ${p.ctx.travelers}`} />
            {d.price && !d.isFree && d.priceIsPerPerson && <span className="block text-xs text-muted">from {formatMoney(d.price)} per person</span>}
          </span>
        )}
      </div>
      {link && (
        <div>
          <BookButton link={link} />
          <p className="mt-1 text-[11px] text-muted">Opens this activity&apos;s page. The date and number of travelers may not carry over.</p>
          <PriceDisclaimer />
        </div>
      )}
    </CompactCard>
  );
}
