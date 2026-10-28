import { costOf, type BudgetContext } from "./budget/engine";
import { activityLink, flightLinks, hotelLinks, sellerLink } from "./booking-links";
import type { EvidenceRecord } from "./schemas/evidence";
import type { ChecklistItem, Selections, TripBrief } from "./schemas/trip";

/** Flight search parameters for prefilled links, taken from the chosen flight itself. */
export function flightSearchOf(r: Extract<EvidenceRecord, { kind: "flight" }>, b: TripBrief) {
  const d = r.data;
  return {
    from: d.outbound.segments[0].from.code,
    to: d.outbound.segments[d.outbound.segments.length - 1].to.code,
    departDate: d.outbound.segments[0].departLocal.slice(0, 10),
    returnDate: d.inbound.segments[0].departLocal.slice(0, 10),
    adults: d.travelers,
    cabin: b.cabin,
    currency: b.budget?.currency,
  };
}

export function hotelSearchOf(r: Extract<EvidenceRecord, { kind: "hotel" }>, b: TripBrief) {
  return {
    destination: r.data.name + (b.destination?.name ? `, ${b.destination.name}` : ""),
    checkIn: r.data.checkIn,
    checkOut: r.data.checkOut,
    adults: r.data.adults,
    rooms: r.data.rooms,
    currency: b.budget?.currency,
  };
}

/** Everything that needs booking, with the chosen site's link. Keeps existing ticks. */
export function buildChecklist(
  brief: TripBrief,
  sel: Selections,
  records: Map<string, EvidenceRecord>,
  ctx: BudgetContext,
  previous: ChecklistItem[] = [],
): ChecklistItem[] {
  const booked = new Map(previous.map((p) => [p.evidenceId, p.booked]));
  const out: ChecklistItem[] = [];
  const f = sel.flightId ? records.get(sel.flightId) : undefined;
  if (f?.kind === "flight") {
    const c = costOf(f, ctx, sel.flightSeller);
    const seller = (c.known && c.seller) || f.source;
    const offer = c.known ? c.sellers.find((s) => s.seller === seller) : undefined;
    const links = flightLinks(flightSearchOf(f, brief), { url: f.data.bookingUrl, seller: f.data.bookingSeller });
    const link = sellerLink(seller, offer?.bookingUrl, links[0]);
    out.push({
      type: "flight",
      evidenceId: f.id,
      title: `${f.data.outbound.segments[0].from.code} ⇄ ${f.data.outbound.segments.at(-1)!.to.code} round trip`,
      seller,
      link: link.url,
      linkLabel: link.kind === "exact" ? "Book this flight" : link.label,
      booked: booked.get(f.id) ?? false,
    });
  }
  const h = sel.hotelId ? records.get(sel.hotelId) : undefined;
  if (h?.kind === "hotel") {
    const c = costOf(h, ctx, sel.hotelSeller);
    const seller = (c.known && c.seller) || h.source;
    const offer = c.known ? c.sellers.find((s) => s.seller === seller) : undefined;
    const links = hotelLinks(hotelSearchOf(h, brief), { url: h.data.bookingUrl, seller: h.source });
    const link = sellerLink(seller, offer?.bookingUrl, links[0]);
    out.push({
      type: "hotel",
      evidenceId: h.id,
      title: h.data.name,
      seller,
      link: link.url,
      linkLabel: link.kind === "exact" ? "Book this hotel" : link.label,
      booked: booked.get(h.id) ?? false,
    });
  }
  for (const id of sel.activityIds) {
    const a = records.get(id);
    if (a?.kind !== "experience") continue;
    const link = activityLink(a.data.bookingUrl, a.source);
    if (!link) continue; // walk-in sights need no booking
    out.push({ type: "activity", evidenceId: a.id, title: a.data.title, seller: a.source, link: link.url, linkLabel: link.label, booked: booked.get(a.id) ?? false });
  }
  return out;
}
