import type { ReactNode } from "react";
import { SquarePen, Trash2 } from "lucide-react";
import { PageTitle } from "@/components/ui/page-title";
import {
  WorkbenchBreadcrumb,
  type WorkbenchCrumb,
} from "@/features/workbench/workbench-breadcrumb";

/** Edit and Delete for the function or department being viewed, on its
 * header. */
export function OverviewActions({
  entityLabel,
  onEdit,
  onDelete,
}: {
  entityLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-org-accent-subtle hover:text-foreground focus-ring"
        title={`Edit ${entityLabel}`}
        aria-label={`Edit ${entityLabel}`}
      >
        <SquarePen className="size-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-ring"
        title={`Delete ${entityLabel}`}
        aria-label={`Delete ${entityLabel}`}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

/** The top of a function or department overview: where it sits, then its
 * name as the page heading, matching the process header. */
export function OverviewHeader({
  name,
  breadcrumb,
  actions,
}: {
  name: string;
  breadcrumb: WorkbenchCrumb[];
  actions?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b bg-background">
      <div className="grid min-w-0 gap-y-3 px-4 py-4 md:px-6">
        <WorkbenchBreadcrumb crumbs={breadcrumb} current={name} />
        <div className="flex min-w-0 items-start gap-2">
          <PageTitle size="lg" className="min-w-0 flex-1 break-words">
            {name}
          </PageTitle>
          {actions}
        </div>
      </div>
    </header>
  );
}
