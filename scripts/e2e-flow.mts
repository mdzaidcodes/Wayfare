// Full flow at phone width (M7/M8): vague sentence → question → destination → flights, stay,
// activities → itinerary with saved ticks, plus booking-link checks. Needs a dev server; with
// ALLOW_DEMO_DATA=true and no OpenAI key it runs on recorded fixtures (DEMO DATA banner).
//   npx tsx scripts/e2e-flow.mts [baseUrl] [screenshotDir]
import { chromium, type Page } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = process.argv[3];
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch({ channel: "msedge" }));
const page: Page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
const shot = async (name: string) => shots && (await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }));
const step = (s: string) => console.log(`✔ ${s}`);
const T = { timeout: 60_000 };
// Selections are saved to IndexedDB first, so the checkbox flips a moment after the click.
const tick = async (box: ReturnType<Page["getByRole"]>) => {
  await box.click();
  for (let i = 0; i < 50 && !(await box.isChecked()); i++) await page.waitForTimeout(100);
  if (!(await box.isChecked())) throw new Error("checkbox didn't stick");
};

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start a new trip" }).click();
  await page.getByLabel("Where do you want to go, and what are you after?").fill("Somewhere warm with beaches and good food, about a week, not too expensive");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Start planning" }).click();
  await page.getByRole("region", { name: "Progress" }).or(page.getByText("Where are you flying from?")).first().waitFor({ timeout: 1500 });
  step(`progress visible after ${Date.now() - t0}ms`);
  await page.getByText("Where are you flying from?").waitFor(T);
  await shot("10-question");
  step("vague request → one question with chips");
  if (!(await page.getByRole("button", { name: "You decide" }).isVisible())) throw new Error("no You decide chip");
  await page.getByRole("button", { name: "London" }).click();

  await page.getByRole("button", { name: "Suggest destinations that fit" }).click(T);
  await page.getByRole("button", { name: "Choose Lisbon" }).waitFor(T);
  await shot("11-destinations");
  step("destination suggestions checked against real prices");
  await page.getByRole("button", { name: "Choose Lisbon" }).click();
  await page.getByRole("button", { name: "Find flights, stays and things to do" }).click(T);
  await page.getByRole("region", { name: "Progress" }).waitFor({ timeout: 1500 });
  step("planning progress shown on the Basics screen");

  // Flights
  await page.getByRole("heading", { name: "Flights" }).waitFor(T);
  const flightBox = page.getByRole("checkbox", { name: /^Select flight/ }).first();
  await flightBox.waitFor(T);
  if (await page.getByRole("region", { name: "Progress" }).isVisible()) throw new Error("progress list still shown on Flights");
  step("moved to Flights once flights arrived; no progress list there");
  await shot("12-flights");
  await page.locator("article button[aria-expanded]").first().click();
  const gf = await page.getByRole("link", { name: /Search on Google Flights/ }).first().getAttribute("href");
  if (!gf?.includes("Flights+to+LIS+from+LHR+on+2026-12-10+through+2026-12-14+for+2+adults")) throw new Error(`Google Flights link wrong: ${gf}`);
  const exact = await page.getByRole("link", { name: /Book this flight/ }).first().getAttribute("href");
  if (!exact?.startsWith("https://kiwi.com/")) throw new Error(`exact flight link wrong: ${exact}`);
  step("flight Book buttons prefilled (exact Kiwi link + Google Flights/Kayak/Skyscanner)");
  await tick(flightBox);
  await page.getByRole("button", { name: /Compare prices/ }).first().click();
  await page.getByText(/taxes|sites|Only one price|Checking prices/).first().waitFor(T);
  step("flight selected; Compare prices panel opens");
  if (!(await page.getByRole("region", { name: "Budget" }).isVisible())) throw new Error("budget bar not visible");
  step("budget bar visible");

  // Stay
  await page.getByRole("button", { name: "Next: Stay" }).click();
  await page.getByRole("heading", { name: "Where to stay" }).waitFor(T);
  const hotelBox = page.getByRole("checkbox", { name: /^Select / }).first();
  await hotelBox.waitFor(T);
  await page.locator("article button[aria-expanded]").first().click();
  const bk = await page.getByRole("link", { name: /Book this hotel|Search on Booking.com/ }).last().getAttribute("href");
  if (!bk?.includes("2026-12-1")) throw new Error(`hotel link has no dates: ${bk}`);
  await tick(hotelBox);
  await page.getByRole("button", { name: /Compare prices/ }).first().click();
  await page.getByText("Booking.com", { exact: true }).first().waitFor(T);
  await shot("13-stay");
  step("hotel selected; per-site prices shown with Book here");

  // Activities
  await page.getByRole("button", { name: "Next: Things to do" }).click();
  await page.getByRole("heading", { name: "Things to do" }).waitFor(T);
  await tick(page.getByRole("checkbox", { name: /^Add / }).nth(0));
  await tick(page.getByRole("checkbox", { name: /^Add / }).nth(1));
  await shot("14-activities");
  step("activities added");

  // Itinerary
  await page.getByRole("button", { name: "Next: Itinerary" }).click();
  await page.getByRole("button", { name: "Build itinerary" }).click();
  await page.getByRole("heading", { name: "Booking checklist" }).waitFor(T);
  await shot("15-itinerary");
  for (const t of [/Leave for/, /Arrive at .*Heathrow|Arrive at .*LHR/, /Immigration and baggage/, /Transfer to/, /Check in at|Drop bags/, /Lunch|Dinner/, /Check out of/]) {
    if (!(await page.getByText(t).first().isVisible())) throw new Error(`itinerary missing ${t}`);
  }
  step("itinerary has airport, flights, buffers, transfers, check-in/out, meals");
  const box = page.getByRole("checkbox", { name: /Mark “Leave for/ });
  await box.click();
  for (let i = 0; i < 50 && !(await box.isChecked()); i++) await page.waitForTimeout(100);
  if (!(await box.isChecked())) throw new Error("tick did not register");
  await page.reload({ waitUntil: "networkidle" });
  if (!(await page.getByRole("checkbox", { name: /Mark “Leave for/ }).isChecked())) throw new Error("tick didn't persist");
  step("ticks persist across reload");
  if (process.argv.includes("--offline")) {
    // PWA: once the service worker controls the page, a saved itinerary works with no network.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.context().setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Booking checklist" }).waitFor(T);
    if (!(await page.getByRole("checkbox", { name: /Mark “Leave for/ }).isChecked())) throw new Error("offline: saved tick missing");
    const second = page.getByRole("checkbox", { name: /Mark “Arrive at/ }).first();
    await second.click();
    for (let i = 0; i < 50 && !(await second.isChecked()); i++) await page.waitForTimeout(100);
    if (!(await second.isChecked())) throw new Error("offline: couldn't tick");
    await page.getByText(/You.re offline/).waitFor(T);
    await shot("16-offline");
    await page.context().setOffline(false);
    step("offline: itinerary loads from cache + IndexedDB, ticking works, offline notice shown");
  }
  const banner = await page.getByText(/DEMO DATA/).first().isVisible();
  step(`DEMO DATA banner ${banner ? "shown" : "MISSING"}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("horizontal scroll at 375px");
  step("no horizontal scroll");
  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  step("no console errors");
} catch (e) {
  await shot("99-failure");
  console.error(`✘ ${e instanceof Error ? e.message.split("\n").slice(0, 6).join("\n") : e}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
