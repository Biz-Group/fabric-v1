"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Home, MessageSquare, Palette, Users } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { buttonVariants } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/page-title";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  WorkspaceAppShell,
  type WorkspaceNavSection,
} from "@/features/shell/process-app-shell";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The workspace layout provisions the membership before mounting this, so
  // null here means access was lost mid-visit; that layout takes over then.
  const membership = useQuery(api.users.getMyMembership);
  const routes = useWorkspaceRoutes();

  if (membership === undefined) {
    return <LoadingScreen message="Loading admin…" />;
  }

  if (membership?.role !== "admin") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div>
          <PageTitle>Admin access required</PageTitle>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {membership
              ? `Your current workspace role is ${membership.role}. `
              : ""}
            Ask a workspace admin to grant admin access.
          </p>
        </div>
        <Link
          href={routes.appHref}
          className={buttonVariants({ variant: "outline" })}
        >
          Back to processes
        </Link>
      </div>
    );
  }

  const adminNavSections: WorkspaceNavSection[] = [
    {
      label: "Manage",
      items: [
        {
          href: routes.adminHref,
          icon: Home,
          label: "Overview",
          active: routes.isActivePath("/admin", { exact: true }),
        },
        {
          href: routes.adminUsersHref,
          icon: Users,
          label: "Members",
          active: routes.isActivePath("/admin/users", { exact: true }),
        },
        {
          href: routes.adminConversationsHref,
          icon: MessageSquare,
          label: "Contributions",
          active: routes.isActivePath("/admin/conversations", { exact: true }),
        },
        {
          href: routes.adminAppearanceHref,
          icon: Palette,
          label: "Branding",
          active: routes.isActivePath("/admin/appearance", { exact: true }),
        },
      ],
    },
  ];

  return (
    <TooltipProvider>
      <div className="h-dvh">
        <WorkspaceAppShell
          title="Admin"
          navSections={adminNavSections}
          mainClassName="overflow-auto"
        >
          <div className="min-w-0 flex-1 p-4 sm:p-6">{children}</div>
        </WorkspaceAppShell>
      </div>
    </TooltipProvider>
  );
}
