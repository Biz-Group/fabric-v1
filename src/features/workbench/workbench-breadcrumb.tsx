import { Fragment, type MouseEvent } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type WorkbenchCrumb = {
  label: string;
  /** The crumb's URL, so it can open in a new tab. */
  href: string;
  /** Moves the workbench there in place. */
  onSelect: () => void;
};

// A modified click (new tab, new window) follows the href; a plain one
// navigates in place.
function handleCrumbClick(
  event: MouseEvent<HTMLAnchorElement>,
  onSelect: () => void,
) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  onSelect();
}

/** Home › Function › Department › current page, above workbench titles. */
export function WorkbenchBreadcrumb({
  crumbs,
  current,
}: {
  crumbs: WorkbenchCrumb[];
  current: string;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-xs">
        {crumbs.map((crumb) => (
          <Fragment key={crumb.href}>
            <BreadcrumbItem>
              <BreadcrumbLink
                href={crumb.href}
                title={crumb.label}
                className="block max-w-48 truncate rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-org-accent-ring/35"
                onClick={(event) => handleCrumbClick(event, crumb.onSelect)}
              >
                {crumb.label}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>
        ))}
        <BreadcrumbItem className="min-w-0">
          <span
            aria-current="page"
            title={current}
            className="block max-w-72 truncate text-xs text-foreground"
          >
            {current}
          </span>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
