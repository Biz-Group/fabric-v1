import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { headers } from "next/headers";
import { AuthShell, clerkAuthAppearance } from "@/features/auth/auth-shell";
import { RememberReturnPath } from "@/features/auth/remember-return-path";
import { toSafeReturnPath } from "@/features/auth/return-path";
import { isTenantsConsoleHost } from "@/lib/subdomain";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host") ?? "";
  // The tenant console has no workspace to join, so it goes straight back to
  // the page that was asked for.
  let afterSignInUrl = "/join-organization";
  if (isTenantsConsoleHost(host, ROOT_DOMAIN)) {
    const { redirect_url: redirectUrl } = await searchParams;
    afterSignInUrl =
      toSafeReturnPath(
        typeof redirectUrl === "string" ? redirectUrl : null,
        host,
      ) ?? "/";
  }

  return (
    <AuthShell
      title="Welcome back!"
      description="Sign in to continue to your Fabric workspace."
    >
      {/* Sign-in converges on the same org-join handoff as sign-up: the join
          API is idempotent (existing members pass straight through), and this
          closes the gap where a user with an account but no membership in
          this subdomain's org landed on a dead-end "No access" screen. The
          page the user asked for is remembered and restored after the join. */}
      <RememberReturnPath />
      <SignIn
        appearance={clerkAuthAppearance}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl={afterSignInUrl}
      />
    </AuthShell>
  );
}
