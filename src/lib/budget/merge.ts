import type { EvidenceRecord } from "../schemas/evidence";

/**
 * Folds separately fetched seller offers (flight_offers / hotel_offers records) into their flight or
 * hotel, so the budget engine sees every seller. Records stay untouched; copies are returned.
 */
export function withOffers(records: Iterable<EvidenceRecord>): Map<string, EvidenceRecord> {
  const all = new Map<string, EvidenceRecord>();
  for (const r of records) all.set(r.id, r);
  for (const r of all.values()) {
    if (r.kind === "flight_offers") {
      const f = all.get(r.data.flightEvidenceId);
      if (f?.kind === "flight") {
        all.set(f.id, { ...f, data: { ...f.data, sellerOffers: mergeBySeller(f.data.sellerOffers, r.data.offers) } });
      }
    } else if (r.kind === "hotel_offers") {
      const h = all.get(r.data.hotelEvidenceId);
      if (h?.kind === "hotel") {
        all.set(h.id, { ...h, data: { ...h.data, offers: mergeBySeller(h.data.offers, r.data.offers) } });
      }
    }
  }
  return all;
}

function mergeBySeller<T extends { seller: string; fetchedAt: string }>(a: T[] | undefined, b: T[]): T[] {
  const m = new Map<string, T>();
  for (const o of [...(a ?? []), ...b]) {
    const prev = m.get(o.seller);
    if (!prev || prev.fetchedAt <= o.fetchedAt) m.set(o.seller, o);
  }
  return [...m.values()];
}
