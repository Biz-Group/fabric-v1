import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { AuthShell, clerkAuthAppearance } from "@/features/auth/auth-shell";
import { RememberReturnPath } from "@/features/auth/remember-return-path";

export const metadata: Metadata = {
  title: "Sign up",
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Join your Fabric workspace and start capturing how work gets done."
    >
      <RememberReturnPath />
      <SignUp
        appearance={clerkAuthAppearance}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/join-organization"
      />
    </AuthShell>
  );
}
