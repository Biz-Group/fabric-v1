export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { assertProductionClerkConfig } = await import(
    "./features/auth/clerk-production-config"
  );
  assertProductionClerkConfig();
}