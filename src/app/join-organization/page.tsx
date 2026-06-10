import { AuthShell } from "@/features/auth/auth-shell";
import { JoinSubdomainOrganization } from "@/features/auth/join-subdomain-organization";

export default function JoinOrganizationPage() {
  return (
    <AuthShell
      title="Joining your workspace"
      description="We are connecting your account to this Fabric workspace."
    >
      <JoinSubdomainOrganization />
    </AuthShell>
  );
}
