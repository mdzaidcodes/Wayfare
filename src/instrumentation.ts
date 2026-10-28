export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("./server/env");
  const { buildCapabilityReport, formatCapabilityReport } = await import("./server/capabilities");
  try {
    console.log(formatCapabilityReport(buildCapabilityReport(getEnv())));
  } catch (err) {
    // Start anyway: the capability endpoint reports the same problem to the UI.
    console.error(err instanceof Error ? err.message : err);
  }
}
