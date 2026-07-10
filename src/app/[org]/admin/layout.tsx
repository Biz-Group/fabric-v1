"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect } from "react";
import { Home, MessageSquare, Palette, Users } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
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
  const membership = useQuery(api.users.getMyMembership);
  const storeUser = useMutation(api.users.store);
  const routes = useWorkspaceRoutes();

  // getMyMembership returns null (not undefined) when the Convex user/membership
  // row doesn't exist yet — which happens if /admin is the first route hit in a
  // session (e.g. a bookmarked deep link) before the row is provisioned. Store
  // it here (as the org home and console layouts do) so membership resolves
  // instead of spinning on the null-as-loading state forever.
  useEffect(() => {
    void storeUser();
  }, [storeUser]);

  if (membership === undefined || membership === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <p className="text-sm text-muted-foreground">Loading admin...</p>
      </div>
    );
  }

  if (membership.role !== "admin") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Admin access required</h1>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Your current workspace role is {membership.role}. Ask a workspace
            admin to grant admin access.
          </p>
        </div>
        <Link
          href={routes.appHref}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
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
          label: "Users",
          active: routes.isActivePath("/admin/users", { exact: true }),
        },
        {
          href: routes.adminConversationsHref,
          icon: MessageSquare,
          label: "Conversations",
          active: routes.isActivePath("/admin/conversations", { exact: true }),
        },
        {
          href: routes.adminAppearanceHref,
          icon: Palette,
          label: "Appearance",
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
          <div className="min-w-0 flex-1 p-6">{children}</div>
        </WorkspaceAppShell>
      </div>
    </TooltipProvider>
  );
}
