import * as React from "react"

import { cn } from "@/lib/utils"

type LoadingScreenProps = React.ComponentProps<"div"> & {
  message?: string
  fullScreen?: boolean
  showSpinner?: boolean
}

function LoadingScreen({
  className,
  message = "Loading...",
  fullScreen = true,
  showSpinner = true,
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
        <div
          className="size-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
          aria-hidden="true"
        />
      )}
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export { LoadingScreen }