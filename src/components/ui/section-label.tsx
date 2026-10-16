import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The eyebrow: a small, uppercase, muted label that names the section or
 * value below it. Semibold because muted text this small washes out at
 * medium weight.
 * - `default` is `text-xs`, for labels on a page, in a panel or a dialog.
 * - `sm` is `text-2xs`, for dense chrome: palette groups, the sidebar, flow
 *   lanes, stat tiles.
 */
const sectionLabelVariants = cva(
  "font-semibold uppercase tracking-wider text-muted-foreground",
  {
    variants: {
      size: {
        default: "text-xs",
        sm: "text-2xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

/**
 * Renders a `<p>` by default. When the label heads a section, keep it in the
 * heading outline with `render={<h3 />}` (or whichever level fits).
 */
function SectionLabel({
  className,
  size,
  render,
  ...props
}: useRender.ComponentProps<"p"> & VariantProps<typeof sectionLabelVariants>) {
  return useRender({
    defaultTagName: "p",
    props: mergeProps<"p">(
      { className: cn(sectionLabelVariants({ size }), className) },
      props
    ),
    render,
    state: {
      slot: "section-label",
      size,
    },
  })
}

export { SectionLabel, sectionLabelVariants }
