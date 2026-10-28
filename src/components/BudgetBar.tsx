"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import type { BudgetSummary } from "@/lib/budget/engine";
import { formatMoney } from "@/lib/money";
import type { BudgetPlan } from "@/lib/schemas/trip";
import { changeReserve } from "@/client/planner";
import type { TripRow } from "@/client/db";
import { IconBed, IconChevronDown, IconPlane, IconTicket, IconWallet } from "./icons";
import { AnimatedNumber, Collapse, cx, EASE, SPRING } from "./ui";

const CATEGORIES = [
  { key: "flights", label: "Flights", Icon: IconPlane },
  { key: "stay", label: "Stay", Icon: IconBed },
  { key: "activities", label: "Things to do", Icon: IconTicket },
] as const;

const grow = { duration: 0.8, ease: EASE };

/** Always visible: selected, remaining and the split. Docked at the bottom on mobile, a side card on desktop. */
export function BudgetBar({ trip, plan, summary }: { trip: TripRow; plan: BudgetPlan; summary?: BudgetSummary }) {
  // Only rendered in the browser (after the trip loads), so reading the viewport here is safe.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  const cur = plan.total.currency;
  const fmt = (amount: number) => formatMoney({ amount, currency: cur });
  const total = plan.total.amount || 1;
  const selected = summary?.selected.amount ?? 0;
  const spent = summary?.spent.amount ?? 0;
  const reserve = plan.reserve.amount;
  const remaining = summary?.remaining.amount ?? total - reserve;
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / total) * 100))}%`;
  const over = remaining < 0;
  return (
    <motion.section
      aria-label="Budget"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)] shadow-pop md:static md:rounded-3xl md:border-0 md:bg-surface md:shadow-card md:ring-1 md:ring-line"
    >
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left md:px-5 md:pt-4">
        <span className="bg-accent-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-accent-ink shadow-glow">
          <IconWallet size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-2 gap-x-3">
            <span className="min-w-0">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-muted">Selected</span>
              <span className="block truncate text-base font-semibold tracking-tight">
                <AnimatedNumber value={selected} format={fmt} />
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-muted">Remaining</span>
              <motion.span
                key={over ? "over" : "ok"}
                animate={over ? { x: [0, -4, 4, -2, 2, 0] } : {}}
                className={cx("block truncate text-base font-semibold tracking-tight", over ? "text-danger" : "text-ok")}
              >
                <AnimatedNumber value={remaining} format={fmt} />
              </motion.span>
            </span>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <motion.div className="bg-accent" initial={{ width: 0 }} animate={{ width: pct(spent) }} transition={grow} />
            <motion.div className="bg-accent-gradient opacity-70" initial={{ width: 0 }} animate={{ width: pct(selected - spent) }} transition={grow} />
            <motion.div className="ml-auto bg-sun/50" initial={{ width: 0 }} animate={{ width: pct(reserve) }} transition={grow} title="Spending reserve (estimate)" />
          </div>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
          <IconChevronDown size={16} />
        </motion.span>
      </button>
      <Collapse open={open}>
        <div className="space-y-4 border-t border-line px-4 pb-5 pt-4 text-sm md:px-5">
          <dl className="space-y-3">
            <Row label="Total budget" value={formatMoney(plan.total)} strong />
            {CATEGORIES.map(({ key, label, Icon }) => {
              const used = summary?.byCategory[key].selected.amount ?? 0;
              const limit = plan.limits[key].amount;
              const ratio = limit ? Math.min(100, (used / limit) * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted">
                      <Icon size={14} className="text-accent" />
                      {label}
                    </dt>
                    <dd className="whitespace-nowrap text-right tabular-nums">
                      <span className={cx("font-medium", used > limit && "text-danger")}>{fmt(used)}</span>
                      <span className="text-muted"> / {formatMoney(plan.limits[key])}</span>
                    </dd>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <motion.div
                      className={cx("h-full rounded-full", used > limit ? "bg-danger" : "bg-accent-gradient")}
                      initial={{ width: 0 }}
                      animate={{ width: `${ratio}%` }}
                      transition={grow}
                    />
                  </div>
                </div>
              );
            })}
            <Row label="Reserve (estimate)" value={formatMoney(plan.reserve)} dot="bg-sun/60" />
            <Row label="Booked" value={formatMoney(summary?.spent ?? { amount: 0, currency: cur })} />
          </dl>
          <p className="rounded-2xl bg-surface-2/70 p-3 text-xs leading-relaxed text-muted">
            {plan.reasons.reserve || "The reserve covers food, taxis, local transport and everything else. It's an estimate, not a booking."}
          </p>
          <label className="block">
            <span className="flex items-center justify-between text-xs font-medium text-muted">
              <span>Spending reserve</span>
              <span className="tabular-nums text-ink">{plan.reservePercent}%</span>
            </span>
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={plan.reservePercent}
              onChange={(e) => void changeReserve(trip, Number(e.target.value))}
              className="h-11 w-full cursor-pointer accent-[var(--accent)]"
              aria-label="Spending reserve percent"
            />
          </label>
        </div>
      </Collapse>
    </motion.section>
  );
}

function Row({ label, value, strong, dot }: { label: string; value: string; strong?: boolean; dot?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted">
        {dot && <span className={cx("h-2 w-2 rounded-full", dot)} aria-hidden />}
        {label}
      </dt>
      <dd className={cx("whitespace-nowrap text-right tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
