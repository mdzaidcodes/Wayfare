// Browser check of the app shell at phone width (M6): new trip, rename, persist across reload,
// delete with undo. Uses the locally installed Chrome/Edge through playwright-core.
//   npm run dev   (in another terminal)
//   npx tsx scripts/e2e-shell.mts [baseUrl] [screenshotDir]
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = process.argv[3];
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch({ channel: "msedge" }));
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = async (name: string) => shots && (await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }));
const step = (s: string) => console.log(`✔ ${s}`);

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await shot("01-welcome");
  await page.getByRole("button", { name: "Start a new trip" }).click();
  await page.getByLabel("Where do you want to go, and what are you after?").waitFor();
  step("new trip opens the intake");
  await shot("02-intake");

  await page.getByRole("button", { name: "Open trips" }).click();
  const drawer = page.getByRole("dialog", { name: "Trips" });
  await drawer.getByText("New trip", { exact: true }).last().waitFor();
  await shot("03-drawer");
  await drawer.getByRole("button", { name: "Rename New trip" }).click();
  const input = drawer.getByLabel("Trip name");
  await input.fill("Lisbon in December");
  await input.press("Enter");
  await drawer.getByText("Lisbon in December").waitFor();
  step("rename with Enter");

  // Touch targets in the drawer are at least 44px.
  const small = await drawer.locator("button").evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && (r.height < 44 || r.width < 44)).length,
  );
  if (small) throw new Error(`${small} drawer buttons are smaller than 44px`);
  step("drawer touch targets ≥ 44px");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open trips" }).click();
  await page.getByRole("dialog", { name: "Trips" }).getByText("Lisbon in December").waitFor();
  step("trip persists across reload");

  const d2 = page.getByRole("dialog", { name: "Trips" });
  await d2.getByRole("button", { name: "Delete Lisbon in December" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("Deleted “Lisbon in December”.").waitFor();
  await shot("04-deleted-undo");
  step("delete asks for confirmation");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Open trips" }).click().catch(() => {});
  await page.getByRole("dialog", { name: "Trips" }).getByText("Lisbon in December").waitFor();
  step("undo restores the trip");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("page scrolls horizontally at 375px");
  step("no horizontal scroll at 375px");

  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  step("no console errors");
} catch (e) {
  await shot("99-failure");
  console.error(`✘ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
