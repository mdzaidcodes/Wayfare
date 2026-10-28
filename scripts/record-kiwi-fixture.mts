// Records a Kiwi.com fixture for contract tests. Run: npx tsx scripts/record-kiwi-fixture.mts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
const c = new Client({ name: "wayfare-probe", version: "0.0.1" });
await c.connect(new StreamableHTTPClientTransport(new URL("https://mcp.kiwi.com")));
const r = await c.callTool({ name: "search-flight", arguments: { flyFrom: "LHR", flyTo: "LIS", departureDate: "10/12/2026", returnDate: "14/12/2026", adults: 2, currency: "EUR" } });
const s = r.structuredContent as { itineraries: unknown[] };
s.itineraries = s.itineraries.slice(0, 6);
fs.mkdirSync("test/fixtures", { recursive: true });
fs.writeFileSync("test/fixtures/kiwi-search-flight.json", JSON.stringify(s, null, 2));
console.log("saved", s.itineraries.length);
await c.close();
