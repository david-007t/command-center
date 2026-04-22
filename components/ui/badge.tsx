import * as React from "react"
import { cn } from "@/lib/utils"

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "green" | "amber" | "red" | "purple" | "sky" | "emerald" | "rose" | "fuchsia" | "slate"
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  const tones = {
    neutral: "bg-slate-800 text-slate-200",
    slate: "bg-slate-500/10 border border-slate-700 text-slate-300",
    green: "bg-emerald-500/15 text-emerald-300",
    emerald: "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300",
    amber: "bg-amber-500/15 text-amber-300",
    red: "bg-rose-500/15 text-rose-300",
    rose: "bg-rose-500/10 border border-rose-500/30 text-rose-300",
    purple: "bg-fuchsia-500/15 text-fuchsia-300",
    fuchsia: "bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300",
    sky: "bg-sky-500/10 border border-sky-500/30 text-sky-300",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
