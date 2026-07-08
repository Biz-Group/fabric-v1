import { SignIn } from "@clerk/nextjs";
import { AuthShell, clerkAuthAppearance } from "@/features/auth/auth-shell";

export default function SignInPage() {
  return (
    <AuthShell
      title="Welcome back!"
      description="Sign in to continue to your Fabric workspace."
    >
      {/* Sign-in converges on the same org-join handoff as sign-up: the join
          API is idempotent (existing members pass straight through), and this
          closes the gap where a user with an account but no membership in
          this subdomain's org landed on a dead-end "No access" screen. */}
      <SignIn
        appearance={clerkAuthAppearance}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl="/join-organization"
      />
    </AuthShell>
  );
}
