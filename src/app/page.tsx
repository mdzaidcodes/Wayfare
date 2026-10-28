import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/AppShell";
import { getEnv } from "@/server/env";
import { buildCapabilityReport, type CapabilityReport } from "@/server/capabilities";

async function Shell() {
  // The capability report reflects the server's current keys, so it's read per request.
  await connection();
  let report: CapabilityReport | null = null;
  try {
    report = buildCapabilityReport(getEnv());
  } catch {
    report = null;
  }
  return <AppShell report={report} />;
}

export default function Home() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Opening Wayfare…</p>}>
      <Shell />
    </Suspense>
  );
}
