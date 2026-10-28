# Wayfare

Planning a trip usually means juggling a dozen tabs: one for flights, one for hotels, more for things to do, and a spreadsheet to keep the budget from getting out of hand. Prices differ from site to site, and turning it all into a realistic day-by-day plan is left entirely to you.

Wayfare is an AI travel planner that does that work for you. Describe your trip in a sentence: where you'd like to go, when, who's coming and how much you want to spend. Wayfare searches real flights, hotels and activities, compares prices across booking sites, and keeps every choice within your budget. Then it turns your picks into a clear itinerary, timed hour by hour, from leaving for the airport to the last activity of the trip.

## Features

- **Plan from one sentence.** Type what you want like you'd tell a friend, or fill in a short form. If something important is missing, Wayfare asks one question at a time, with quick-reply buttons.
- **Destination ideas.** No place in mind? Describe the vibe and get up to three destinations, each checked against real flight and hotel prices.
- **Real options, not made-up ones.** Flights (Kiwi.com, Google Flights sellers), hotels (Google Hotels), tours (Viator) and sights (Google Places). Every price, time and rating shows its source and when it was fetched.
- **Budget kept by code.** Your total is split into flights, stay, things to do and a spending reserve. Options over the limit are hidden, and picks that would break the budget are blocked with an explanation. A live budget bar shows what's selected and what's left.
- **Compare prices.** See each booking site's price for a flight or hotel, and pick which site to book with.
- **Things to do, grouped.** "Don't miss" highlights first, then your interests, theme parks, and more ideas. Each place appears once.
- **A real itinerary.** Leave-for-the-airport times, airport buffers, flights, transfers with real travel times, check-in and check-out, meals, and activities inside their opening hours. Nothing overlaps.
- **Booking checklist and ticks.** Mark items done and bookings made as you go.
- **Your trips are saved.** Trips are stored in your own PostgreSQL database and in the browser, so they survive a refresh, work offline, and open in any browser.
- **Works on your phone.** Mobile-first layout, installable as an app (PWA), light and dark themes, smooth animations that respect "reduce motion".

## How it works (briefly)

**The process.** The browser sends your request to the Next.js server. The server runs the planning in three steps: *understand* the request, *plan* (budget, then flights, hotels and activities), and *build the itinerary*. Progress and results stream back live while the work runs. The browser keeps everything in IndexedDB, so screens update instantly and work offline, and saves each trip to PostgreSQL.

**The agents.** Eight AI agents do the judgment work: Intake, Destination Scout, Budget Planner, Flight Scout, Stay Scout, Experience Scout, Verifier and Itinerary Planner. A code orchestrator runs them in a fixed order, with the three scouts in parallel. Agents can only get facts through tools, and every tool result is saved as a signed *evidence record*. Agents answer with record IDs, never with prices or times. The Verifier and code checks catch mistakes and send them back for a retry. The exact work stays in plain code: budget math, the timetable, booking links.

To read more:
- **[docs/architecture.md](docs/architecture.md)**: the full flow from first input to final itinerary, where each output comes from and where it's stored, with diagrams.
- **[docs/agents.md](docs/agents.md)**: every agent, its tools and limits, how they interact, and the orchestration diagrams.

## Setup

You need about 10 minutes. The steps work on Windows, macOS and Linux.

### 1. Install the prerequisites

