import * as React from "react"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

type LoadingScreenProps = React.ComponentProps<"div"> & {
  message?: string
  fullScreen?: boolean
  showSpinner?: boolean
}

function LoadingScreen({
  className,
  message = "Loading…",
  fullScreen = true,
  showSpinner = true,
  children,
  ...props
}: LoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        fullScreen ? "min-h-screen" : "min-h-20 rounded-lg border bg-card p-6",
        className
      )}
      {...props}
    >
      {showSpinner && (
        <Spinner size="lg" className="text-muted-foreground" />
      )}
      <p className="text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  )
}

export { LoadingScreen }