import { connection } from "next/server";
import { getEnv } from "@/server/env";
import { buildCapabilityReport } from "@/server/capabilities";

export async function GET() {
  await connection();
  try {
    return Response.json(buildCapabilityReport(getEnv()));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid configuration" },
      { status: 500 },
    );
  }
}