- **Node.js 22 or newer**: [nodejs.org](https://nodejs.org). Check it with `node --version`.
- **PostgreSQL 14 or newer**: [postgresql.org/download](https://www.postgresql.org/download/). During install, choose a password for the `postgres` user and remember it.
  - macOS with Homebrew: `brew install postgresql@17 && brew services start postgresql@17`
  - Ubuntu/Debian: `sudo apt install postgresql`
  - Docker instead: `docker run -d --name wayfare-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17`
- **Git**: [git-scm.com](https://git-scm.com)

### 2. Get the code

```bash
git clone https://github.com/<your-account>/wayfare.git
cd wayfare
npm install
```

### 3. Create your settings file

```bash
cp .env.example .env.local
```

On Windows Command Prompt, use `copy .env.example .env.local`.

Open `.env.local` in any text editor and fill in:

| Setting | What to put | Required? |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:YOUR_PASSWORD@localhost:5432/wayfare` (use the password from step 1) | Recommended. Without it, trips are kept in the browser only. |
| `OPENAI_API_KEY` | Your key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Its project must have access to `gpt-6-astra`. | **Yes**, for planning |
| `APIFY_TOKEN` | [apify.com](https://apify.com) → Settings → API & Integrations | For hotels and per-site prices |
| `GOOGLE_MAPS_API_KEY` | [Google Cloud Console](https://console.cloud.google.com): enable **Places API (New)** and **Routes API**, add billing, create a key | For sights, opening hours, travel times, photos |
| `VIATOR_API_KEY` | [Viator Partner Program](https://partnerresources.viator.com) (affiliate) | For bookable tours with prices |

Flights from Kiwi.com and currency rates need no key. You can start with only `OPENAI_API_KEY` and add the others later. The app tells you what each missing key costs you.

### 4. Create the database

```bash
npm run db:setup
```

This creates the `wayfare` database and its tables. You should see:

```
✔ created database "wayfare"
✔ tables ready: trip_checklists, trip_itineraries, trip_options, trip_selections, trips
```

It's safe to run again; nothing is ever deleted.

### 5. Start the app

```bash
npm run dev
```

Open **http://localhost:3000**. The terminal prints a capability report showing which services are active. Click **Start a new trip** and describe where you want to go.

### Try it without any keys

Want to click through first? In `.env.local`, leave `OPENAI_API_KEY` empty and set `ALLOW_DEMO_DATA=true`, then run `npm run dev`. The app runs on recorded sample data, with a purple **DEMO DATA** banner. Turn it off again before real use.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm run db:setup` says it can't connect | Check that PostgreSQL is running and that the user name and password in `DATABASE_URL` are right. |
| The sidebar says "Couldn't reach the database" | PostgreSQL stopped, or `DATABASE_URL` changed. Your changes are kept in the browser and saved again once the database is back. |
| "No planning" or model access errors | Check `OPENAI_API_KEY`, and that its project can use `gpt-6-astra`. Restart `npm run dev` after editing `.env.local`. |
| Viator says the API key was rejected | Sandbox keys need `VIATOR_API_BASE=https://api.sandbox.viator.com/partner` in `.env.local`. |
| Old styles or data after an update | Hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R). |

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app in development mode |
| `npm run build` then `npm start` | Production build and server |
| `npm run db:setup` | Create the database and tables |
| `npm test` | Unit, contract and failure tests (no network, no keys). The PostgreSQL tests run when `TEST_DATABASE_URL` points to a database made with `db:setup`. |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run plan -- "London to Lisbon 10-14 Dec 2026, 2 people, 3000 EUR, food"` | A full live plan in the terminal (uses real credits) |
| `npm run smoke -- kiwi` | Live check of one provider: `kiwi`, `frankfurter`, `apify-hotels`, `apify-flights`, `viator`, `google` (uses real credits) |
| `npx tsx scripts/e2e-flow.mts http://localhost:3000` | Browser test of the whole flow at phone width (best with `ALLOW_DEMO_DATA=true`) |
| `npx tsx scripts/e2e-shell.mts http://localhost:3000` | Browser test of the sidebar: create, rename, delete with undo |

## All settings

Optional settings (per-agent models, buffers, limits) are listed with comments in [`.env.example`](.env.example). The main ones:

| Setting | Default | Meaning |
| --- | --- | --- |
| `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` | `gpt-6-astra` / `medium` | Model for all agents. Override per agent with `OPENAI_MODEL_<AGENT>` or `OPENAI_REASONING_EFFORT_<AGENT>` (`INTAKE`, `DESTINATION_SCOUT`, `BUDGET_PLANNER`, `FLIGHT_SCOUT`, `STAY_SCOUT`, `EXPERIENCE_SCOUT`, `VERIFIER`, `ITINERARY_PLANNER`). |
| `MAX_TOKENS_PER_PLAN` | 400000 | Token cap per planning request |
| `MAX_PROVIDER_CALLS_PER_PLAN` | 60 | Provider call cap per planning request (cache hits are free) |
| `AIRPORT_BUFFER_INTERNATIONAL_MIN` / `_DOMESTIC_MIN` | 180 / 120 | Time at the airport before a flight |

## Privacy and security

- API keys stay on the server. They never reach the browser, the AI model or the logs. Google photos are fetched through the app's own `/api/photo` route for the same reason.
- Text from providers (hotel descriptions, reviews) is treated as data and never sent to the model as instructions.
- Trips are stored in your browser and in the PostgreSQL database you configure. The trips API has no login, so Wayfare is meant to run on your own machine or a private network. Don't expose it to the internet as is.
- Saved trips keep the evidence they were built from. Use **Refresh prices** before booking, since prices change.

## Known limitations

- Sights from Google Places usually have no entry price (Google doesn't provide one). They show "Price not listed" and aren't counted in the budget.
- The Apify actors' output isn't fully documented, so the parsers accept the documented field names plus common aliases. Run `npm run smoke -- apify-hotels --record` once you have a token, to check them against live data.
- Trips sync across browsers by "newest change wins". A trip deleted in one browser can come back if another browser still has it and saves a change to it.

## Tech stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Framer Motion, Dexie (IndexedDB), PostgreSQL (`pg`), OpenAI Agents SDK, Model Context Protocol SDK, zod, Vitest, Playwright.
