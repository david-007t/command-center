import * as React from "react"
import { cn } from "@/lib/utils"

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "min-h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)

Select.displayName = "Select"
