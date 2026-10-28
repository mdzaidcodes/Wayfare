import { convert, fromMinor, money, toMinor, type Conversion } from "../money";
import type { Money } from "../schemas/common";
import type { EvidenceOf, EvidenceRecord, FxData } from "../schemas/evidence";
import type { BudgetCategory, BudgetPlan, Selections } from "../schemas/trip";

// The budget is enforced here, in code. The model may propose a split; it never decides what fits.

export interface BudgetContext {
  currency: string;
  fx?: FxData;
  travelers: number;
  nights: number;
  rooms: number;
}

export type Priceable = EvidenceOf<"flight"> | EvidenceOf<"hotel"> | EvidenceOf<"experience">;

export interface SellerPrice {
  seller: string;
  cost: Money;
  conversion: Conversion;
  bookingUrl?: string;
}

export type ItemCost =
  | {
      known: true;
      /** Cost in trip currency for all travelers (flight round trip / hotel whole stay / activity × travelers). */
      cost: Money;
      conversion: Conversion;
      /** Seller the cost refers to. */
      seller?: string;
      /** True when the cost was computed (e.g. nightly × nights) rather than given as a total by the source. */
      computed?: boolean;
      /** Non-bookable sight with no entry price from its source; counted as zero. */
      priceNotProvided?: boolean;
      sellers: SellerPrice[];
    }
  | { known: false; reason: string };

export function categoryOf(r: Priceable): BudgetCategory {
  return r.kind === "flight" ? "flights" : r.kind === "hotel" ? "stay" : "activities";
}

function priced(m: Money, ctx: BudgetContext): Conversion {
  return convert(m, ctx.currency, ctx.fx);
}

/**
 * Cost of one item. Without `seller`, uses the cheapest seller available.
 * With `seller`, uses that seller's price (falls back to unknown if it no longer exists).
 */
export function costOf(r: Priceable, ctx: BudgetContext, seller?: string): ItemCost {
  switch (r.kind) {
    case "flight": {
      const d = r.data;
      const sellers: SellerPrice[] = (d.sellerOffers ?? []).map((o) => {
        const c = priced(o.totalPrice, ctx);
        return { seller: o.seller, cost: c.money, conversion: c, bookingUrl: o.bookingUrl };
      });
      const base = priced(d.totalPrice, ctx);
      const baseSeller: SellerPrice = {
        seller: d.bookingSeller ?? r.source,
        cost: base.money,
        conversion: base,
        bookingUrl: d.bookingUrl,
      };
      return pick([baseSeller, ...sellers], seller);
    }
    case "hotel": {
      const d = r.data;
      const sellers: SellerPrice[] = (d.offers ?? []).map((o) => {
        const c = priced(o.totalPrice, ctx);
        return { seller: o.seller, cost: c.money, conversion: c, bookingUrl: o.bookingUrl };
      });
      let computed = false;
      if (d.totalPrice) {
        const c = priced(d.totalPrice, ctx);
        sellers.unshift({ seller: r.source, cost: c.money, conversion: c, bookingUrl: d.bookingUrl });
      } else if (d.pricePerNight) {
        const total: Money = {
          amount: fromMinor(toMinor(d.pricePerNight.amount) * ctx.nights * ctx.rooms),
          currency: d.pricePerNight.currency,
        };
        const c = priced(total, ctx);
        sellers.unshift({ seller: r.source, cost: c.money, conversion: c, bookingUrl: d.bookingUrl });
        computed = true;
      }
      const result = pick(sellers, seller);
      if (result.known && computed && result.seller === r.source) result.computed = true;
      return result;
    }
    case "experience": {
      const d = r.data;
      if (d.isFree) {
        const zero = money(0, ctx.currency);
        const c: Conversion = { money: zero, rate: 1, converted: false, original: zero };
        return { known: true, cost: zero, conversion: c, sellers: [], seller: r.source };
      }
      if (!d.price) {
        // A sight you just walk into (no booking) whose source gives no entry price: selectable, counted
        // as zero and flagged so the UI says "Entry price not provided by source". Bookable items
        // without a price can't be verified, so they stay out.
        if (!d.bookingUrl && !d.bookable) {
          const zero = money(0, ctx.currency);
          const c: Conversion = { money: zero, rate: 1, converted: false, original: zero };
          return { known: true, cost: zero, conversion: c, sellers: [], seller: r.source, priceNotProvided: true };
        }
        return { known: false, reason: "Price not provided by source" };
      }
      // Unless the source says the price is for the whole group, assume it is per person (the safe side).
      const multiplier = d.priceIsPerPerson === false ? 1 : ctx.travelers;
      const total: Money = {
        amount: fromMinor(toMinor(d.price.amount) * multiplier),
        currency: d.price.currency,
      };
      const c = priced(total, ctx);
      return {
        known: true,
        cost: c.money,
        conversion: c,
        sellers: [{ seller: r.source, cost: c.money, conversion: c, bookingUrl: d.bookingUrl }],
        seller: r.source,
        computed: multiplier !== 1,
      };
    }
  }
}

