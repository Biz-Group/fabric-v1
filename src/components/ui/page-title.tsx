import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The page title, one per screen.
 * - `lg` is for workspace pages (Home, a process, a function or department
 *   overview), where the title is the content's name.
 * - `default` is for admin and tenant-console pages, which sit under a nav
 *   and hold forms and tables.
 */
const pageTitleVariants = cva("font-semibold tracking-tight", {
  variants: {
    size: {
      default: "text-xl",
      lg: "text-2xl md:text-3xl",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

/**
 * Renders an `<h1>` by default. Admin pages sit under the shell's "Admin"
 * h1, so they pass `render={<h2 />}`.
 */
function PageTitle({
  className,
  size,
  render,
  ...props
}: useRender.ComponentProps<"h1"> & VariantProps<typeof pageTitleVariants>) {
  return useRender({
    defaultTagName: "h1",
    props: mergeProps<"h1">(
      { className: cn(pageTitleVariants({ size }), className) },
      props
    ),
    render,
    state: {
      slot: "page-title",
      size,
    },
  })
}

export { PageTitle, pageTitleVariants }
