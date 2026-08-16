import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** shadcn Progress on the unified radix-ui package. The indicator width is
 *  driven by `value` so callers can keep a `transition-[width]` animation;
 *  color the fill via `indicatorClassName` (e.g. resource tones bg-hp/bg-san)
 *  and override track height/color via `className`. */
function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string
}) {
  const pct = Math.max(0, Math.min(100, value ?? 0))
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={pct}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("h-full rounded-full bg-primary", indicatorClassName)}
        style={{ width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