function pick(sellers: SellerPrice[], seller?: string): ItemCost {
  if (sellers.length === 0) return { known: false, reason: "Price not provided by source" };
  const sorted = [...sellers].sort((a, b) => toMinor(a.cost.amount) - toMinor(b.cost.amount));
  const chosen = seller ? sorted.find((s) => s.seller === seller) : sorted[0];
  if (!chosen) return { known: false, reason: `${seller} no longer offers this item` };
  return {
    known: true,
    cost: chosen.cost,
    conversion: chosen.conversion,
    seller: chosen.seller,
    sellers: sorted,
  };
}

/** Builds a plan whose parts sum exactly to the total. Weights come from the Budget agent (or defaults). */
export function enforcePlan(
  total: Money,
  reservePercent: number,
  weights: { flights: number; stay: number; activities: number },
  reasons: BudgetPlan["reasons"],
): BudgetPlan {
  if (reservePercent < 0 || reservePercent > 80) throw new Error("Reserve must be between 0% and 80%");
  const totalMinor = toMinor(total.amount);
  const reserveMinor = Math.round((totalMinor * reservePercent) / 100);
  const spendable = totalMinor - reserveMinor;
  const w = {
    flights: Math.max(0, weights.flights),
    stay: Math.max(0, weights.stay),
    activities: Math.max(0, weights.activities),
  };
  const sum = w.flights + w.stay + w.activities || 1;
  const flights = Math.floor((spendable * w.flights) / sum);
  const stay = Math.floor((spendable * w.stay) / sum);
  const activities = spendable - flights - stay; // remainder absorbs rounding
  const m = (minor: number) => ({ amount: fromMinor(minor), currency: total.currency });
  return {
    total,
    reservePercent,
    reserve: m(reserveMinor),
    limits: { flights: m(flights), stay: m(stay), activities: m(activities) },
    reasons,
  };
}

/** Changes the reserve and rescales the category limits proportionally. */
export function withReserve(plan: BudgetPlan, reservePercent: number): BudgetPlan {
  return enforcePlan(
    plan.total,
    reservePercent,
    {
      flights: plan.limits.flights.amount,
      stay: plan.limits.stay.amount,
      activities: plan.limits.activities.amount,
    },
    plan.reasons,
  );
}

export interface BudgetSummary {
  currency: string;
  total: Money;
  reserve: Money;
  byCategory: Record<BudgetCategory, { limit: Money; selected: Money }>;
  /** Sum of selected items (excludes reserve). */
  selected: Money;
  /** Selected items the user has ticked as booked. */
  spent: Money;
  /** total − selected − reserve. Negative means over budget. */
  remaining: Money;
  unknownItems: string[];
}

export function summarize(
  plan: BudgetPlan,
  selections: Selections,
  records: Map<string, EvidenceRecord>,
  ctx: BudgetContext,
  bookedIds: ReadonlySet<string> = new Set(),
): BudgetSummary {
  const cur = plan.total.currency;
  const byCat: Record<BudgetCategory, number> = { flights: 0, stay: 0, activities: 0 };
  let spent = 0;
  const unknownItems: string[] = [];

  const add = (id: string | undefined, seller?: string) => {
    if (!id) return;
    const r = records.get(id);
    if (!r || !isPriceable(r)) {
      unknownItems.push(id);
      return;
    }
    const c = costOf(r, ctx, seller);
    if (!c.known) {
      unknownItems.push(id);
      return;
    }
    byCat[categoryOf(r)] += toMinor(c.cost.amount);
    if (bookedIds.has(id)) spent += toMinor(c.cost.amount);
  };
  add(selections.flightId, selections.flightSeller);
  add(selections.hotelId, selections.hotelSeller);
  for (const a of selections.activityIds) add(a);

  const selected = byCat.flights + byCat.stay + byCat.activities;
  const m = (minor: number) => ({ amount: fromMinor(minor), currency: cur });
  return {
    currency: cur,
    total: plan.total,
    reserve: plan.reserve,
    byCategory: {
      flights: { limit: plan.limits.flights, selected: m(byCat.flights) },
      stay: { limit: plan.limits.stay, selected: m(byCat.stay) },
      activities: { limit: plan.limits.activities, selected: m(byCat.activities) },
    },
    selected: m(selected),
    spent: m(spent),
    remaining: m(toMinor(plan.total.amount) - selected - toMinor(plan.reserve.amount)),
    unknownItems,
  };
}

export function isPriceable(r: EvidenceRecord): r is Priceable {
  return r.kind === "flight" || r.kind === "hotel" || r.kind === "experience";
}

export type SelectionCheck =
  | { ok: true; summary: BudgetSummary }
  | { ok: false; reason: string; overBy?: Money; summary: BudgetSummary };

