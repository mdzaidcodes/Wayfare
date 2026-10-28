import { connection } from "next/server";
import { usageLog, usageSummary } from "@/server/providers/guard";

/** Provider consumption since the server started (Apify units, Google calls, cache hits). */
export async function GET() {
  await connection();
  return Response.json({ summary: usageSummary(), recent: usageLog().slice(-100) });
}
