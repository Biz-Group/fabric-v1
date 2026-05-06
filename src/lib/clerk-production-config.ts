import "server-only";

type ClerkKeyMode = "live" | "test" | "unknown" | "missing";

function getClerkKeyMode(
  key: string | undefined,
  livePrefix: string,
  testPrefix: string,
): ClerkKeyMode {
  const trimmed = key?.trim();
  if (!trimmed) return "missing";
  if (trimmed.startsWith(livePrefix)) return "live";
  if (trimmed.startsWith(testPrefix)) return "test";
  return "unknown";
}

function getRootDomainHost(rootDomain: string | undefined): string {
  const trimmed = rootDomain?.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    return url.hostname.toLowerCase();
  } catch {
    return trimmed.split(":")[0].toLowerCase();
  }
}

function isLocalRootDomain(rootDomain: string | undefined): boolean {
  const host = getRootDomainHost(rootDomain);
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "lvh.me" ||
    host.endsWith(".localhost") ||
    host.endsWith(".lvh.me")
  );
}

function shouldCheckProductionClerkConfig(): boolean {
  if (process.env.CLERK_PRODUCTION_CONFIG_CHECK === "false") return false;
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";

  return (
    process.env.NODE_ENV === "production" &&
    !isLocalRootDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN)
  );
}

export function assertProductionClerkConfig(): void {
  if (!shouldCheckProductionClerkConfig()) return;

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  const publishableKeyMode = getClerkKeyMode(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "pk_live_",
    "pk_test_",
  );
  const secretKeyMode = getClerkKeyMode(
    process.env.CLERK_SECRET_KEY,
    "sk_live_",
    "sk_test_",
  );
  const errors: string[] = [];

  if (!rootDomain?.trim()) {
    errors.push("NEXT_PUBLIC_ROOT_DOMAIN must be set for production.");
  }

  if (publishableKeyMode === "missing") {
    errors.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be set.");
  } else if (publishableKeyMode === "test") {
    errors.push(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must use a Clerk production key starting with pk_live_.",
    );
  } else if (publishableKeyMode === "unknown") {
    errors.push(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY has an unexpected format; expected pk_live_ for production.",
    );
  }

  if (secretKeyMode === "missing") {
    errors.push("CLERK_SECRET_KEY must be set.");
  } else if (secretKeyMode === "test") {
    errors.push(
      "CLERK_SECRET_KEY must use the matching Clerk production secret starting with sk_live_.",
    );
  } else if (secretKeyMode === "unknown") {
    errors.push(
      "CLERK_SECRET_KEY has an unexpected format; expected sk_live_ for production.",
    );
  }

  if (
    publishableKeyMode !== "missing" &&
    secretKeyMode !== "missing" &&
    publishableKeyMode !== "unknown" &&
    secretKeyMode !== "unknown" &&
    publishableKeyMode !== secretKeyMode
  ) {
    errors.push(
      "Clerk publishable and secret keys must come from the same Clerk environment.",
    );
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Invalid production Clerk configuration:",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}