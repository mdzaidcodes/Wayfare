// Test-only builders. Never imported from app code.
import type { EvidenceOf } from "@/lib/schemas/evidence";

let n = 0;
const id = () => `ev_test${String(++n).padStart(4, "0")}`;
const fetchedAt = "2026-03-01T12:00:00+00:00";

export function flight(
  total: number,
  opts: Partial<EvidenceOf<"flight">["data"]> & { currency?: string } = {},
): EvidenceOf<"flight"> {
  const cur = opts.currency ?? "EUR";
  return {
    id: id(),
    kind: "flight",
    source: "Kiwi.com",
    provider: "kiwi",
    fetchedAt,
    data: {
      outbound: {
        segments: [
          {
            airline: "TAP Air Portugal",
            airlineCode: "TP",
            flightNumber: "TP1351",
            from: { code: "LHR", timeZone: "Europe/London" },
            to: { code: "LIS", timeZone: "Europe/Lisbon" },
            departLocal: "2026-03-10T07:00:00+00:00",
            arriveLocal: "2026-03-10T09:45:00+00:00",
          },
        ],
        durationMinutes: 165,
        stops: 0,
        layovers: [],
      },
      inbound: {
        segments: [
          {
            airline: "TAP Air Portugal",
            from: { code: "LIS", timeZone: "Europe/Lisbon" },
            to: { code: "LHR", timeZone: "Europe/London" },
            departLocal: "2026-03-14T20:00:00+00:00",
            arriveLocal: "2026-03-14T22:40:00+00:00",
          },
        ],
        durationMinutes: 160,
        stops: 0,
        layovers: [],
      },
      travelers: 2,
      totalPrice: { amount: total, currency: cur },
      international: true,
      ...opts,
    },
  };
}

export function hotel(
  opts: Partial<EvidenceOf<"hotel">["data"]> = {},
): EvidenceOf<"hotel"> {
  return {
    id: id(),
    kind: "hotel",
    source: "Google Hotels",
    provider: "apify-google-hotels",
    fetchedAt,
    data: {
      name: "Hotel Test",
      photos: [],
      location: {
        name: "Hotel Test",
        point: { lat: 38.71, lng: -9.14 },
        timeZone: "Europe/Lisbon",
      },
      checkIn: "2026-03-10",
      checkOut: "2026-03-14",
      adults: 2,
      rooms: 1,
      checkInTime: "15:00",
      checkOutTime: "11:00",
      ...opts,
    },
  };
}

export function experience(
  opts: Partial<EvidenceOf<"experience">["data"]> = {},
): EvidenceOf<"experience"> {
  return {
    id: id(),
    kind: "experience",
    source: "Viator",
    provider: "viator",
    fetchedAt,
    data: {
      title: "Test tour",
      location: { name: "Somewhere", point: { lat: 38.7, lng: -9.1 }, timeZone: "Europe/Lisbon" },
      ...opts,
    },
  };
}
