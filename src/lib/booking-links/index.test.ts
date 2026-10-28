import { describe, expect, it } from "vitest";
import {
  activityLink,
  bookingComLink,
  flightLinks,
  googleFlightsLink,
  hotelLinks,
  kayakLink,
  safeExternalUrl,
  sellerLink,
  skyscannerLink,
  type FlightSearch,
} from ".";

const trip: FlightSearch = { from: "LHR", to: "LIS", departDate: "2026-03-10", returnDate: "2026-03-14", adults: 2, currency: "GBP" };

describe("flight links (round trip)", () => {
  it("Google Flights uses a natural-language q with route, dates, travelers and currency", () => {
    const l = googleFlightsLink(trip);
    expect(l.kind).toBe("search");
    expect(l.url).toBe(
      "https://www.google.com/travel/flights?q=Flights+to+LIS+from+LHR+on+2026-03-10+through+2026-03-14+for+2+adults&curr=GBP",
    );
    expect(googleFlightsLink({ ...trip, adults: 1, cabin: "business" }).url).toContain("for+1+adult+in+business+class");
  });

  it("Kayak puts airports and both dates in the path", () => {
    expect(kayakLink(trip).url).toBe("https://www.kayak.com/flights/LHR-LIS/2026-03-10/2026-03-14/2adults?sort=bestflight_a");
    expect(kayakLink({ ...trip, cabin: "business" }).url).toBe(
      "https://www.kayak.com/flights/LHR-LIS/2026-03-10/2026-03-14/business/2adults?sort=bestflight_a",
    );
  });

  it("Skyscanner uses lower-case airports and YYMMDD dates", () => {
    expect(skyscannerLink(trip).url).toBe(
      "https://www.skyscanner.net/transport/flights/lhr/lis/260310/260314/?adultsv2=2&cabinclass=economy&rtn=1&currency=GBP",
    );
  });

  it("falls back to the home page when it can't build a link", () => {
    for (const bad of [
      { ...trip, from: "London" },
      { ...trip, returnDate: "2026-03-01" },
      { ...trip, adults: 0 },
      { ...trip, departDate: "10/03/2026" },
    ]) {
      expect(googleFlightsLink(bad).kind).toBe("home");
      expect(kayakLink(bad).url).toBe("https://www.kayak.com/flights");
      expect(skyscannerLink(bad).kind).toBe("home");
    }
  });

  it("puts the exact provider link first, labeled Book this flight", () => {
    const links = flightLinks(trip, { url: "https://www.kiwi.com/en/booking?token=abc", seller: "Kiwi.com" });
    expect(links[0]).toMatchObject({ label: "Book this flight", kind: "exact", site: "Kiwi.com" });
    expect(links.slice(1).map((l) => l.label)).toEqual([
      "Search on Google Flights",
      "Search on Kayak",
      "Search on Skyscanner",
    ]);
    expect(flightLinks(trip)[0].label).toBe("Search on Google Flights");
  });
});

describe("hotel links", () => {
  const h = { destination: "Lisbon, Portugal", checkIn: "2026-03-10", checkOut: "2026-03-14", adults: 2, rooms: 1, currency: "EUR" };

  it("Booking.com prefills destination, dates, adults, rooms and currency", () => {
    expect(bookingComLink(h).url).toBe(
      "https://www.booking.com/searchresults.html?ss=Lisbon%2C+Portugal&checkin=2026-03-10&checkout=2026-03-14&group_adults=2&no_rooms=1&group_children=0&selected_currency=EUR",
    );
  });

  it("falls back to the home page for bad input", () => {
    expect(bookingComLink({ ...h, checkOut: "2026-03-10" }).kind).toBe("home");
    expect(bookingComLink({ ...h, destination: " " }).url).toBe("https://www.booking.com/");
  });

  it("uses the exact hotel link first", () => {
    const links = hotelLinks(h, { url: "https://www.expedia.com/h123", seller: "Expedia" });
    expect(links[0]).toMatchObject({ label: "Book this hotel", site: "Expedia" });
    expect(links[1].label).toBe("Search on Booking.com");
  });
});

describe("safety", () => {
  it("rejects non-http provider links", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("data:text/html,hi")).toBeUndefined();
    expect(safeExternalUrl("/relative")).toBeUndefined();
    expect(flightLinks(trip, { url: "javascript:alert(1)" })[0].kind).toBe("search");
    expect(activityLink("javascript:x", "Viator")).toBeUndefined();
  });

  it("seller links use the seller's own URL or the search fallback", () => {
    const fb = bookingComLink({ destination: "Lisbon", checkIn: "2026-03-10", checkOut: "2026-03-14", adults: 2, rooms: 1 });
    expect(sellerLink("Agoda", "https://www.agoda.com/x", fb)).toMatchObject({ label: "Book here", site: "Agoda" });
    expect(sellerLink("Agoda", undefined, fb)).toBe(fb);
  });
});
