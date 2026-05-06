export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { assertProductionClerkConfig } = await import(
    "./lib/clerk-production-config"
  );
  assertProductionClerkConfig();
}