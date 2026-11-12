"use client";

import { useQuery } from "convex/react";
import { Bot } from "lucide-react";
import Link from "next/link";
import { api } from "../../../../convex/_generated/api";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionGuide } from "@/features/mcp/connection-guide";
import { WorkspaceAppShell } from "@/features/shell/process-app-shell";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";

/** Help → Connect AI assistants (B6): the connection URLs for any member. */
export default function ConnectAssistantsPage() {
  return (
    <TooltipProvider>
      <div className="h-dvh">
        <WorkspaceAppShell title="Connect AI assistants" mainClassName="overflow-auto">
          <div className="min-w-0 flex-1 p-4 sm:p-6">
            <ConnectContent />
          </div>
        </WorkspaceAppShell>
      </div>
    </TooltipProvider>
  );
}

function ConnectContent() {
  const setup = useQuery(api.mcpSettings.mySetup);
  const routes = useWorkspaceRoutes();

  if (setup === undefined) return <Skeleton className="h-64 w-full max-w-3xl" />;
  if (setup.status !== "on") {
    return (
      <EmptyState
        icon={Bot}
        title="AI assistants aren't connected to this workspace"
        description={
          setup.status === "off" && setup.isAdmin
            ? "You can switch this on under Admin → MCP."
            : "Ask your Fabric admin if you'd like to use Claude or Microsoft Copilot with Fabric."
        }
        action={
          setup.status === "off" && setup.isAdmin ? (
            <Link href={routes.adminMcpHref} className={buttonVariants({ variant: "outline" })}>
              Open MCP settings
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <PageTitle render={<h2 />}>Connect AI assistants</PageTitle>
        <p className="text-sm text-muted-foreground">
          Ask Claude or Microsoft Copilot about how your organization works, using what you can see in Fabric. Answers link
          back to the processes, flows and overviews they come from.
        </p>
      </div>
      <ConnectionGuide workspaceUrl={setup.workspaceUrl} />
    </div>
  );
}
