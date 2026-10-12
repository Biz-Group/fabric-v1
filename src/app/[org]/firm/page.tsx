import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FirmView } from "@/features/firm/firm-view";
import { AlphaBadge } from "@/features/shell/alpha-badge";
import { WorkspaceAppShell } from "@/features/shell/process-app-shell";

export const metadata: Metadata = {
  title: "Firm view | Fabric",
  description:
    "One map of every process, owner and handoff in your organisation.",
};

export default function FirmViewPage() {
  return (
    <TooltipProvider>
      <div className="h-dvh">
        <WorkspaceAppShell
          title="Firm view"
          titleBadge={<AlphaBadge focusable />}
        >
          <FirmView />
        </WorkspaceAppShell>
      </div>
    </TooltipProvider>
  );
}
