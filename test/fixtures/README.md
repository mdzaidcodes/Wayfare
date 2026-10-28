# Provider fixtures

Used only by contract tests. Never loaded by the app.

| File | Origin |
| --- | --- |
| `kiwi-search-flight.json` | Recorded live from `https://mcp.kiwi.com` (`scripts/record-kiwi-fixture.mts`), trimmed to 6 itineraries. |
| `frankfurter-rates.json` | Recorded live from `api.frankfurter.dev/v2/rates`. |
| `apify-google-hotels.json` | Hand-built to the actor's documented output fields (benthepythondev/google-hotels-scraper). No key was available while building. Re-record with `npm run smoke -- apify-hotels --record`. |
| `apify-google-flights.json` | Hand-built to the actor's documented output fields (lergassy/google-flights-api). The docs don't name the keys inside `bookingOptions[]`, so the adapter accepts several aliases. Re-record with `npm run smoke -- apify-flights --record`. |
| `viator-*.json` | Hand-built to the Viator Partner API v2 product summary shape. Re-record with `npm run smoke -- viator --record`. |
| `google-*.json` | Hand-built to the Places API (New) / Routes API response shape. Re-record with `npm run smoke -- google --record`. |