/** Validates a full proposed selection set. Anything over a category limit or the total is blocked. */
export function checkSelections(
  plan: BudgetPlan,
  selections: Selections,
  records: Map<string, EvidenceRecord>,
  ctx: BudgetContext,
): SelectionCheck {
  const summary = summarize(plan, selections, records, ctx);
  const cur = plan.total.currency;
  if (summary.unknownItems.length) {
    return {
      ok: false,
      reason: "This item has no verifiable price from its source, so it can't be checked against your budget.",
      summary,
    };
  }
  const labels: Record<BudgetCategory, string> = {
    flights: "flights",
    stay: "your stay",
    activities: "things to do",
  };
  for (const cat of ["flights", "stay", "activities"] as const) {
    const { limit, selected } = summary.byCategory[cat];
    const over = toMinor(selected.amount) - toMinor(limit.amount);
    if (over > 0) {
      return {
        ok: false,
        reason: `This would put ${labels[cat]} over its limit of ${limit.amount.toFixed(2)} ${cur}.`,
        overBy: { amount: fromMinor(over), currency: cur },
        summary,
      };
    }
  }
  if (toMinor(summary.remaining.amount) < 0) {
    return {
      ok: false,
      reason: "Your selections plus the spending reserve would exceed your total budget.",
      overBy: { amount: -summary.remaining.amount, currency: cur },
      summary,
    };
  }
  return { ok: true, summary };
}

export interface FilteredOption<R extends Priceable = Priceable> {
  record: R;
  cost: Extract<ItemCost, { known: true }>;
}

export interface FilterResult<R extends Priceable = Priceable> {
  fits: FilteredOption<R>[];
  overBudget: { record: R; cost: Money }[];
  unpriced: { record: R; reason: string }[];
}

/**
 * Keeps only options that fit, using the cheapest seller price. An option fits when, together with
 * whatever else is already selected, it stays within its category limit and within the total.
 */
export function filterOptions<R extends Priceable>(
  candidates: R[],
  plan: BudgetPlan,
  selections: Selections,
  records: Map<string, EvidenceRecord>,
  ctx: BudgetContext,
): FilterResult<R> {
  const out: FilterResult<R> = { fits: [], overBudget: [], unpriced: [] };
  const all = new Map(records);
  for (const c of candidates) all.set(c.id, c);
  for (const r of candidates) {
    const cost = costOf(r, ctx);
    if (!cost.known) {
      out.unpriced.push({ record: r, reason: cost.reason });
      continue;
    }
    const trial = withCandidate(selections, r);
    const check = checkSelections(plan, trial, all, ctx);
    if (check.ok) out.fits.push({ record: r, cost });
    else out.overBudget.push({ record: r, cost: cost.cost });
  }
  out.fits.sort((a, b) => toMinor(a.cost.cost.amount) - toMinor(b.cost.cost.amount));
  return out;
}

/** Selection set with `r` swapped in (cheapest seller), replacing the current pick in its category. */
export function withCandidate(selections: Selections, r: Priceable): Selections {
  if (r.kind === "flight") return { ...selections, flightId: r.id, flightSeller: undefined };
  if (r.kind === "hotel") return { ...selections, hotelId: r.id, hotelSeller: undefined };
  return selections.activityIds.includes(r.id)
    ? selections
    : { ...selections, activityIds: [...selections.activityIds, r.id] };
}

export type NothingFitsSuggestion =
  | { type: "raise_budget"; by: Money }
  | { type: "shorten_trip"; nights: number; saves: Money }
  | { type: "shift_dates" }
  | { type: "other_destination" };

/** Concrete options when no candidate in a category fits, computed from real prices. */
export function nothingFitsSuggestions(
  category: BudgetCategory,
  candidates: Priceable[],
  plan: BudgetPlan,
  selections: Selections,
  records: Map<string, EvidenceRecord>,
  ctx: BudgetContext,
): NothingFitsSuggestion[] {
  const costs = candidates
    .map((r) => ({ r, c: costOf(r, ctx) }))
    .filter((x): x is { r: Priceable; c: Extract<ItemCost, { known: true }> } => x.c.known)
    .sort((a, b) => toMinor(a.c.cost.amount) - toMinor(b.c.cost.amount));
  const out: NothingFitsSuggestion[] = [];
  const cheapest = costs[0];
  if (cheapest) {
    const trial = withCandidate(selections, cheapest.r);
    const s = summarize(plan, trial, new Map([...records, [cheapest.r.id, cheapest.r]]), ctx);
    const overCat = toMinor(s.byCategory[category].selected.amount) - toMinor(plan.limits[category].amount);
    const overTotal = -toMinor(s.remaining.amount);
    const by = Math.max(overCat, overTotal, 0);
    // Raising the total by `by` keeps the same reserve percent only if we also grow the reserve.
    const grossUp = Math.ceil(by / (1 - plan.reservePercent / 100));
    if (by > 0) out.push({ type: "raise_budget", by: { amount: fromMinor(grossUp), currency: plan.total.currency } });

    if (category === "stay" && ctx.nights > 1 && cheapest.r.kind === "hotel") {
      const perNight = Math.round(toMinor(cheapest.c.cost.amount) / ctx.nights);
      out.push({
        type: "shorten_trip",
        nights: ctx.nights - 1,
        saves: { amount: fromMinor(perNight), currency: plan.total.currency },
      });
    }
  }
  if (category !== "activities") out.push({ type: "shift_dates" });
  out.push({ type: "other_destination" });
  return out;
}
